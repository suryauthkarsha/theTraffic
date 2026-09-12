import type { Intersection, PublishedJunction } from "@/lib/data/types";
import type { Currency } from "@/lib/timing/currency";

import type { FixedTimeParams } from "./fixedTime";
import { DEFAULT_KERNEL_PARAMS, kernelEstimate } from "./kernelBaseline";
import { assignedGreen, fitOffsetGivenCycle, istClock, marginalUniformEstimate, phaseModelEstimate, vehiclePhases, windowAt } from "./publishedPlan";
import { clip } from "./stats";
import type { ColdStartLevel, PlanContext, SignalEncounter, SignalPrediction, WeightedSample } from "./types";

export const MODEL_VERSION = "kernel-tow v0.1.0";
export const PLAN_MODEL_VERSION = "published-plan-prior v0.3.0";

/** Confidence multipliers for the document's currency (currency-v1): a 2010 sheet is a weak prior. */
export const CURRENCY_CONFIDENCE: Record<Currency["status"], number> = { live: 1, current: 1, aging: 0.85, stale: 0.6, undated: 0.5, historical: 0, superseded: 0.4 };
export const PHASE_MODEL_VERSION = "fixed-time-phase v0.1.0";

/**
 * Cold-start levels (docs/METHODOLOGY.md §80):
 *  A verified current public timing + strong observations   B strong trajectory model (≥ 300 enc.)
 *  C moderate empirical delay model (≥ 60)                  D sparse observations (≥ 10)
 *  P published plan prior (no observations)                 E no data → provider baseline only.
 */
export function coldStartLevel(n: number, verifiedPlan: boolean): ColdStartLevel {
  if (n >= 300 && verifiedPlan) return "A";
  if (n >= 300) return "B";
  if (n >= 60) return "C";
  if (n >= 10) return "D";
  return verifiedPlan ? "P" : "E";
}

export function toWeightedSamples(encounters: SignalEncounter[]): WeightedSample[] {
  return encounters.map((e) => ({
    t: e.intersection_cross_time,
    delay_s: e.estimated_total_intersection_delay_s,
    stopped: e.stopped,
    quality: e.observation_quality,
    journey_id: e.journey_id,
    congestion: e.context?.congestion_factor ?? null,
  }));
}

/**
 * Recent crowd residual (docs/METHODOLOGY.md §34):
 *   R_t = Σ exp(−(t−t_i)/τ_r) q_i clip(r_i) / Σ exp(−(t−t_i)/τ_r) q_i,  D̂_live = D̂_base + λ R_t
 */
export function recentResidual(samples: WeightedSample[], baseline: (t: number) => number | null, now: number, tau_r_s = 1800, lambda = 0.5): { adjustment_s: number; recent_n: number } {
  const window = samples.filter((s) => now - s.t < 3 * tau_r_s * 1000);
  const residuals: { r: number; w: number }[] = [];
  for (const s of window) {
    const b = baseline(s.t);
    if (b === null) continue;
    residuals.push({ r: s.delay_s - b, w: Math.exp(-((now - s.t) / 1000) / tau_r_s) * s.quality });
  }
  if (residuals.length < 3) return { adjustment_s: 0, recent_n: residuals.length };
  const abs = residuals.map((x) => Math.abs(x.r)).sort((a, b) => a - b);
  const p99 = abs[Math.min(abs.length - 1, Math.floor(0.99 * abs.length))];
  const num = residuals.reduce((s, x) => s + x.w * clip(x.r, -p99, p99), 0);
  const den = residuals.reduce((s, x) => s + x.w, 0);
  return { adjustment_s: den > 0 ? lambda * (num / den) : 0, recent_n: residuals.length };
}

export interface VerifiedPlanInput {
  junction: PublishedJunction;
  source_id: string;
  source_name?: string;
  /** Portal publication date. */
  published_at: string | null;
  /** The document's own date (PDF metadata) — what the timings were authored against. */
  document_date?: string | null;
  retrieved_at?: string | null;
  /** Currency under currency-v1 at prediction time. */
  currency?: Currency | null;
  verified_by?: string | null;
  verified_at?: number | null;
  /** Two or more accepted blocks disagree about this intersection's timings. */
  conflicting_verified_plans?: boolean;
  /** Reviewer-assigned phase index for the approach, when known. */
  approach_phase_index: number | null;
}

export interface PredictContext {
  intersection: Intersection;
  approachId: string | null;
  /** Real encounters for this approach (or intersection when approach unknown). */
  encounters: SignalEncounter[];
  arrivalTime: number;
  now: number;
  /** Verified, linked published plan for this intersection (null when none). */
  plan: VerifiedPlanInput | null;
  /** Whether any (even unverified) document is on file, for transparency pills. */
  publishedPlanOnFile: boolean;
  /** Arrival-time uncertainty (s) used by the synchronised phase model; default 45 s. */
  arrivalSigmaS?: number;
  /** Live-traffic covariate at the approach (1 − current/free-flow speed), when sampled. Model input only. */
  congestion?: number | null;
}

function base(ctx: PredictContext, level: ColdStartLevel, notes: string[]): SignalPrediction {
  return {
    intersection_id: ctx.intersection.id,
    approach_id: ctx.approachId,
    arrival_time: ctx.arrivalTime,
    level,
    mean_delay_s: null,
    median_delay_s: null,
    p10_delay_s: null,
    p25_delay_s: null,
    p75_delay_s: null,
    p90_delay_s: null,
    p_stop: null,
    historical_mean_delay_s: null,
    historical_median_delay_s: null,
    predictability_score: null,
    model_confidence: 0,
    training_samples: ctx.encounters.length,
    recent_samples: 0,
    model_family: "none",
    model_version: MODEL_VERSION,
    last_trained: null,
    data_age_s: null,
    fixed_cycle_estimate: null,
    cycle_confidence_interval: null,
    phase_offset: null,
    offset_confidence: null,
    published_plan_available: ctx.publishedPlanOnFile,
    plan: null,
    delay_range_s: null,
    notes,
  };
}

/** UNKNOWN prediction for Level E — the honest default before data exists. */
export function unknownPrediction(ctx: PredictContext, notes: string[] = []): SignalPrediction {
  return base(ctx, "E", ["No empirical encounters and no accepted timing-plan link — provider baseline used, nothing invented.", ...notes]);
}

/** Published-plan prior (Level P): cycle structure known, synchronisation unknown. */
export function planPriorPrediction(ctx: PredictContext, plan: VerifiedPlanInput): SignalPrediction {
  const active = windowAt(plan.junction, ctx.arrivalTime);
  const j = plan.junction;
  const ctxPlan: PlanContext = planContext(plan, active);
  if (active.mode === "blinking") {
    return { ...base(ctx, "P", ["Published plan: signal in blinking mode in this window — no cycle to predict; treated like an uncontrolled junction (unknown delay)."]), plan: ctxPlan, model_family: "published_plan_prior", model_version: PLAN_MODEL_VERSION };
  }
  if (!active.window || active.mode !== "timed") {
    const why = active.mode === "outside_windows" ? "arrival falls outside every published time window (signals commonly flash or switch off overnight)" : "no readable plan for this day type";
    return { ...base(ctx, "P", [`Published plan on file but ${why} — no phase prior applied.`]), plan: ctxPlan, model_family: "published_plan_prior", model_version: PLAN_MODEL_VERSION };
  }
  const greens = vehiclePhases(j, active.window);
  const C = active.window.cycle_s;
  if (!greens || C === null) {
    return { ...base(ctx, "P", ["Published window found but phase cells are incomplete in the document — no prior applied."]), plan: ctxPlan, model_family: "published_plan_prior", model_version: PLAN_MODEL_VERSION };
  }
  const assigned = assignedGreen(active.window, plan.approach_phase_index);
  const est = marginalUniformEstimate(C, greens, assigned);
  if (!Number.isFinite(est.mean_delay_s) || !Number.isFinite(est.p_stop)) {
    return { ...base(ctx, "P", ["Published window has degenerate phase cells — no prior applied."]), plan: ctxPlan, model_family: "published_plan_prior", model_version: PLAN_MODEL_VERSION };
  }
  let confidence = j.control_type_hint === "fixed" ? 0.45 : 0.3;
  if (active.window.cycle_source === "sum_of_phases") confidence *= 0.85;
  if (active.assumed) confidence *= 0.8;
  if (assigned !== null) confidence = Math.min(0.6, confidence + 0.1);
  const currency = plan.currency ?? null;
  if (currency) confidence *= CURRENCY_CONFIDENCE[currency.status];
  if (plan.conflicting_verified_plans) confidence *= 0.7;
  const notes = [
    `Level P: BTP plan with an accepted review link (C = ${C} s, ${greens.length} vehicle phase${greens.length > 1 ? "s" : ""}); offset unknown → uniform arrival phase. Cannot time a departure to this signal; usable for route comparison.`,
    currency && currency.status !== "current" ? `${currency.label}. Used as a weak prior (confidence × ${CURRENCY_CONFIDENCE[currency.status]}).` : "",
    plan.conflicting_verified_plans ? "Two accepted documents disagree about this junction's timings — confidence reduced; one link should be deactivated after review." : "",
    assigned === null ? (plan.approach_phase_index !== null ? "Assigned phase column is not a valid vehicle phase in this window — marginalised instead." : "Approach→phase mapping not recorded: marginalised over vehicle phases (weights ∝ green). The document's own A–D movement matrix is shown for review.") : "Approach phase recorded in the review decision.",
    "Excludes queue/over-saturation delay (no volume data).",
    j.control_type_hint === "vehicle_actuated" ? "Document labels this junction vehicle-actuated: published timings are settings, actual cycle varies." : "",
    active.assumed ? "No Sunday plan published — weekday plan assumed." : "",
  ].filter(Boolean);
  return {
    ...base(ctx, "P", notes),
    mean_delay_s: est.mean_delay_s,
    median_delay_s: est.quantiles.p50,
    p10_delay_s: est.quantiles.p10,
    p25_delay_s: est.quantiles.p25,
    p75_delay_s: est.quantiles.p75,
    p90_delay_s: est.quantiles.p90,
    p_stop: est.p_stop,
    // the prior is time-invariant within a window, so it is its own long-run mean (residual 0 for traffic-aware ETAs)
    historical_mean_delay_s: est.mean_delay_s,
    historical_median_delay_s: est.quantiles.p50,
    model_confidence: confidence,
    model_family: "published_plan_prior",
    model_version: PLAN_MODEL_VERSION,
    last_trained: null,
    fixed_cycle_estimate: C,
    plan: { ...ctxPlan, cycle_s: C, candidate_green_s: greens, assigned_green_s: assigned },
    delay_range_s: est.range,
  };
}

/**
 * Production prediction path — strongest valid model per intersection/approach:
 *   1. synchronised phase model (accepted plan link + calibrated offset from ≥ 12 green starts)   → Level A
 *   2. kernel time-of-week baseline when effective N passes                                   → B / C / D
 *   3. published-plan prior                                                                   → P
 *   4. unknown                                                                                → E
 */
export function predictSignal(ctx: PredictContext): SignalPrediction {
  const samples = toWeightedSamples(ctx.encounters);
  const hasPlan = ctx.plan !== null;
  const level = coldStartLevel(samples.length, hasPlan);

  // 1. synchronised phase model
  if (ctx.plan && samples.length >= 12) {
    const sync = synchronisedPrediction(ctx, ctx.plan);
    if (sync) return sync;
  }

  if (level === "E") return unknownPrediction(ctx);
  if (level === "P") return planPriorPrediction(ctx, ctx.plan!);

  const params = { ...DEFAULT_KERNEL_PARAMS, min_effective_n: level === "D" ? 4 : DEFAULT_KERNEL_PARAMS.min_effective_n };
  const x = { congestion: ctx.congestion ?? null };
  const covariateSamples = x.congestion !== null ? samples.filter((s) => s.congestion !== null && s.congestion !== undefined).length : 0;
  const est = kernelEstimate(samples, ctx.arrivalTime, ctx.now, params, x);
  // "A" is reserved for the synchronised phase model; a kernel estimate with an accepted plan link is "B".
  const kernelLevel: ColdStartLevel = level === "A" ? "B" : level;
  if (!est) {
    if (ctx.plan) {
      const p = planPriorPrediction(ctx, ctx.plan);
      p.notes.unshift(`${samples.length} encounters exist but none close enough in time-of-week; falling back to the published-plan prior.`);
      p.training_samples = samples.length;
      return p;
    }
    return unknownPrediction(ctx, [`${samples.length} encounters exist but none close enough in time-of-week (effective N below threshold).`]);
  }

  const wide = kernelEstimate(samples, ctx.arrivalTime, ctx.now, { ...params, h_day_s: 3600, tau_s: 365 * 86_400 });
  const live = recentResidual(samples, (t) => kernelEstimate(samples, t, ctx.now, params, x)?.mean_delay_s ?? null, ctx.now);
  const lastObs = Math.max(...samples.map((s) => s.t));
  const neffConf = 1 - Math.exp(-est.effective_n / 40);
  const levelCap = kernelLevel === "D" ? 0.35 : kernelLevel === "C" ? 0.6 : 0.85;
  const confidence = Math.min(levelCap, neffConf);
  const planP = ctx.plan ? planPriorPrediction(ctx, ctx.plan) : null;

  const covariateNote = x.congestion !== null ? (covariateSamples > 0 ? `Live-traffic covariate applied: congestion ${(x.congestion * 100).toFixed(0)} % on the approach, weighting ${covariateSamples} of ${samples.length} encounters observed under comparable traffic.` : `Live-traffic covariate available (congestion ${(x.congestion * 100).toFixed(0)} %) but no stored encounter carries one yet — time-of-week estimate unchanged.`) : "";
  return {
    ...base(ctx, kernelLevel, [kernelLevel === "D" ? "Sparse data (Level D): wide intervals, low confidence." : "", covariateNote].filter(Boolean)),
    mean_delay_s: Math.max(0, est.mean_delay_s + live.adjustment_s),
    median_delay_s: est.median_delay_s,
    p10_delay_s: est.p10_delay_s,
    p25_delay_s: est.p25_delay_s,
    p75_delay_s: est.p75_delay_s,
    p90_delay_s: est.p90_delay_s,
    p_stop: est.p_stop,
    historical_mean_delay_s: wide?.mean_delay_s ?? est.mean_delay_s,
    historical_median_delay_s: wide?.median_delay_s ?? est.median_delay_s,
    model_confidence: confidence,
    recent_samples: live.recent_n,
    model_family: "kernel_time_of_week",
    model_version: MODEL_VERSION,
    last_trained: ctx.now,
    data_age_s: Math.max(0, (ctx.now - lastObs) / 1000),
    fixed_cycle_estimate: planP?.fixed_cycle_estimate ?? null,
    plan: planP?.plan ?? null,
  };
}

/** Seconds since the plan window started on the event's own (IST) day — the controller's phase clock. */
function windowRelativeSeconds(t: number, windowStart: string): number {
  const [h, m] = windowStart.split(":").map(Number);
  const s = istClock(t).secondsOfDay - (h * 3600 + (m || 0) * 60);
  return s >= 0 ? s : s + 86_400;
}

/**
 * Level A: the accepted plan's cycle for the arrival window + an offset calibrated from real
 * green-start (movement-resumption) events observed in the same window type and day type within
 * the last 45 days. BTP time-of-day plans restart at the window boundary, so the offset is fitted
 * on the window-relative clock (seconds since window start), not on absolute epoch time — otherwise
 * the phase drifts by (86400 mod C) per day. Requires ≥ 12 events, ≥ 70 % Huber inliers, and the
 * approach's own phase column; degrades to the plan prior when arrival uncertainty σ > C/2.
 */
function synchronisedPrediction(ctx: PredictContext, plan: VerifiedPlanInput): SignalPrediction | null {
  const active = windowAt(plan.junction, ctx.arrivalTime);
  if (!active.window || active.mode !== "timed" || active.window.cycle_s === null) return null;
  const greens = vehiclePhases(plan.junction, active.window);
  if (!greens) return null;
  const assigned = assignedGreen(active.window, plan.approach_phase_index);
  if (assigned === null) return null; // phase model needs the approach's own green interval
  const C = active.window.cycle_s;
  const σ = ctx.arrivalSigmaS ?? 45;
  if (σ > C / 2) return null; // phase information washes out; the uniform prior is the honest answer
  const events = ctx.encounters
    .filter((e) => e.movement_resume_time !== null && ctx.now - e.intersection_cross_time < 45 * 86_400_000)
    .filter((e) => {
      const w = windowAt(plan.junction, e.intersection_cross_time);
      return w.window?.start === active.window!.start && w.day_type === active.day_type;
    })
    .map((e) => windowRelativeSeconds(e.movement_resume_time as number, active.window!.start));
  const fit = fitOffsetGivenCycle(events, C);
  if (!fit) return null;
  const params: FixedTimeParams = { C, O: fit.O, green_intervals: [[0, assigned]], p_g: 0.9, p_r: 0.1 };
  const est = phaseModelEstimate(windowRelativeSeconds(ctx.arrivalTime, active.window.start), σ, params);
  const prior = marginalUniformEstimate(C, greens, assigned);
  return {
    ...base(ctx, "A", [`Level A: offset calibrated from ${fit.n} green-start events (inliers ${(fit.inlier_fraction * 100).toFixed(0)} %); arrival σ = ${σ.toFixed(0)} s.`]),
    mean_delay_s: est.mean_delay_s,
    median_delay_s: null,
    p10_delay_s: est.p10,
    p25_delay_s: null,
    p75_delay_s: null,
    p90_delay_s: est.p90,
    p_stop: est.p_stop,
    historical_mean_delay_s: prior.mean_delay_s,
    historical_median_delay_s: prior.quantiles.p50,
    model_confidence: Math.min(0.85, (0.5 + 0.35 * fit.inlier_fraction) * Math.exp(-2 * (σ / C) ** 2)),
    model_family: "fixed_time_phase",
    model_version: PHASE_MODEL_VERSION,
    last_trained: ctx.now,
    fixed_cycle_estimate: C,
    phase_offset: fit.O,
    offset_confidence: fit.inlier_fraction,
    plan: { ...planContext(plan, active), cycle_s: C, candidate_green_s: greens, assigned_green_s: assigned, mode: "timed", synchronised: true },
    delay_range_s: prior.range,
  };
}

/** Provenance carried on every plan-backed prediction so the UI can print source, dates and currency. */
function planContext(plan: VerifiedPlanInput, active: ReturnType<typeof windowAt>): PlanContext {
  const j = plan.junction;
  return {
    junction_key: j.junction_key,
    source_id: plan.source_id,
    source_name: plan.source_name ?? null,
    document_junction_name: j.original_junction_name,
    cycle_s: active.window?.cycle_s ?? 0,
    candidate_green_s: [],
    assigned_green_s: null,
    window_start: active.window?.start ?? "",
    window_end: active.window?.end ?? "",
    day_type: active.day_type,
    day_assumed: active.assumed,
    control_type_hint: j.control_type_hint,
    cycle_source: active.window?.cycle_source ?? null,
    published_at: plan.published_at,
    document_date: plan.document_date ?? null,
    retrieved_at: plan.retrieved_at ?? null,
    currency_status: plan.currency?.status ?? null,
    currency_label: plan.currency?.label ?? null,
    verified_by: plan.verified_by ?? null,
    verified_at: plan.verified_at ?? null,
    conflicting_verified_plans: plan.conflicting_verified_plans ?? false,
    mode: active.mode,
    synchronised: false,
  };
}
