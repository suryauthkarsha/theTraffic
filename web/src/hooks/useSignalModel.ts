import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { candidatePlanIndex, plansForIntersection, useHistoricalSources, usePublishedPlans, verifiedPlanIndex, type PlanLink } from "@/lib/data/dataset";
import type { Intersection } from "@/lib/data/types";
import { predictSignal, type VerifiedPlanInput } from "@/lib/models/predict";
import { marginalUniformEstimate, vehiclePhases } from "@/lib/models/publishedPlan";
import type { SignalPrediction } from "@/lib/models/types";
import { withDefaults, type Decisions } from "@/lib/store/reviewDecisions";
import { claimsForIntersection, coverageCategory, coverageSummary, detectConflicts, documentCurrency, EMPTY_LIVE, unknownSummary, type CoverageCategory, type CoverageContext, type CoverageSummary, type TimingClaim } from "@/lib/timing";

export type Predictor = (intersection: Intersection, approachId: string | null, arrivalTime: number, now?: number, arrivalSigmaS?: number, congestion?: number | null) => SignalPrediction;

const DECISIONS_URL = "/data/review_decisions.v1.json";

/** The committed reviewer decisions; an unreachable file means "no decisions", never an error page. */
async function loadDecisions(): Promise<Decisions> {
  try {
    const res = await fetch(DECISIONS_URL);
    if (!res.ok) return withDefaults(null);
    return withDefaults((await res.json()) as Partial<Decisions>);
  } catch {
    return withDefaults(null);
  }
}

export function useReviewDecisions() {
  return useQuery({ queryKey: ["dataset", "review-decisions", "v1"], queryFn: loadDecisions, staleTime: Infinity });
}

/**
 * Bundles the static datasets — published timing plans, committed reviewer decisions, historical
 * evidence and the (empty) live-timing layer — into one predictor plus a coverage / claims view.
 * Everything downstream (map colours, junction cards, junction pages) goes through `predict`, so the
 * whole site agrees on what a signal is. Only plans accepted in the committed review file reach the predictor; there is
 * no recorded-drive data anywhere in the app.
 */
export function useSignalModel() {
  const plansQ = usePublishedPlans();
  const historicalQ = useHistoricalSources();
  const decisionsQ = useReviewDecisions();

  const decisions = useMemo(() => decisionsQ.data ?? withDefaults(null), [decisionsQ.data]);
  const verifiedPlans = useMemo(() => verifiedPlanIndex(plansQ.data, decisions), [plansQ.data, decisions]);
  const candidatePlans = useMemo(() => candidatePlanIndex(plansQ.data, decisions), [plansQ.data, decisions]);
  const verifiedPlanIntersections = useMemo(() => new Set(verifiedPlans.keys()), [verifiedPlans]);
  const conflicts = useMemo(() => detectConflicts((plansQ.data?.sources ?? []).flatMap((s) => s.junctions), decisions), [plansQ.data, decisions]);

  const planOnFile = useCallback((id: string) => plansForIntersection(plansQ.data, decisions, id).length > 0, [plansQ.data, decisions]);

  const planInputFor = useCallback(
    (intersectionId: string, approachId: string | null): VerifiedPlanInput | null => {
      const links: PlanLink[] | undefined = verifiedPlans.get(intersectionId);
      if (!links?.length) return null;
      // prefer fixed-time documents over vehicle-actuated ones when several are verified
      const link = [...links].sort((a, b) => rank(a) - rank(b))[0];
      const phaseMap = decisions.approachPhase[link.junction.junction_key] ?? {};
      const j = link.junction;
      return {
        junction: j,
        source_id: link.source.source_id,
        source_name: link.source.source_name,
        published_at: j.published_at ?? link.source.published_at,
        document_date: j.document_date ?? link.source.document_date,
        retrieved_at: j.retrieved_at ?? link.source.retrieved_at,
        currency: documentCurrency(j.document_date ?? link.source.document_date, j.published_at ?? link.source.published_at),
        verified_by: link.verified_by,
        verified_at: link.verified_at,
        conflicting_verified_plans: conflicts.get(intersectionId)?.among_verified ?? false,
        approach_phase_index: approachId !== null && phaseMap[approachId] !== undefined ? phaseMap[approachId] : null,
      };
    },
    [verifiedPlans, decisions, conflicts],
  );

  /**
   * Ranking prior for unmodelled signals when comparing routes: the median Level P expected delay
   * across every accepted plan window (a real statistic of the accepted corpus, applied only when
   * ranking routes with uneven coverage; never shown as a per-signal prediction). 0 until plans exist.
   */
  const rankingPrior = useMemo(() => {
    const means: number[] = [];
    const stops: number[] = [];
    for (const links of verifiedPlans.values()) {
      for (const l of links) {
        for (const dp of l.junction.day_plans) {
          for (const w of dp.windows) {
            const greens = vehiclePhases(l.junction, w);
            if (!greens || w.cycle_s === null) continue;
            const est = marginalUniformEstimate(w.cycle_s, greens);
            if (Number.isFinite(est.mean_delay_s)) means.push(est.mean_delay_s);
            if (Number.isFinite(est.p_stop)) stops.push(est.p_stop);
          }
        }
      }
    }
    if (!means.length) return { unknownSignalPriorS: 0, unknownStopPrior: 0 };
    means.sort((a, b) => a - b);
    stops.sort((a, b) => a - b);
    return { unknownSignalPriorS: means[Math.floor(means.length / 2)], unknownStopPrior: stops[Math.floor(stops.length / 2)] };
  }, [verifiedPlans]);

  const predict = useCallback<Predictor>(
    (intersection, approachId, arrivalTime, now = Date.now(), arrivalSigmaS, congestion) =>
      predictSignal({
        intersection,
        approachId,
        encounters: [],
        arrivalTime,
        now,
        plan: planInputFor(intersection.id, approachId),
        publishedPlanOnFile: planOnFile(intersection.id),
        arrivalSigmaS,
        congestion: congestion ?? null,
      }),
    [planInputFor, planOnFile],
  );

  /** Live-timing layer: no authorised provider exists, so coverage is empty and never claimed. */
  const live = EMPTY_LIVE;

  const coverageContextFor = useCallback(
    (intersections: Intersection[], now: number = Date.now()): CoverageContext => ({
      intersections,
      verifiedPlans,
      candidatePlans,
      liveCoverage: live.coverage,
      liveStates: live.states,
      decisions,
      historical: historicalQ.data,
      now,
    }),
    [verifiedPlans, candidatePlans, decisions, historicalQ.data, live],
  );

  const datasetsReady = Boolean(plansQ.data) && !decisionsQ.isLoading;

  /** Category of one intersection (Unknown until the plan dataset and the decisions have loaded). */
  const coverageOf = useCallback(
    (i: Intersection): CoverageCategory => (datasetsReady ? coverageCategory(i, coverageContextFor([i])) : "unknown"),
    [coverageContextFor, datasetsReady],
  );

  /** The six categories + headline figures for a set of intersections. */
  const summarise = useCallback(
    (intersections: Intersection[]): CoverageSummary => (datasetsReady ? coverageSummary(coverageContextFor(intersections)) : unknownSummary(intersections.length, intersections.reduce((s, i) => s + i.approaches.length, 0))),
    [coverageContextFor, datasetsReady],
  );

  /** Every timing claim (published / historical / live) for an intersection at `at`. */
  const claimsFor = useCallback((intersection: Intersection, at: number = Date.now()): TimingClaim[] => claimsForIntersection(coverageContextFor([intersection]), intersection.id, at), [coverageContextFor]);

  return {
    predict,
    plans: plansQ.data,
    historical: historicalQ.data,
    planOnFile,
    verifiedPlans,
    candidatePlans,
    verifiedPlanIntersections,
    conflicts,
    live,
    coverageOf,
    summarise,
    claimsFor,
    datasetsReady,
    rankingPrior,
    decisions,
    isLoading: plansQ.isLoading || decisionsQ.isLoading,
  };
}

function rank(l: PlanLink): number {
  const hint = l.junction.control_type_hint;
  return hint === "fixed" || hint === "fixed_coordinated" ? 0 : hint === "vehicle_actuated" ? 1 : 2;
}
