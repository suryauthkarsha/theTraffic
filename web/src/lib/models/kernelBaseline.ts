import { circularDistance, secondsSinceWeekStartIST } from "./features";
import { weightedMean, weightedQuantile } from "./stats";
import type { WeightedSample } from "./types";

/**
 * Baseline Model 1 — kernel-smoothed empirical time-of-week delay (docs/METHODOLOGY.md §21).
 *
 *   w_i = w_recency,i × w_time,i × w_quality,i
 *   w_recency = exp(−age/τ)          w_time = exp(−δ_t² / 2h²)          w_quality = q_i
 *   D̂(t) = Σ w_i D_i / Σ w_i        p̂_stop(t) = Σ w_i y_i / Σ w_i
 *
 * The temporal kernel runs on the weekly circle (P = 604 800 s) so 23:59 and 00:01 are adjacent
 * and Monday 08:00 is near Tuesday 08:00 through the secondary daily kernel.
 *
 * Optional congestion covariate x (§11): when BOTH the query and a sample carry a congestion factor
 * (Mapbox congestion index / 100, or 1 − current/free-flow speed from TomTom flow data), a third Gaussian kernel with bandwidth
 * h_congestion weights samples observed under similar traffic more. Samples without the covariate
 * keep their time-only weight, so the model degrades gracefully to the time-of-week baseline.
 */
export interface KernelParams {
  /** Daily kernel bandwidth h (s). Initial 900 s = 15-min bucket scale. */
  h_day_s: number;
  /** Weekly kernel bandwidth (s) — same weekday same time gets full weight; other days decay. */
  h_week_s: number;
  /** Recency time constant τ (s). Initial 45 days. */
  tau_s: number;
  /** Minimum effective sample size before an estimate is returned. */
  min_effective_n: number;
  /** Congestion-covariate bandwidth (congestion factor units, 0–1). */
  h_congestion: number;
}

export const DEFAULT_KERNEL_PARAMS: KernelParams = {
  h_day_s: 900,
  h_week_s: 3 * 86_400,
  tau_s: 45 * 86_400,
  min_effective_n: 8,
  h_congestion: 0.25,
};

/** Query-time covariates. */
export interface KernelCovariates {
  congestion: number | null;
}

export interface KernelEstimate {
  mean_delay_s: number;
  median_delay_s: number;
  p10_delay_s: number;
  p25_delay_s: number;
  p75_delay_s: number;
  p90_delay_s: number;
  p_stop: number;
  effective_n: number;
  raw_n: number;
  mean_stop_duration_s: number | null;
}

export function kernelWeights(samples: WeightedSample[], t: number, now: number, p: KernelParams, x: KernelCovariates = { congestion: null }): number[] {
  const tw = secondsSinceWeekStartIST(t);
  const td = tw % 86_400;
  const hc = p.h_congestion > 0 ? p.h_congestion : 0.25;
  return samples.map((s) => {
    const sw = secondsSinceWeekStartIST(s.t);
    const sd = sw % 86_400;
    const δday = circularDistance(td, sd, 86_400);
    const δweek = circularDistance(tw, sw, 604_800);
    const wTime = Math.exp(-(δday * δday) / (2 * p.h_day_s * p.h_day_s)) * Math.exp(-(δweek * δweek) / (2 * p.h_week_s * p.h_week_s));
    const age = Math.max(0, (now - s.t) / 1000);
    const wRecency = Math.exp(-age / p.tau_s);
    let wCov = 1;
    if (x.congestion !== null && Number.isFinite(x.congestion) && s.congestion !== null && s.congestion !== undefined && Number.isFinite(s.congestion)) {
      const δc = Math.min(1, Math.max(0, x.congestion)) - Math.min(1, Math.max(0, s.congestion));
      wCov = Math.exp(-(δc * δc) / (2 * hc * hc));
    }
    return wTime * wRecency * s.quality * wCov;
  });
}

/** Kish effective sample size (Σw)² / Σw². */
export function effectiveSampleSize(w: number[]): number {
  const s = w.reduce((a, b) => a + b, 0);
  const s2 = w.reduce((a, b) => a + b * b, 0);
  return s2 > 0 ? (s * s) / s2 : 0;
}

export function kernelEstimate(samples: WeightedSample[], t: number, now: number, p: KernelParams = DEFAULT_KERNEL_PARAMS, x: KernelCovariates = { congestion: null }): KernelEstimate | null {
  if (samples.length === 0) return null;
  const w = kernelWeights(samples, t, now, p, x);
  const neff = effectiveSampleSize(w);
  if (neff < p.min_effective_n) return null;
  const d = samples.map((s) => s.delay_s);
  const y = samples.map((s) => (s.stopped ? 1 : 0));
  const stopDur = samples.filter((s) => s.stopped);
  return {
    mean_delay_s: weightedMean(d, w),
    median_delay_s: weightedQuantile(d, w, 0.5),
    p10_delay_s: weightedQuantile(d, w, 0.1),
    p25_delay_s: weightedQuantile(d, w, 0.25),
    p75_delay_s: weightedQuantile(d, w, 0.75),
    p90_delay_s: weightedQuantile(d, w, 0.9),
    p_stop: weightedMean(y, w),
    effective_n: neff,
    raw_n: samples.length,
    mean_stop_duration_s: stopDur.length ? weightedMean(stopDur.map((s) => s.delay_s), stopDur.map((s) => s.quality)) : null,
  };
}

/**
 * Hour-of-day × weekday/weekend summary table for the intersection page charts.
 * Returns null cells where fewer than `minN` raw observations exist.
 */
export interface HourlyCell {
  hour: number;
  n: number;
  median_delay_s: number | null;
  p10_delay_s: number | null;
  p90_delay_s: number | null;
  p_stop: number | null;
}

export function hourlySummary(samples: WeightedSample[], dayType: "all" | "weekday" | "weekend", minN = 5): HourlyCell[] {
  const cells: HourlyCell[] = Array.from({ length: 24 }, (_, hour) => ({ hour, n: 0, median_delay_s: null, p10_delay_s: null, p90_delay_s: null, p_stop: null }));
  const buckets: WeightedSample[][] = Array.from({ length: 24 }, () => []);
  for (const s of samples) {
    const w = secondsSinceWeekStartIST(s.t);
    const dow = Math.floor(w / 86_400); // Monday=0
    const weekend = dow >= 5;
    if (dayType === "weekday" && weekend) continue;
    if (dayType === "weekend" && !weekend) continue;
    buckets[Math.floor((w % 86_400) / 3600)].push(s);
  }
  buckets.forEach((b, h) => {
    cells[h].n = b.length;
    if (b.length >= minN) {
      const d = b.map((s) => s.delay_s);
      const q = b.map((s) => s.quality);
      cells[h].median_delay_s = weightedQuantile(d, q, 0.5);
      cells[h].p10_delay_s = weightedQuantile(d, q, 0.1);
      cells[h].p90_delay_s = weightedQuantile(d, q, 0.9);
      cells[h].p_stop = weightedMean(b.map((s) => (s.stopped ? 1 : 0)), q);
    }
  });
  return cells;
}
