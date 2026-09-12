import type { DayPlan, PlanWindow, PublishedJunction } from "@/lib/data/types";

import { expectedWaitAt, isGreen, type FixedTimeParams } from "./fixedTime";
import { circularResidual } from "./periodicity";
import { huber, normalCdf } from "./stats";

/**
 * Published-plan (BTP) prediction model.
 *
 * An accepted plan link gives, for a time-of-day window, the cycle C and the phase durations g_1..g_n.
 * It does NOT give (a) which phase serves which approach (the diagram is not machine-readable) or
 * (b) the wall-clock offset O. Without O the arrival phase is uniform, so for an approach whose
 * green is g the classical uniform-arrival results apply (Webster's first term with X = 0):
 *
 *   P(stop) = r / C            E[D] = r² / (2C)            r = C − g
 *   F_D(d)  = g/C + d/C for 0 ≤ d ≤ r   →   quantile_q = max(0, qC − g)
 *
 * When the approach→phase mapping is unknown we marginalise over the vehicle phases with weights
 * ∝ g_i (Webster allocates green in proportion to flow ratio, so a random approaching vehicle is
 * more likely on a long-green approach). The min/max over phases is reported as delay_range_s.
 *
 * Queue (over-saturation) delay is NOT included — it needs volume data we do not have. Every
 * value is therefore a documented lower-bound prior, labelled Level P in the UI.
 *
 * With ≥ 12 green-start events from real encounters in the same plan window the offset can be
 * calibrated (fitOffsetGivenCycle) and the explicit phase model applies (Level A).
 */
export const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export interface IstClock {
  /** 0 = Monday … 6 = Sunday (IST). */
  dow: number;
  /** Minutes since IST midnight. */
  minutes: number;
  /** Seconds since IST midnight (fractional). */
  secondsOfDay: number;
}

export function istClock(t: number): IstClock {
  const d = new Date(t + IST_OFFSET_MS);
  const dow = (d.getUTCDay() + 6) % 7;
  const secondsOfDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  return { dow, minutes: Math.floor(secondsOfDay / 60), secondsOfDay };
}

const hm = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Pick the day plan for a weekday index; returns whether a different day's plan had to be assumed. */
export function dayPlanFor(junction: PublishedJunction, dow: number): { plan: DayPlan | null; assumed: boolean } {
  const plans = junction.day_plans;
  const find = (...types: string[]) => plans.find((p) => types.includes(p.day_type)) ?? null;
  if (dow === 6) {
    const p = find("sunday", "weekend", "all_days", "holiday");
    if (p) return { plan: p, assumed: false };
    const w = find("weekday_default");
    return { plan: w, assumed: w !== null };
  }
  if (dow === 5) {
    const p = find("saturday", "weekend", "all_days");
    if (p) return { plan: p, assumed: false };
    return { plan: find("weekday_default"), assumed: false }; // BTP tables treat Saturday as a weekday
  }
  const p = find("weekday_default", "all_days");
  return { plan: p, assumed: false };
}

export interface ActiveWindow {
  window: PlanWindow | null;
  day_type: string;
  assumed: boolean;
  /** timed | blinking | outside_windows | unknown | none */
  mode: string;
}

/** The plan window covering IST time `t`. */
export function windowAt(junction: PublishedJunction, t: number): ActiveWindow {
  const clock = istClock(t);
  const { plan, assumed } = dayPlanFor(junction, clock.dow);
  if (!plan) return { window: null, day_type: "none", assumed: false, mode: "none" };
  for (const w of plan.windows) {
    const s = hm(w.start);
    const e = w.end === "24:00" ? 1440 : hm(w.end);
    if (clock.minutes >= s && clock.minutes < e) return { window: w, day_type: plan.day_type, assumed, mode: w.mode };
  }
  return { window: null, day_type: plan.day_type, assumed, mode: "outside_windows" };
}

/**
 * Vehicle phases of a timed window: complete cells, pedestrian-only phase removed, degenerate cells
 * (0 s or ≥ cycle) dropped. Returns null when the window cannot support a prior (C ≤ 0, unreadable
 * cells, or no valid vehicle phase remains) — the caller then reports UNKNOWN instead of a number.
 */
export function vehiclePhases(junction: PublishedJunction, w: PlanWindow): number[] | null {
  if (w.mode !== "timed" || w.cycle_s === null || !(w.cycle_s > 0)) return null;
  if (w.phases.some((p) => p === null)) return null;
  const C = w.cycle_s;
  const phases = w.phases as number[];
  let ped = junction.pedestrian_phase_index;
  const positive = phases.map((p, i) => ({ p, i })).filter((x) => x.p > 0);
  // heuristic pedestrian phase: an explicit EXCLUSIVE marker is preferred; otherwise a phase ≤ 15 s
  // that is the shortest positive phase and ≤ 12 % of the cycle is almost always the all-red stage.
  if (ped === null && positive.length >= 3) {
    const min = positive.reduce((b, x) => (x.p < b.p ? x : b));
    if (min.p <= 15 && min.p <= 0.12 * C) ped = min.i;
  }
  const veh = phases.filter((p, i) => i !== ped && p > 0 && p < C);
  return veh.length ? veh : null;
}

/** Green duration of a reviewer-assigned phase column, or null when the column is not a valid vehicle phase. */
export function assignedGreen(w: PlanWindow, phaseIndex: number | null): number | null {
  if (phaseIndex === null || w.cycle_s === null) return null;
  const g = w.phases[phaseIndex];
  return g !== null && g !== undefined && g > 0 && g < w.cycle_s ? g : null;
}

export interface UniformPhaseEstimate {
  mean_delay_s: number;
  p_stop: number;
  quantiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  range: [number, number];
  weights: number[];
}

/** Uniform-arrival delay for one approach green g in cycle C (C > 0, 0 ≤ g ≤ C enforced). */
export function uniformDelay(C: number, g: number): { mean: number; p_stop: number; quantile: (q: number) => number } {
  if (!(C > 0)) return { mean: 0, p_stop: 0, quantile: () => 0 };
  g = Math.min(C, Math.max(0, g));
  const r = Math.max(0, C - g);
  return {
    mean: (r * r) / (2 * C),
    p_stop: r / C,
    quantile: (q: number) => Math.max(0, q * C - g),
  };
}

/**
 * Marginal over candidate vehicle phases. `assigned` restricts to a reviewer-assigned green.
 * Mixture quantiles are inverted numerically on a 0.5 s grid.
 */
export function marginalUniformEstimate(C: number, greens: number[], assigned: number | null = null): UniformPhaseEstimate {
  const valid = greens.filter((g) => g > 0 && g < C);
  const gs = assigned !== null && assigned > 0 && assigned < C ? [assigned] : valid.length ? valid : greens;
  const total = gs.reduce((s, g) => s + g, 0) || 1;
  const weights = gs.map((g) => g / total);
  const parts = gs.map((g) => uniformDelay(C, g));
  const mean = parts.reduce((s, p, i) => s + weights[i] * p.mean, 0);
  const pStop = parts.reduce((s, p, i) => s + weights[i] * p.p_stop, 0);
  const cdf = (d: number) => parts.reduce((s, _p, i) => s + weights[i] * Math.min(1, gs[i] / C + d / C), 0);
  const invert = (q: number) => {
    if (cdf(0) >= q) return 0;
    const rMax = Math.max(...gs.map((g) => C - g));
    for (let d = 0; d <= rMax; d += 0.5) if (cdf(d) >= q) return d;
    return rMax;
  };
  const means = parts.map((p) => p.mean);
  return {
    mean_delay_s: mean,
    p_stop: pStop,
    quantiles: { p10: invert(0.1), p25: invert(0.25), p50: invert(0.5), p75: invert(0.75), p90: invert(0.9) },
    range: [Math.min(...means), Math.max(...means)],
    weights,
  };
}

/**
 * Offset calibration with a known cycle: minimise Σ ρ_Huber(circular residual(g_i − O, C)) over O
 * on a 0.5 s grid. Identifiable with far fewer events than the joint (C, O) fit. Returns null when
 * fewer than 12 events or the inlier fraction < 0.7.
 */
export function fitOffsetGivenCycle(greenStarts: number[], C: number, delta = 4): { O: number; inlier_fraction: number; cost: number; n: number } | null {
  if (greenStarts.length < 12 || C <= 0) return null;
  let best = { O: 0, cost: Infinity };
  for (let O = 0; O < C; O += 0.5) {
    const cost = greenStarts.reduce((s, g) => s + huber(circularResidual(g, O, C), delta), 0);
    if (cost < best.cost) best = { O, cost };
  }
  const inliers = greenStarts.filter((g) => circularResidual(g, best.O, C) <= delta).length / greenStarts.length;
  if (inliers < 0.7) return null;
  return { O: best.O, inlier_fraction: inliers, cost: best.cost, n: greenStarts.length };
}

/**
 * Explicit phase model with arrival uncertainty T ~ N(μ, σ²): returns P(stop) and E[wait] by
 * numerical integration over ±4σ on a 0.5 s grid (σ ≥ C/2 degrades gracefully to the uniform prior).
 */
export function phaseModelEstimate(μ: number, σ: number, p: FixedTimeParams): { p_stop: number; mean_delay_s: number; p10: number; p90: number } {
  if (σ < 0.5) {
    const stop = isGreen(μ, p) ? 0 : 1;
    const w = expectedWaitAt(μ, p);
    return { p_stop: stop, mean_delay_s: w, p10: stop ? w : 0, p90: w };
  }
  const step = 0.5;
  const lo = μ - 4 * σ;
  const hi = μ + 4 * σ;
  let pStop = 0;
  let wait = 0;
  const waits: { w: number; m: number }[] = [];
  let prev = normalCdf((lo - μ) / σ);
  for (let t = lo + step; t <= hi; t += step) {
    const c = normalCdf((t - μ) / σ);
    const m = c - prev;
    prev = c;
    const tm = t - step / 2;
    const green = isGreen(tm, p);
    const w = green ? 0 : expectedWaitAt(tm, p);
    if (!green) pStop += m;
    wait += m * w;
    waits.push({ w, m });
  }
  waits.sort((a, b) => a.w - b.w);
  const q = (qq: number) => {
    let acc = 0;
    for (const x of waits) {
      acc += x.m;
      if (acc >= qq) return x.w;
    }
    return waits[waits.length - 1]?.w ?? 0;
  };
  return { p_stop: pStop, mean_delay_s: wait, p10: q(0.1), p90: q(0.9) };
}

/** Human-readable summary of a window for UI rows. */
export function describeWindow(w: PlanWindow): string {
  if (w.mode === "blinking") return `${w.start}–${w.end} blinking (no control)`;
  if (w.mode !== "timed" || w.cycle_s === null) return `${w.start}–${w.end} unreadable`;
  return `${w.start}–${w.end} phases [${w.phases.map((p) => (p === null ? "?" : p)).join(", ")}] · C ${w.cycle_s} s`;
}
