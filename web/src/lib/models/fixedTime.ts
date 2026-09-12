import { normalCdf } from "./stats";

/**
 * Explicit fixed-time signal model (docs/METHODOLOGY.md §25–26, §40).
 *   s(t) = (t − O) mod C,  green(t) = 1{ s(t) ∈ ∪ [g_start, g_end) }
 * Observation noise: P(no_stop | green) = p_g, P(no_stop | red) = p_r with p_g > p_r.
 */
export interface FixedTimeParams {
  C: number;
  O: number;
  green_intervals: [number, number][];
  p_g: number;
  p_r: number;
}

export function phasePosition(t: number, p: FixedTimeParams): number {
  return (((t - p.O) % p.C) + p.C) % p.C;
}

export function isGreen(t: number, p: FixedTimeParams): boolean {
  const s = phasePosition(t, p);
  return p.green_intervals.some(([a, b]) => s >= a && s < b);
}

/** P(no stop | arrival at exactly t). */
export function pNoStopAt(t: number, p: FixedTimeParams): number {
  return isGreen(t, p) ? p.p_g : p.p_r;
}

/**
 * Arrival-time uncertainty integration: T ~ Normal(μ, σ²),
 *   P_green_arrival = ∫ P_green(t) f_T(t) dt, evaluated numerically over one cycle on a 0.5 s grid.
 */
export function pGreenWithUncertainty(μ: number, σ: number, p: FixedTimeParams): number {
  if (σ < 0.5) return isGreen(μ, p) ? 1 : 0;
  const step = 0.5;
  let acc = 0;
  const lo = μ - 4 * σ;
  const hi = μ + 4 * σ;
  let prevCdf = normalCdf((lo - μ) / σ);
  for (let t = lo + step; t <= hi; t += step) {
    const cdf = normalCdf((t - μ) / σ);
    acc += (cdf - prevCdf) * (isGreen(t - step / 2, p) ? 1 : 0);
    prevCdf = cdf;
  }
  return acc;
}

/** Expected wait to next green start if arriving at t (0 if green). */
export function expectedWaitAt(t: number, p: FixedTimeParams): number {
  const s = phasePosition(t, p);
  if (isGreen(t, p)) return 0;
  let best = Infinity;
  for (const [a] of p.green_intervals) {
    const d = ((a - s) % p.C + p.C) % p.C;
    best = Math.min(best, d);
  }
  return Number.isFinite(best) ? best : 0;
}
