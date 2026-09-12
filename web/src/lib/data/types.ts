/** Shared domain types for the dataset and models (theTraffic. · Bengaluru). */

export type ControlType = "fixed" | "time_of_day" | "actuated" | "adaptive" | "manual" | "unknown";

export interface Approach {
  id: string;
  bearing_deg: number;
  compass: string;
  direction: string;
  road_name: string | null;
  highway: string | null;
  movement: string;
  movement_source: "default" | "turn_lanes";
  osm_way_ids: number[];
  source_node_ids: number[];
  maxspeed: string | null;
  lanes: string | null;
  turn_lanes: string | null;
  /** [lng,lat] points from ~150 m upstream to the signal node. */
  upstream_geometry: [number, number][];
  verified: boolean;
}

export interface Intersection {
  id: string;
  canonical_name: string;
  lat: number;
  lon: number;
  intersection_type: "junction" | "pedestrian_crossing" | "midblock_or_single_road" | "unresolved";
  control_type: ControlType;
  control_type_source: string;
  osm_node_ids: number[];
  node_count: number;
  spread_m: number;
  cluster_confidence: number;
  score_components: Record<string, number>;
  review_needed: boolean;
  verified: boolean;
  road_names: string[];
  osm_tags: Record<string, string>;
  approaches: Approach[];
  /** Nodes from an external signal list represented by this intersection (within 60 m; geometry untouched). */
  seed_node_ids?: number[];
  /** External list this location-only intersection was added from (no OSM way context; review_needed). */
  seed_source?: string;
}

/** Cross-check of one external traffic-signal list (CSV of OSM nodes) against the master map. */
export interface SeedReconciliation {
  file: string;
  /** ISO date found in the file name, when present. */
  as_of: string | null;
  provider: string;
  rows: number;
  skipped_rows: number;
  /** Rows whose OSM node id is already a source node. */
  present: number;
  moved: { osm_id: number; distance_m: number }[];
  /** Unknown nodes recorded on the nearest intersection within 60 m. */
  attached: { osm_id: number; intersection_id: string; distance_m: number }[];
  /** Unknown nodes added at their own coordinate as location-only intersections. */
  added: { osm_id: number; intersection_id: string; lat: number; lon: number }[];
  tag_differences: number;
  extract_nodes_not_in_file: number;
  bbox: [number, number, number, number] | null;
}

export interface DatasetMeta {
  dataset: string;
  version: string;
  generated_at: string;
  source: {
    provider: string;
    query: string;
    osm_timestamp_base: string;
    retrieved_at: string;
    license: string;
  };
  bbox: [number, number, number, number];
  counts: {
    source_signal_nodes: number;
    ways_touching_signals: number;
    logical_intersections: number;
    approaches: number;
    review_needed: number;
    topology_merges: number;
    by_type: Record<string, number>;
    seed_nodes_attached?: number;
    seed_nodes_added?: number;
  };
  /** One entry per external signal list cross-checked at build time (data/raw/osm/*.csv). */
  reconciliation?: SeedReconciliation[];
  method: Record<string, string>;
}

export interface IntersectionDataset {
  meta: DatasetMeta;
  intersections: Intersection[];
}

/** One time-of-day window of a published BTP plan (ingest v3, layout-aware). */
export interface PlanWindow {
  start: string; // "HH:MM" IST
  end: string; // "HH:MM" IST, "24:00" allowed
  mode: "timed" | "blinking" | "unknown";
  /** Phase durations by column; null where the document cell could not be read. */
  phases: (number | null)[];
  alternates: (number | null)[];
  cycle_s: number | null;
  cycle_source: "stated_in_row" | "sum_of_phases" | null;
  /** true when Σ phases matches the stated cycle within 3 s. */
  consistent: boolean | null;
  /** Duration of the document's exclusive pedestrian stage in this window, when the column was identified. */
  pedestrian_phase_s?: number | null;
  flags: string[];
}

export type DayType = "weekday_default" | "sunday" | "saturday" | "weekend" | "all_days" | "holiday" | "unlabelled_group";

export interface DayPlan {
  day_type: DayType;
  windows: PlanWindow[];
  windows_ordered: boolean;
}

export interface JunctionMatchCandidate {
  intersection_id: string;
  canonical_name: string;
  lat: number;
  lon: number;
  name_similarity: number;
  road_similarity: number;
  score: number;
  distance_m: number | null;
  combined: number;
}

export interface JunctionMatch {
  candidates: JunctionMatchCandidate[];
  best: JunctionMatchCandidate | null;
  second_best_combined: number;
  tier: "strong" | "moderate" | "weak" | "none";
  geocode: { provider: string; lat: number; lon: number; label: string | null; osm: string | null; query: string } | null;
  descriptor_roads: string[];
}

/**
 * Rule-set pre-validation (v1). `rule_set_passed` means the block cleared every explicit criterion;
 * it is still not accepted for prediction; only an explicit committed decision can do that (see dataset.ts).
 */
export interface PlanVerification {
  status: "rule_set_passed" | "needs_review";
  score: number;
  criteria: Record<string, boolean>;
  blocking: string[];
  rule_set: string;
  complete_windows: number;
  timed_windows: number;
}

/** Reviewer-facing state written by the ingest; never `affects_recommendations` on its own. */
export interface PlanReviewState {
  status: "pre_validated" | "pending_review";
  rule_set: string;
  rule_set_passed: boolean;
  blocking: string[];
  proposed_intersection_id: string | null;
  requires_explicit_review_decision: true;
  affects_recommendations: false;
}

/** Currency of a dated document under the explicit rule shared with the ingest (currency-v1). */
export interface DocumentCurrency {
  status: "current" | "aging" | "stale" | "undated";
  effective_date: string | null;
  effective_date_source: "pdf_metadata" | "portal_resource" | null;
  age_days: number | null;
  rule: string;
}

/** The document's own approach row: letter, landmark ("FROM …") and movements per phase column. */
export interface ApproachRow {
  letter: string;
  landmark: string | null;
  /** phase column index (0-based, as string key) → movement letters L/S/R/U. */
  movements_by_phase: Record<string, string[]>;
}

export type QualityFlag = "duplicate" | "conflicting_timings" | "conflicting_target" | "weak_match" | "stale_document" | "undated_document";

export interface PublishedJunction {
  junction_key: string; // `${source_id}#${panel_index}`
  source_id: string;
  panel_index: number;
  original_junction_name: string;
  police_station: string;
  control_label_in_document: string;
  control_type_hint: string;
  road_descriptor: string | null;
  approach_landmarks: string[];
  phase_count: number;
  pedestrian_phase_index: number | null;
  /** Per phase column: the document's approach letters + movements, e.g. "A·LS + D·LS". */
  phase_labels: (string | null)[];
  approach_rows: ApproachRow[];
  movement_matrix_confidence: number;
  day_plans: DayPlan[];
  /** How much of the document the parser read unambiguously (not currency, not match quality). */
  parse_confidence: number;
  parse_confidence_components: Record<string, number>;
  match: JunctionMatch;
  verification: PlanVerification;
  review: PlanReviewState;
  /** Document creation date from PDF metadata (ISO date) — the date the timings were authored. */
  document_date: string | null;
  /** Portal resource date — when the document became public on OpenCity. */
  published_at: string | null;
  retrieved_at: string;
  document_currency: DocumentCurrency;
  quality_flags: QualityFlag[];
  duplicate_of: string | null;
  conflicts_with: string[];
  review_priority: number;
  corridor_importance: number;
  notes: string;
}

export interface PublishedDocumentMetadata {
  creation_date: string | null;
  modification_date: string | null;
  title: string | null;
  creator: string | null;
  producer: string | null;
  page_count: number | null;
  sha256: string | null;
  bytes: number;
  has_text_layer: boolean;
}

export interface PublishedSource {
  source_id: string;
  source_type: string;
  source_kind: "published";
  source_name: string;
  publisher: string;
  portal: string;
  dataset_url: string;
  source_reference: string;
  resource_page: string;
  format: string | null;
  published_at: string | null;
  portal_last_modified: string | null;
  document_date: string | null;
  document_metadata: PublishedDocumentMetadata | null;
  document_currency: DocumentCurrency | null;
  retrieved_at: string;
  license_notes: string;
  extraction_method: string;
  junctions: PublishedJunction[];
  parse_status: string;
}

export interface PublishedDataset {
  meta: {
    dataset: string;
    version: string;
    generated_at: string;
    retrieved_at: string;
    portal_dataset: string;
    portal_dataset_url: string;
    portal_metadata_modified: string;
    publisher: string | null;
    license: string | null;
    counts: {
      sources: number;
      junction_blocks_detected: number;
      timing_rows_detected: number;
      rows_with_stated_cycle: number;
      complete_consistent_rows: number;
      pre_validated: number;
      pending_review: number;
      parse_failures: number;
      image_only_documents: number;
      match_tiers: Record<string, number>;
      document_currency: Record<string, number>;
      document_creation_years: Record<string, number>;
      quality_flags: Record<string, number>;
      blocks_with_movement_matrix: number;
    };
    pre_validation_rule_set: { id: string; role: string; passes_when: string[]; not_recovered: string[] };
    currency_rule: { id: string; effective_date: string; current_max_days: number; aging_max_days: number; statuses: string[]; note: string };
    caveat: string;
  };
  sources: PublishedSource[];
}

// ---------------------------------------------------------------------------------------------
// Historical / planning sources (evidence only) and the source registry
// ---------------------------------------------------------------------------------------------

export interface HistoricalMatch {
  tier: "strong" | "moderate" | "weak" | "none";
  best: { intersection_id: string; canonical_name: string; name_similarity: number; margin: number } | null;
  candidates: { intersection_id: string; canonical_name: string; name_similarity: number }[];
}

export interface HistoricalEvidence {
  id: string;
  page: number;
  mention_text: string;
  quote: string | null;
  claim_type: "qualitative_recommendation" | "observation" | "mention";
  kind: "historical";
  timing_values: null;
  match: HistoricalMatch | null;
}

export interface HistoricalSource {
  source_id: string;
  source_kind: "historical";
  source_type: string;
  title: string;
  publisher: string;
  document_date: string;
  date_precision: "day" | "month" | "year";
  date_evidence: string;
  published_at: string | null;
  retrieved_at: string;
  portal: string;
  source_reference: string;
  sha256: string;
  pages: number;
  text_extract?: string;
  license_notes: string;
  validity: string;
  junction_level_timing_tables_found: false;
  evidence: HistoricalEvidence[];
  city_wide_statements: { page: number; statement_type: string; quote: string | null; kind: "historical" }[];
}

export interface HistoricalDataset {
  meta: { dataset: string; version: string; generated_at: string; retrieved_at: string; method: string; rule: string; counts: Record<string, number> };
  sources: HistoricalSource[];
}

export type SourceClass = "published" | "live" | "historical" | "location";

export interface RegistrySource {
  id: string;
  class: SourceClass;
  name: string;
  publisher: string;
  status: string;
  timing_source: boolean;
  url: string;
  dates: Record<string, string | Record<string, number> | null>;
  counts: Record<string, number>;
  currency?: Record<string, number>;
  public_claim?: { text: string; document: string; date: string; url: string; sha256: string; text_extract?: string };
  license: string;
  note: string;
}

export interface SourceRegistry {
  meta: { dataset: string; version: string; generated_at: string; as_of: string };
  sources: RegistrySource[];
}
