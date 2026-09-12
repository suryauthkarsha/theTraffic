import type { Intersection } from "@/lib/data/types";
import type { Decisions } from "@/lib/store/reviewDecisions";

import { COVERAGE_META, COVERAGE_ORDER, type CoverageCategory, type CoverageContext, type CoverageSummary } from "./types";

export { COVERAGE_META, COVERAGE_ORDER };
export type { CoverageCategory, CoverageContext, CoverageSummary };

/** Control regime known from OSM tags or a review label (accepted documents are covered by their own category). */
export function controlTypeKnown(i: Intersection, decisions: Decisions | null): boolean {
  const override = decisions?.controlType[i.id]?.control_type;
  if (override && override !== "unknown") return true;
  return i.control_type !== "unknown";
}

/** Cluster we cannot vouch for: unresolved topology or rejected by a reviewer as "not a signalised junction". */
export function clusterUnknown(i: Intersection, decisions: Decisions | null): boolean {
  if (decisions?.clusters[i.id]?.decision === "rejected") return true;
  return i.intersection_type === "unresolved";
}

/**
 * Category of one intersection, in priority order (see types.ts). `verifiedPlans` must contain
 * links accepted in the committed review file only; `candidatePlans` the plausible, un-reviewed, un-rejected ones.
 */
export function coverageCategory(i: Intersection, ctx: Pick<CoverageContext, "verifiedPlans" | "candidatePlans" | "liveCoverage" | "decisions">): CoverageCategory {
  if (ctx.liveCoverage.has(i.id)) return "live_timing";
  if ((ctx.verifiedPlans.get(i.id)?.length ?? 0) > 0) return "verified_published";
  if ((ctx.candidatePlans.get(i.id)?.length ?? 0) > 0) return "published_awaiting_review";
  if (controlTypeKnown(i, ctx.decisions)) return "control_type_known";
  if (clusterUnknown(i, ctx.decisions)) return "unknown";
  return "location_only";
}

function emptyCounts(): Record<CoverageCategory, number> {
  return Object.fromEntries(COVERAGE_ORDER.map((c) => [c, 0])) as Record<CoverageCategory, number>;
}

/** The six category counts plus the headline figures the UI must always distinguish. */
export function coverageSummary(ctx: CoverageContext): CoverageSummary {
  const by = emptyCounts();
  let verified = 0;
  let live = 0;
  let approaches = 0;
  for (const i of ctx.intersections) {
    by[coverageCategory(i, ctx)]++;
    approaches += i.approaches.length;
    if ((ctx.verifiedPlans.get(i.id)?.length ?? 0) > 0) verified++;
    if (ctx.liveCoverage.has(i.id)) live++;
  }
  const withTiming = COVERAGE_ORDER.filter((c) => COVERAGE_META[c].timing_data).reduce((s, c) => s + by[c], 0);
  return {
    mapped: ctx.intersections.length,
    by_category: by,
    with_timing_data: withTiming,
    verified_published: verified,
    live_timing: live,
    location_only: by.location_only,
    approaches,
    computed_at: ctx.now,
  };
}

/** Summary when nothing has loaded: every intersection is Unknown, not "untimed". */
export function unknownSummary(mapped: number, approaches: number, now: number = Date.now()): CoverageSummary {
  const by = emptyCounts();
  by.unknown = mapped;
  return { mapped, by_category: by, with_timing_data: 0, verified_published: 0, live_timing: 0, location_only: 0, approaches, computed_at: now };
}
