/** Model-layer types. Every field with `| null` is UNKNOWN when no defensible estimate exists. */

/**
 * Cold-start levels. A–E follow the methodology (§80); P is the published-plan prior: a verified
 * BTP timing plan gives cycle structure but NO wall-clock synchronisation, so predictions are
 * marginal over arrival phase — informative for route comparison, useless for sub-cycle timing.
 */
export type ColdStartLevel = "A" | "B" | "C" | "D" | "E" | "P";

export type ModelFamily =
  | "none"
  | "kernel_time_of_week"
  | "fixed_time_phase"
  | "fourier_periodic"
  | "zero_inflated_gbm"
  | "published_plan_prior";

/** One derived research observation — the unit of the dataset (docs/METHODOLOGY.md §17–20). */
export interface SignalEncounter {
  id: string;
  journey_id: string;
  intersection_id: string;
  approach_id: string;
  approach_start_time: number; // epoch ms
  predicted_arrival_time: number | null;
  observed_stop_time: number | null;
  movement_resume_time: number | null;
  intersection_cross_time: number;
  stopped: boolean;
  stop_duration_s: number;
  approach_traversal_time_s: number;
  estimated_total_intersection_delay_s: number;
  estimated_signal_delay_s: number | null;
  queue_delay_estimate_s: number | null;
  /** Quality weight q ∈ [0,1] derived from GPS accuracy and sample density. */
  observation_quality: number;
  classification_confidence: number;
  model_prediction_at_time_of_encounter: SignalPrediction | null;
  prediction_model_version: string | null;
  free_flow_source: "empirical_p10" | "cold_start_speed";
  created_at: number;
  /** Always false for real observations; synthetic records never enter the research store. */
  synthetic: false;
  /** Traffic covariates observed near the encounter (point flow sampled during the drive), when any. */
  context?: EncounterContext | null;
}

/** Live-traffic covariates x recorded with an encounter — model inputs, clamped, never truth. */
export interface EncounterContext {
  source: "tomtom_flow" | "tomtom_route_section" | "mapbox_route_congestion";
  /** 1 − current/free-flow speed ∈ [0, 1]. */
  congestion_factor: number | null;
  speed_ratio: number | null;
  current_speed_kmh: number | null;
  free_flow_speed_kmh: number | null;
  confidence: number | null;
  /** Epoch ms when the covariate was sampled (≤ 5 min before the encounter). */
  sampled_at: number;
}

export interface SignalPrediction {
  intersection_id: string;
  approach_id: string | null;
  arrival_time: number; // epoch ms
  level: ColdStartLevel;
  mean_delay_s: number | null;
  median_delay_s: number | null;
  p10_delay_s: number | null;
  p25_delay_s: number | null;
  p75_delay_s: number | null;
  p90_delay_s: number | null;
  p_stop: number | null;
  /** Long-run mean delay for this approach/hour, used for residual (advantage) computation. */
  historical_mean_delay_s: number | null;
  historical_median_delay_s: number | null;
  predictability_score: number | null;
  model_confidence: number; // 0..1
  training_samples: number;
  recent_samples: number;
  model_family: ModelFamily;
  model_version: string;
  last_trained: number | null;
  data_age_s: number | null;
  fixed_cycle_estimate: number | null;
  cycle_confidence_interval: [number, number] | null;
  phase_offset: number | null;
  offset_confidence: number | null;
  published_plan_available: boolean;
  /** Active accepted plan window used for this prediction, when any. */
  plan: PlanContext | null;
  /** Range of E[D] across the candidate vehicle phases when the approach→phase mapping is unknown. */
  delay_range_s: [number, number] | null;
  notes: string[];
}

export interface PlanContext {
  junction_key: string;
  source_id: string;
  source_name: string | null;
  /** The document's own header for the junction. */
  document_junction_name: string | null;
  cycle_s: number;
  /** Vehicle phases (pedestrian-only phase excluded) considered for this approach. */
  candidate_green_s: number[];
  /** Green duration when the approach→phase mapping is known (reviewer-assigned). */
  assigned_green_s: number | null;
  window_start: string;
  window_end: string;
  day_type: string;
  day_assumed: boolean;
  control_type_hint: string;
  cycle_source: string | null;
  /** Portal publication date. */
  published_at: string | null;
  /** Document's own date (PDF metadata). */
  document_date: string | null;
  retrieved_at: string | null;
  /** currency-v1 status/label at prediction time. */
  currency_status: string | null;
  currency_label: string | null;
  verified_by: string | null;
  verified_at: number | null;
  conflicting_verified_plans: boolean;
  /** "none" | "blinking" | "outside_windows" | "timed" */
  mode: string;
  /** True when an offset calibrated from green-start events is in use (Level A). */
  synchronised: boolean;
}

export interface WeightedSample {
  t: number; // epoch ms of arrival at the intersection
  delay_s: number;
  stopped: boolean;
  quality: number;
  journey_id: string;
  /** Congestion covariate at observation time (null when not sampled). */
  congestion?: number | null;
}
