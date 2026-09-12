import { effectivePlanStatus } from "@/lib/data/dataset";
import type { PublishedJunction, PublishedSource } from "@/lib/data/types";
import type { Decisions } from "@/lib/store/reviewDecisions";

import { documentCurrency, type CurrencyStatus } from "./currency";

/**
 * Quality checks over published blocks, computed against the EFFECTIVE reviewer decisions (the
 * ingest computes the same checks against its proposals; reviewers can change targets, so the
 * app recomputes). Mirrors scripts/ingest_opencity_timing.py `quality_pass`.
 */

const STOP = new Set(["junction", "jn", "junc", "road", "rd", "circle", "cross", "the", "and", "of", "signal", "x", "ft", "feet", "main", "mn", "jct"]);

/** Lower-case, punctuation-free, stop-word-free key for junction names (mirror of the ingest's norm()). */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/×/g, " x ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && t.length > 1)
    .join(" ");
}

/** Canonical string of the timed windows — identical documents produce identical signatures. */
export function timingSignature(j: Pick<PublishedJunction, "day_plans">): string {
  const rows = j.day_plans.flatMap((dp) => dp.windows.filter((w) => w.mode === "timed").map((w) => [dp.day_type, w.start, w.end, JSON.stringify(w.phases), w.cycle_s] as const));
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(rows);
}

export function nameKey(j: Pick<PublishedJunction, "original_junction_name" | "police_station">): string {
  return `${normalizeName(j.original_junction_name)}|${normalizeName(j.police_station)}`;
}

/** junction_key → canonical junction_key it duplicates (same junction name + police station, identical timings). */
export function detectDuplicates(junctions: PublishedJunction[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, PublishedJunction[]>();
  for (const j of junctions) groups.set(nameKey(j), [...(groups.get(nameKey(j)) ?? []), j]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.junction_key.localeCompare(b.junction_key));
    const canonical = new Map<string, string>();
    for (const j of group) {
      const sig = timingSignature(j);
      if (sig === "[]") continue;
      const c = canonical.get(sig);
      if (c) out.set(j.junction_key, c);
      else canonical.set(sig, j.junction_key);
    }
  }
  return out;
}

export interface Conflict {
  intersection_id: string;
  /** Blocks (junction_key) pointing at this intersection with mutually different timings. */
  blocks: string[];
  /** Distinct timing signatures involved. */
  signatures: number;
  /** True when two or more ACCEPTED blocks disagree — the predictor is then told to distrust the prior. */
  among_verified: boolean;
  names: string[];
}

/**
 * Conflicting timing plans: different timings for the same effective target. Uses the reviewer's
 * link for accepted blocks and the proposed match (tier strong/moderate) for candidates; rejected
 * blocks and detected duplicates are ignored.
 */
export function detectConflicts(junctions: PublishedJunction[], decisions: Decisions | null): Map<string, Conflict> {
  const dups = detectDuplicates(junctions);
  const byTarget = new Map<string, { j: PublishedJunction; sig: string; verified: boolean }[]>();
  for (const j of junctions) {
    if (dups.has(j.junction_key)) continue;
    const eff = effectivePlanStatus(j, decisions);
    if (eff.status === "rejected") continue;
    const sig = timingSignature(j);
    if (sig === "[]") continue;
    let target: string | null = null;
    if (eff.status === "verified") target = eff.intersection_id;
    else if (j.match.tier === "strong" || j.match.tier === "moderate") target = j.match.best?.intersection_id ?? null;
    if (!target) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), { j, sig, verified: eff.status === "verified" }]);
  }
  const out = new Map<string, Conflict>();
  for (const [target, rows] of byTarget) {
    const sigs = new Set(rows.map((r) => r.sig));
    if (sigs.size < 2) continue;
    const verifiedSigs = new Set(rows.filter((r) => r.verified).map((r) => r.sig));
    out.set(target, { intersection_id: target, blocks: rows.map((r) => r.j.junction_key), signatures: sigs.size, among_verified: verifiedSigs.size > 1, names: Array.from(new Set(rows.map((r) => r.j.original_junction_name))) });
  }
  return out;
}

/** Weak or absent junction match — the block must not be linked without a reviewer looking at the map. */
export function isWeakMatch(j: Pick<PublishedJunction, "match">): boolean {
  return j.match.tier === "weak" || j.match.tier === "none";
}

/** Stale (or undated) documents under currency-v1 at `asOf`. */
export function staleSources(sources: Pick<PublishedSource, "source_id" | "document_date" | "published_at">[], asOf: number = Date.now()): Map<string, CurrencyStatus> {
  const out = new Map<string, CurrencyStatus>();
  for (const s of sources) {
    const c = documentCurrency(s.document_date, s.published_at, asOf);
    if (c.status === "stale" || c.status === "undated") out.set(s.source_id, c.status);
  }
  return out;
}

/**
 * A verified/candidate block is superseded when a NEWER document (later effective date) with
 * different timings targets the same intersection and is not rejected. Returns the newer key.
 */
export function supersededBy(j: PublishedJunction, all: PublishedJunction[], decisions: Decisions | null): string | null {
  const eff = effectivePlanStatus(j, decisions);
  const target = eff.status === "verified" ? eff.intersection_id : j.match.tier === "strong" || j.match.tier === "moderate" ? j.match.best?.intersection_id ?? null : null;
  if (!target) return null;
  const mine = Date.parse(j.document_date ?? j.published_at ?? "") || 0;
  const sig = timingSignature(j);
  let newest: { key: string; t: number } | null = null;
  for (const o of all) {
    if (o.junction_key === j.junction_key) continue;
    const oe = effectivePlanStatus(o, decisions);
    if (oe.status === "rejected") continue;
    const ot = oe.status === "verified" ? oe.intersection_id : o.match.tier === "strong" || o.match.tier === "moderate" ? o.match.best?.intersection_id ?? null : null;
    if (ot !== target) continue;
    const t = Date.parse(o.document_date ?? o.published_at ?? "") || 0;
    if (t > mine && timingSignature(o) !== sig && (!newest || t > newest.t)) newest = { key: o.junction_key, t };
  }
  return newest?.key ?? null;
}
