import type { PlanLink } from "@/lib/data/dataset";
import type { HistoricalDataset, Intersection } from "@/lib/data/types";
import type { Decisions } from "@/lib/store/reviewDecisions";

import type { Currency } from "./currency";
import type { LiveSignalState } from "./live";

/**
 * Timing-coverage categories — mutually exclusive, assigned in this priority order. "Location only"
 * means we know where the signal is and nothing else; "Unknown" means we cannot even assert that
 * (unresolved or reviewer-rejected cluster, or the datasets have not loaded). No intersection is
 * ever called "untimed": absence of a document is not evidence about the signal.
 */
export type CoverageCategory = "live_timing" | "verified_published" | "published_awaiting_review" | "control_type_known" | "location_only" | "unknown";

export const COVERAGE_ORDER: CoverageCategory[] = ["live_timing", "verified_published", "published_awaiting_review", "control_type_known", "location_only", "unknown"];

export interface CoverageMeta {
  id: CoverageCategory;
  /** Plain words, used as the legend key and the badge text. */
  label: string;
  /** Filter-chip form. */
  short: string;
  color: string;
  /** Counts toward "with timing data on file (any status)". */
  timing_data: boolean;
}

export const COVERAGE_META: Record<CoverageCategory, CoverageMeta> = {
  live_timing: { id: "live_timing", label: "Live timing", short: "Live", color: "#FF8A2B", timing_data: true },
  verified_published: { id: "verified_published", label: "Accepted plan", short: "Accepted plan", color: "#FFC48A", timing_data: true },
  published_awaiting_review: { id: "published_awaiting_review", label: "Plan awaiting review", short: "Awaiting review", color: "#C0651C", timing_data: true },
  control_type_known: { id: "control_type_known", label: "Control type known", short: "Control type", color: "#A0561F", timing_data: false },
  location_only: { id: "location_only", label: "Location only", short: "Location", color: "#8A4A18", timing_data: false },
  unknown: { id: "unknown", label: "Unknown", short: "Unknown", color: "#5E3614", timing_data: false },
};

export interface CoverageSummary {
  mapped: number;
  by_category: Record<CoverageCategory, number>;
  /** live + verified + awaiting review (timing data on file, any status). */
  with_timing_data: number;
  /** Intersections with at least one published plan accepted in the committed review file. */
  verified_published: number;
  /** Intersections covered by an authorised live feed. */
  live_timing: number;
  location_only: number;
  approaches: number;
  computed_at: number;
}

/** Everything the coverage and claim builders need; assembled once per render in useSignalModel. */
export interface CoverageContext {
  intersections: Intersection[];
  verifiedPlans: Map<string, PlanLink[]>;
  candidatePlans: Map<string, PlanLink[]>;
  liveCoverage: Set<string>;
  liveStates: Map<string, LiveSignalState>;
  decisions: Decisions;
  historical: HistoricalDataset | undefined;
  now: number;
}

export type ClaimKind = "live" | "published" | "historical";

export type ClaimVerification = "verified" | "pre_validated" | "awaiting_review" | "rejected" | "deactivated" | "not_applicable";

export interface ClaimWindow {
  day_type: string;
  start: string;
  end: string;
  mode: "timed" | "blinking" | "unknown";
  cycle_s: number | null;
  phases: (number | null)[];
  pedestrian_phase_s: number | null;
  consistent: boolean | null;
}

/**
 * One timing claim with full provenance — the unit every Signal Map / intersection / prediction
 * surface renders. Nothing in it is inferred beyond what the source states.
 */
export interface TimingClaim {
  id: string;
  kind: ClaimKind;
  intersection_id: string;
  source: { id: string; name: string; publisher: string; portal: string | null; url: string | null; license: string | null };
  /** The source's own name for the junction (document header, feed junction id, or "this intersection"). */
  junction_label: string;
  windows: ClaimWindow[] | null;
  /** The window that applies at the reference time, when the claim has windows. */
  applicable_window: ClaimWindow | null;
  applicable_note: string | null;
  document_date: string | null;
  published_at: string | null;
  retrieved_at: string | null;
  currency: Currency;
  verification: { status: ClaimVerification; by: string | null; at: number | null; label: string };
  match: { tier: string; score: number | null } | null;
  quality_flags: string[];
  /** True only for published plans accepted in the committed review file (and, one day, authorised live feeds). */
  affects_recommendations: boolean;
  summary: string;
  control_type_hint: string | null;
  page: number | null;
  quote: string | null;
  /** Document approach/phase labels (letters are the document's own). */
  phase_labels: (string | null)[] | null;
  parse_confidence: number | null;
  live: LiveSignalState | null;
}
