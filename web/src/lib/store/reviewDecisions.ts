/**
 * Reviewer decisions shipped with the app. `/data/review_decisions.v1.json` is committed reviewer
 * output: which published timing blocks have accepted junction links, cluster
 * verdicts, control-type labels and approach → phase assignments. The site only READS it — there is
 * no in-app review, sign-in or upload; a new decision is a new committed JSON.
 */
export type PlanDecision = "accepted" | "rejected" | "deactivated";

export interface PlanDecisionRecord {
  decision: PlanDecision;
  intersection_id: string | null;
  at: number;
  by: string;
  note?: string;
}

export interface ClusterDecisionRecord {
  decision: "verified" | "rejected" | "split" | "merge";
  at: number;
  by: string;
  note?: string;
  /** For `merge`: the other intersection ids merged into this one. For `split`: node-id groups. */
  merge_ids?: string[];
  split_groups?: number[][];
}

export interface ApproachEditRecord {
  bearing_deg?: number;
  road_name?: string | null;
  movement?: string;
  disabled?: boolean;
  at: number;
  by: string;
}

export interface Decisions {
  review_provenance?: string;
  plans: Record<string, PlanDecisionRecord>;
  clusters: Record<string, ClusterDecisionRecord>;
  controlType: Record<string, { control_type: string; at: number; by: string }>;
  /** junction_key → approach_id → phase column index (0-based) for accepted plan links. */
  approachPhase: Record<string, Record<string, number>>;
  approaches: Record<string, ApproachEditRecord>;
}

/** A fresh, empty decision set (never shared — callers may not mutate a shared constant). */
export function emptyDecisions(): Decisions {
  return { plans: {}, clusters: {}, controlType: {}, approachPhase: {}, approaches: {} };
}

/** The committed JSON with every section present, so readers never null-check sections. Pure. */
export function withDefaults(d: Partial<Decisions> | null | undefined): Decisions {
  return { ...emptyDecisions(), ...(d ?? {}) };
}

/** Intersections with at least one accepted plan link. Pure. */
export function verifiedPlanIntersections(d: Decisions): Set<string> {
  const s = new Set<string>();
  for (const v of Object.values(d.plans)) if (v.decision === "accepted" && v.intersection_id) s.add(v.intersection_id);
  return s;
}
