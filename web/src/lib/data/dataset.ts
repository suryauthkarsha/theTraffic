import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { GridIndex } from "@/lib/geo";
import type { Decisions } from "@/lib/store/reviewDecisions";

import type { HistoricalDataset, Intersection, IntersectionDataset, PublishedDataset, PublishedJunction, PublishedSource, QualityFlag, SourceRegistry } from "./types";

const INTERSECTIONS_URL = "/data/intersections.v1.json";
const PUBLISHED_URL = "/data/published_timing_plans.v3.json";
const HISTORICAL_URL = "/data/historical_sources.v1.json";
const REGISTRY_URL = "/data/source_registry.v1.json";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Loads the OSM-derived signal master map (static, versioned). */
export function useIntersectionDataset() {
  return useQuery({
    queryKey: ["dataset", "intersections", "v1"],
    queryFn: () => fetchJson<IntersectionDataset>(INTERSECTIONS_URL),
    staleTime: Infinity,
  });
}

/** Loads published BTP timing plans (ingest v3: dated, pre-validated, every block awaiting a reviewer). */
export function usePublishedPlans() {
  return useQuery({
    queryKey: ["dataset", "published-plans", "v3"],
    queryFn: () => fetchJson<PublishedDataset>(PUBLISHED_URL),
    staleTime: Infinity,
  });
}

/** Historical / planning documents (BBMP CTMP 2024, JICA 2015) — evidence only, never timings. */
export function useHistoricalSources() {
  return useQuery({
    queryKey: ["dataset", "historical-sources", "v1"],
    queryFn: () => fetchJson<HistoricalDataset>(HISTORICAL_URL),
    staleTime: Infinity,
  });
}

/** One row per source class (published · live · historical · location) with status and dates. */
export function useSourceRegistry() {
  return useQuery({
    queryKey: ["dataset", "source-registry", "v1"],
    queryFn: () => fetchJson<SourceRegistry>(REGISTRY_URL),
    staleTime: Infinity,
  });
}

export interface PlanLink {
  source: PublishedSource;
  junction: PublishedJunction;
  /** verified internally means an accepted committed link | candidate | rejected | deactivated */
  status: "verified" | "candidate" | "rejected" | "deactivated";
  /** Provenance label for accepted links; null otherwise. */
  verified_by: string | null;
  verified_at: number | null;
  /** Candidate cleared the rule-set pre-validation and sits first in the queue. */
  pre_validated: boolean;
  match_score: number;
  quality_flags: QualityFlag[];
}

export type EffectivePlanStatus = PlanLink["status"];

export interface EffectiveStatus {
  status: EffectivePlanStatus;
  intersection_id: string | null;
  by: string | null;
  at: number | null;
  pre_validated: boolean;
}

/**
 * Effective status of a parsed block. Only an explicit accepted link in the committed decisions file
 * can enter the predictor. The ingest's rule set may pre-validate and propose a link, but it never
 * accepts one or affects predictions on its own.
 */
export function effectivePlanStatus(j: PublishedJunction, decisions: Decisions | null): EffectiveStatus {
  const pre = j.review?.status === "pre_validated" || j.verification?.status === "rule_set_passed";
  const d = decisions?.plans[j.junction_key];
  if (d) {
    if (d.decision === "accepted") return { status: "verified", intersection_id: d.intersection_id, by: d.by, at: d.at, pre_validated: pre };
    return { status: d.decision, intersection_id: d.intersection_id ?? j.review?.proposed_intersection_id ?? null, by: d.by, at: d.at, pre_validated: pre };
  }
  return { status: "candidate", intersection_id: j.review?.proposed_intersection_id ?? j.match.best?.intersection_id ?? null, by: null, at: null, pre_validated: pre };
}

function toLink(source: PublishedSource, junction: PublishedJunction, eff: EffectiveStatus, status: PlanLink["status"], matchScore: number): PlanLink {
  return {
    source,
    junction,
    status,
    verified_by: status === "verified" ? eff.by : null,
    verified_at: status === "verified" ? eff.at : null,
    pre_validated: eff.pre_validated,
    match_score: matchScore,
    quality_flags: junction.quality_flags ?? [],
  };
}

/** Every plan block linked (verified) or plausibly matched (candidate ≥ minScore) to an intersection. */
export function plansForIntersection(data: PublishedDataset | undefined, decisions: Decisions | null, intersectionId: string, minScore = 0.3): PlanLink[] {
  if (!data) return [];
  const out: PlanLink[] = [];
  for (const source of data.sources) {
    for (const junction of source.junctions) {
      const eff = effectivePlanStatus(junction, decisions);
      if (eff.status === "verified" && eff.intersection_id === intersectionId) {
        out.push(toLink(source, junction, eff, "verified", 1));
        continue;
      }
      if (eff.status === "rejected") continue;
      const best = junction.match.best;
      if (best && best.intersection_id === intersectionId && best.combined >= minScore) {
        out.push(toLink(source, junction, eff, eff.status === "deactivated" ? "deactivated" : "candidate", best.combined));
      }
    }
  }
  return out.sort((a, b) => (a.status === "verified" ? -1 : 1) - (b.status === "verified" ? -1 : 1) || Number(b.pre_validated) - Number(a.pre_validated) || b.match_score - a.match_score);
}

/** Map intersection id → plan links accepted in the committed review file. */
export function verifiedPlanIndex(data: PublishedDataset | undefined, decisions: Decisions | null): Map<string, PlanLink[]> {
  const m = new Map<string, PlanLink[]>();
  if (!data) return m;
  for (const source of data.sources) {
    for (const junction of source.junctions) {
      const eff = effectivePlanStatus(junction, decisions);
      if (eff.status !== "verified" || !eff.intersection_id) continue;
      m.set(eff.intersection_id, [...(m.get(eff.intersection_id) ?? []), toLink(source, junction, eff, "verified", 1)]);
    }
  }
  return m;
}

/**
 * Map intersection id → candidate plan links awaiting review (plausible match ≥ minScore, not
 * rejected, not verified). These are "published timing awaiting review": visible, never used.
 */
export function candidatePlanIndex(data: PublishedDataset | undefined, decisions: Decisions | null, minScore = 0.3): Map<string, PlanLink[]> {
  const m = new Map<string, PlanLink[]>();
  if (!data) return m;
  for (const source of data.sources) {
    for (const junction of source.junctions) {
      const eff = effectivePlanStatus(junction, decisions);
      if (eff.status === "verified" || eff.status === "rejected") continue;
      const best = junction.match.best;
      if (!best || best.combined < minScore) continue;
      m.set(best.intersection_id, [...(m.get(best.intersection_id) ?? []), toLink(source, junction, eff, eff.status === "deactivated" ? "deactivated" : "candidate", best.combined)]);
    }
  }
  return m;
}

/** All junction blocks flattened with their source. */
export function allJunctions(data: PublishedDataset | undefined): { source: PublishedSource; junction: PublishedJunction }[] {
  const rows: { source: PublishedSource; junction: PublishedJunction }[] = [];
  for (const s of data?.sources ?? []) for (const j of s.junctions) rows.push({ source: s, junction: j });
  return rows;
}

/** Spatial index over intersections, memoised per dataset instance. */
export function useIntersectionIndex(intersections: Intersection[] | undefined) {
  return useMemo(() => (intersections ? new GridIndex(intersections, 400) : null), [intersections]);
}

export function findIntersection(data: IntersectionDataset | undefined, id: string | undefined): Intersection | undefined {
  if (!data || !id) return undefined;
  return data.intersections.find((i) => i.id === id);
}
