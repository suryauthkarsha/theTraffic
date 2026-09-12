/**
 * Predictability score (docs/METHODOLOGY.md §36) — computed from OUT-OF-SAMPLE performance only.
 *   S = 100 × exp(−e) × stability^0.4 × coverage^0.3 × calibration^0.3,  e = MAE / D_scale
 * Consumer labels are attached in `predictabilityLabel`.
 */
export interface PredictabilityInputs {
  heldout_mae_s: number;
  delay_scale_s: number;
  stability: number; // 0..1
  coverage: number; // 0..1
  calibration: number; // 0..1  (1 − ECE, clipped)
}

export function predictabilityScore(x: PredictabilityInputs): number {
  const e = x.heldout_mae_s / Math.max(1, x.delay_scale_s);
  const s = 100 * Math.exp(-e) * Math.pow(clamp01(x.stability), 0.4) * Math.pow(clamp01(x.coverage), 0.3) * Math.pow(clamp01(x.calibration), 0.3);
  return Math.round(Math.max(0, Math.min(100, s)));
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export type PredictabilityLabel = "Very high" | "High" | "Moderate" | "Low" | "Insufficient";

export function predictabilityLabel(score: number | null): PredictabilityLabel {
  if (score === null) return "Insufficient";
  if (score >= 90) return "Very high";
  if (score >= 75) return "High";
  if (score >= 55) return "Moderate";
  if (score >= 35) return "Low";
  return "Insufficient";
}

/** Consumer confidence badge from model_confidence ∈ [0,1]. */
export function confidenceLabel(c: number | null): "High" | "Moderate" | "Low" | "Insufficient" {
  if (c === null || c < 0.2) return "Insufficient";
  if (c >= 0.75) return "High";
  if (c >= 0.45) return "Moderate";
  return "Low";
}
