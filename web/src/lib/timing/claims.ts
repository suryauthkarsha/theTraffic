import type { PlanLink } from "@/lib/data/dataset";
import type { HistoricalSource, PlanWindow, PublishedJunction } from "@/lib/data/types";
import { windowAt } from "@/lib/models/publishedPlan";

import { documentCurrency, liveCurrency, type Currency } from "./currency";
import { isFresh, type LiveSignalState } from "./live";
import type { ClaimKind, ClaimVerification, ClaimWindow, CoverageContext, TimingClaim } from "./types";

const KIND_ORDER: Record<ClaimKind, number> = { live: 0, published: 1, historical: 2 };
const VERIFICATION_ORDER: Record<ClaimVerification, number> = { verified: 0, pre_validated: 1, awaiting_review: 2, deactivated: 3, not_applicable: 4, rejected: 5 };

export function toClaimWindow(dayType: string, w: PlanWindow): ClaimWindow {
  return { day_type: dayType, start: w.start, end: w.end, mode: w.mode, cycle_s: w.cycle_s, phases: w.phases, pedestrian_phase_s: w.pedestrian_phase_s ?? null, consistent: w.consistent };
}

export function planWindows(j: PublishedJunction): ClaimWindow[] {
  return j.day_plans.flatMap((dp) => dp.windows.map((w) => toClaimWindow(dp.day_type, w)));
}

/** "5 windows · C 98–190 s · 4 phases · pedestrian stage 10 s" */
export function summarisePlan(j: PublishedJunction): string {
  const timed = j.day_plans.flatMap((dp) => dp.windows.filter((w) => w.mode === "timed" && w.cycle_s !== null));
  const cycles = timed.map((w) => w.cycle_s as number);
  const parts = [`${j.day_plans.reduce((s, dp) => s + dp.windows.length, 0)} window${j.day_plans.reduce((s, dp) => s + dp.windows.length, 0) === 1 ? "" : "s"}`];
  if (cycles.length) {
    const lo = Math.min(...cycles);
    const hi = Math.max(...cycles);
    parts.push(lo === hi ? `C ${lo} s` : `C ${lo}–${hi} s`);
  }
  if (j.phase_count) parts.push(`${j.phase_count} phase columns`);
  const ped = timed.map((w) => w.pedestrian_phase_s ?? null).filter((p): p is number => p !== null);
  if (ped.length) parts.push(`pedestrian stage ${Math.min(...ped)}${Math.min(...ped) !== Math.max(...ped) ? `–${Math.max(...ped)}` : ""} s`);
  if (j.day_plans.some((dp) => dp.day_type === "sunday" || dp.day_type === "weekend")) parts.push("separate Sunday plan");
  return parts.join(" · ");
}

function verificationLabel(link: PlanLink): { status: ClaimVerification; label: string } {
  switch (link.status) {
    case "verified":
      return { status: "verified", label: `Accepted review link${link.verified_by ? ` · ${link.verified_by}` : ""}` };
    case "rejected":
      return { status: "rejected", label: "Rejected by reviewer — not this junction" };
    case "deactivated":
      return { status: "deactivated", label: "Deactivated by reviewer — kept on file" };
    default:
      return link.pre_validated ? { status: "pre_validated", label: "Passes rule set v1 — awaiting reviewer confirmation" } : { status: "awaiting_review", label: "Awaiting review" };
  }
}

/** Claim for one published block linked/matched to an intersection, judged at `at` (epoch ms). */
export function publishedClaim(link: PlanLink, intersectionId: string, at: number, now: number): TimingClaim {
  const j = link.junction;
  const s = link.source;
  const active = windowAt(j, at);
  const currency: Currency = documentCurrency(j.document_date ?? s.document_date, j.published_at ?? s.published_at, now);
  const v = verificationLabel(link);
  const applicable = active.window ? toClaimWindow(active.day_type, active.window) : null;
  const applicableNote = active.mode === "none" ? "No readable plan for this day type" : active.mode === "outside_windows" ? "Outside every published window (signals commonly flash overnight)" : active.assumed ? "Weekday plan assumed — no Sunday plan published" : null;
  return {
    id: j.junction_key,
    kind: "published",
    intersection_id: intersectionId,
    source: { id: s.source_id, name: s.source_name.replace("Bengaluru City Traffic Police, Signal Timings Data - ", "BTP timing sheet — "), publisher: s.publisher, portal: s.portal, url: s.source_reference, license: s.license_notes },
    junction_label: j.original_junction_name,
    windows: planWindows(j),
    applicable_window: applicable,
    applicable_note: applicableNote,
    document_date: j.document_date ?? s.document_date,
    published_at: j.published_at ?? s.published_at,
    retrieved_at: j.retrieved_at ?? s.retrieved_at,
    currency,
    verification: { status: v.status, by: link.verified_by, at: link.verified_at, label: v.label },
    match: { tier: link.status === "verified" ? "reviewer-linked" : j.match.tier, score: link.status === "verified" ? null : link.match_score },
    quality_flags: [...(j.quality_flags ?? [])],
    affects_recommendations: link.status === "verified",
    summary: summarisePlan(j),
    control_type_hint: j.control_type_hint,
    page: null,
    quote: null,
    phase_labels: j.phase_labels ?? null,
    parse_confidence: j.parse_confidence ?? null,
    live: null,
  };
}

/** Historical mention (planning / survey document) — evidence only, never a timing. */
export function historicalClaim(src: HistoricalSource, evidenceId: string, intersectionId: string, now: number): TimingClaim | null {
  const e = src.evidence.find((x) => x.id === evidenceId);
  if (!e || !e.match?.best) return null;
  return {
    id: e.id,
    kind: "historical",
    intersection_id: intersectionId,
    source: { id: src.source_id, name: src.title, publisher: src.publisher, portal: src.portal, url: src.source_reference, license: src.license_notes },
    junction_label: e.mention_text,
    windows: null,
    applicable_window: null,
    applicable_note: "No timing values — the document mentions the junction without a cycle or phase table",
    document_date: src.document_date,
    published_at: src.published_at,
    retrieved_at: src.retrieved_at,
    currency: documentCurrency(src.document_date, src.published_at, now, "historical"),
    verification: { status: "not_applicable", by: null, at: null, label: "Historical mention — matched by name, not a timing claim" },
    match: { tier: e.match.tier, score: e.match.best.name_similarity },
    quality_flags: e.match.tier === "moderate" ? ["possible_mention"] : [],
    affects_recommendations: false,
    summary: `${e.claim_type.replace(/_/g, " ")} · page ${e.page}`,
    control_type_hint: null,
    page: e.page,
    quote: e.quote,
    phase_labels: null,
    parse_confidence: null,
    live: null,
  };
}

export function liveClaim(state: LiveSignalState, intersectionId: string, now: number): TimingClaim {
  const fresh = isFresh(state, now);
  return {
    id: `live:${state.source}:${state.junction_id}`,
    kind: "live",
    intersection_id: intersectionId,
    source: { id: state.source, name: state.source, publisher: state.source, portal: null, url: null, license: state.license },
    junction_label: state.junction_id,
    windows: null,
    applicable_window: null,
    applicable_note: state.approach ? `Approach ${state.approach}` : "Junction-wide state",
    document_date: null,
    published_at: null,
    retrieved_at: new Date(state.received_at).toISOString(),
    currency: liveCurrency(state.observed_at, now),
    verification: { status: fresh ? "verified" : "not_applicable", by: state.source, at: state.observed_at, label: fresh ? "Authorised live feed — current state" : "Live sample too old to show as current" },
    match: null,
    quality_flags: fresh ? [] : ["stale_live_sample"],
    affects_recommendations: fresh,
    summary: `${state.state}${state.countdown_s !== null ? ` · ${state.countdown_s} s` : ""}`,
    control_type_hint: null,
    page: null,
    quote: null,
    phase_labels: null,
    parse_confidence: null,
    live: state,
  };
}

/**
 * Every timing claim for an intersection at reference time `at`, ordered live → verified published
 * → pre-validated → awaiting review → historical. Rejected blocks are excluded.
 */
export function claimsForIntersection(ctx: CoverageContext, intersectionId: string, at: number = ctx.now): TimingClaim[] {
  const out: TimingClaim[] = [];
  const live = ctx.liveStates.get(intersectionId);
  if (live) out.push(liveClaim(live, intersectionId, ctx.now));
  for (const l of ctx.verifiedPlans.get(intersectionId) ?? []) out.push(publishedClaim(l, intersectionId, at, ctx.now));
  for (const l of ctx.candidatePlans.get(intersectionId) ?? []) out.push(publishedClaim(l, intersectionId, at, ctx.now));
  for (const src of ctx.historical?.sources ?? []) {
    for (const e of src.evidence) {
      if (e.match?.best?.intersection_id === intersectionId && (e.match.tier === "strong" || e.match.tier === "moderate")) {
        const c = historicalClaim(src, e.id, intersectionId, ctx.now);
        if (c) out.push(c);
      }
    }
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || VERIFICATION_ORDER[a.verification.status] - VERIFICATION_ORDER[b.verification.status] || (b.match?.score ?? 0) - (a.match?.score ?? 0));
}

/** Historical mentions for an intersection (strong + moderate), without building full claims. */
export function historicalMentionCount(ctx: Pick<CoverageContext, "historical">, intersectionId: string): number {
  let n = 0;
  for (const src of ctx.historical?.sources ?? []) for (const e of src.evidence) if (e.match?.best?.intersection_id === intersectionId && (e.match.tier === "strong" || e.match.tier === "moderate")) n++;
  return n;
}
