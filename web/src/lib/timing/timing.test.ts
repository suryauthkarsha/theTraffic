import { describe, expect, it } from "vitest";

import { candidatePlanIndex, effectivePlanStatus, plansForIntersection, verifiedPlanIndex } from "@/lib/data/dataset";
import type { Intersection, PublishedDataset, PublishedJunction, PublishedSource } from "@/lib/data/types";
import type { Decisions } from "@/lib/store/reviewDecisions";

import { claimsForIntersection } from "./claims";
import { coverageCategory, coverageSummary, unknownSummary } from "./coverage";
import { documentCurrency, liveCurrency, parseDocumentDate } from "./currency";
import { configuredLiveProvider, EMPTY_LIVE, isFresh } from "./live";
import { detectConflicts, detectDuplicates, isWeakMatch, staleSources, supersededBy, timingSignature } from "./quality";
import type { CoverageContext } from "./types";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0); // 2026-09-06T12:00Z
const EMPTY_DECISIONS: Decisions = { plans: {}, clusters: {}, controlType: {}, approachPhase: {}, approaches: {} };

const window = (start: string, end: string, phases: number[], cycle: number, mode: "timed" | "blinking" = "timed") => ({
  start,
  end,
  mode,
  phases,
  alternates: phases.map(() => null),
  cycle_s: mode === "timed" ? cycle : null,
  cycle_source: mode === "timed" ? ("stated_in_row" as const) : null,
  consistent: mode === "timed" ? true : null,
  pedestrian_phase_s: mode === "timed" ? phases[phases.length - 1] : null,
  flags: [],
});

const W1 = [window("07:00", "11:00", [40, 20, 30, 10], 100), window("11:00", "22:00", [50, 20, 30, 10], 110)];
const W2 = [window("07:00", "11:00", [45, 20, 30, 10], 105), window("11:00", "22:00", [50, 20, 30, 10], 110)];

function junction(key: string, name: string, windows: ReturnType<typeof window>[], opts: Partial<PublishedJunction> & { tier?: PublishedJunction["match"]["tier"]; target?: string | null; combined?: number } = {}): PublishedJunction {
  const { tier = "strong", target = "gw-a", combined = 0.9, ...rest } = opts;
  const best = target ? { intersection_id: target, canonical_name: target, lat: 12.9, lon: 77.6, name_similarity: 0.8, road_similarity: 0.7, score: 0.8, distance_m: 10, combined } : null;
  const passed = tier === "strong";
  return {
    junction_key: key,
    source_id: key.split("#")[0],
    panel_index: 0,
    original_junction_name: name,
    police_station: "TEST",
    control_label_in_document: "FIXED",
    control_type_hint: "fixed",
    road_descriptor: "A RD X B RD",
    approach_landmarks: [],
    phase_count: 4,
    pedestrian_phase_index: 3,
    phase_labels: ["A·LS", "B·LSR", "C·LSR", "pedestrian (EXCLUSIVE)"],
    approach_rows: [],
    movement_matrix_confidence: 1,
    parse_confidence: 0.95,
    parse_confidence_components: {},
    day_plans: [{ day_type: "weekday_default", windows, windows_ordered: true }],
    match: { candidates: best ? [best] : [], best, second_best_combined: 0.2, tier, geocode: null, descriptor_roads: ["A RD", "B RD"] },
    verification: { status: passed ? "rule_set_passed" : "needs_review", score: passed ? 1 : 0.5, criteria: {}, blocking: passed ? [] : ["match_strong"], rule_set: "v1", complete_windows: 2, timed_windows: 2 },
    review: { status: passed ? "pre_validated" : "pending_review", rule_set: "v1", rule_set_passed: passed, blocking: passed ? [] : ["match_strong"], proposed_intersection_id: tier === "strong" || tier === "moderate" ? target : null, requires_explicit_review_decision: true, affects_recommendations: false },
    document_date: "2010-03-17",
    published_at: "2025-11-25T11:57:06",
    retrieved_at: "2026-09-06T02:31:00Z",
    document_currency: { status: "stale", effective_date: "2010-03-17", effective_date_source: "pdf_metadata", age_days: 6017, rule: "currency-v1" },
    quality_flags: ["stale_document"],
    duplicate_of: null,
    conflicts_with: [],
    review_priority: 0.9,
    corridor_importance: 4,
    notes: "",
    ...rest,
  };
}

function source(id: string, junctions: PublishedJunction[]): PublishedSource {
  return {
    source_id: id,
    source_type: "published_timing_plan",
    source_kind: "published",
    source_name: `Bengaluru City Traffic Police, Signal Timings Data - ${id}`,
    publisher: "Bengaluru Traffic Police (BTP)",
    portal: "OpenCity (data.opencity.in)",
    dataset_url: "https://data.opencity.in/dataset/bengaluru-city-traffic-signal-data",
    source_reference: `https://data.opencity.in/${id}.pdf`,
    resource_page: `https://data.opencity.in/resource/${id}`,
    format: "PDF",
    published_at: "2025-11-25T11:57:06",
    portal_last_modified: null,
    document_date: "2010-03-17",
    document_metadata: null,
    document_currency: null,
    retrieved_at: "2026-09-06T02:31:00Z",
    license_notes: "not stated",
    extraction_method: "test",
    junctions,
    parse_status: "ok",
  };
}

function dataset(sources: PublishedSource[]): PublishedDataset {
  return { meta: {} as PublishedDataset["meta"], sources };
}

function intersection(id: string, extra: Partial<Intersection> = {}): Intersection {
  return {
    id,
    canonical_name: id,
    lat: 12.9,
    lon: 77.6,
    intersection_type: "junction",
    control_type: "unknown",
    control_type_source: "none",
    osm_node_ids: [1],
    node_count: 1,
    spread_m: 0,
    cluster_confidence: 0.9,
    score_components: {},
    review_needed: false,
    verified: false,
    road_names: [],
    osm_tags: {},
    approaches: [],
    ...extra,
  };
}

function ctx(inters: Intersection[], data: PublishedDataset, decisions: Decisions, live: Set<string> = new Set()): CoverageContext {
  return {
    intersections: inters,
    verifiedPlans: verifiedPlanIndex(data, decisions),
    candidatePlans: candidatePlanIndex(data, decisions),
    liveCoverage: live,
    liveStates: new Map(),
    decisions,
    historical: undefined,
    now: NOW,
  };
}

const verifiedDecision = (intersectionId: string): Decisions["plans"][string] => ({ decision: "accepted", intersection_id: intersectionId, at: NOW - 86_400_000, by: "test review decision" });

// ---------------------------------------------------------------------------------------------
describe("currency-v1", () => {
  it("classifies by age from the document date, falling back to the portal date", () => {
    expect(documentCurrency("2026-08-01", null, NOW).status).toBe("current");
    expect(documentCurrency("2026-01-01", null, NOW).status).toBe("aging");
    expect(documentCurrency("2010-03-17", "2025-11-25", NOW).status).toBe("stale");
    expect(documentCurrency(null, "2025-11-25", NOW)).toMatchObject({ status: "aging", effective_date_source: "portal" });
    expect(documentCurrency(null, null, NOW).status).toBe("undated");
  });
  it("never calls a historical document current and labels it as evidence", () => {
    const c = documentCurrency("2024-12", null, NOW, "historical");
    expect(c.status).toBe("historical");
    expect(c.label).toMatch(/never a current timing/);
    expect(parseDocumentDate("2024-12")).toBe(Date.UTC(2024, 11, 1));
  });
  it("prints the document date and age in the label", () => {
    const c = documentCurrency("2010-03-17", "2025-11-25", NOW);
    expect(c.label).toMatch(/Stale — dated 17 Mar 2010, 16 y old/);
  });
  it("judges live samples by freshness in seconds", () => {
    expect(liveCurrency(NOW - 10_000, NOW).status).toBe("live");
    expect(liveCurrency(NOW - 120_000, NOW).status).toBe("stale");
  });
});

describe("explicit review-decision gate", () => {
  const j = junction("d1#0", "ADUGODI", W1);
  const data = dataset([source("d1", [j])]);

  it("a block that passes rule set v1 is pre-validated, not verified", () => {
    const eff = effectivePlanStatus(j, EMPTY_DECISIONS);
    expect(eff.status).toBe("candidate");
    expect(eff.pre_validated).toBe(true);
    expect(verifiedPlanIndex(data, EMPTY_DECISIONS).size).toBe(0);
    expect(candidatePlanIndex(data, EMPTY_DECISIONS).get("gw-a")?.[0].pre_validated).toBe(true);
  });
  it("legacy verified_auto output is also treated as awaiting review", () => {
    const legacy = { ...j, verification: { ...j.verification, status: "verified_auto" as unknown as "rule_set_passed" }, review: undefined as unknown as PublishedJunction["review"] };
    expect(effectivePlanStatus(legacy, EMPTY_DECISIONS).status).toBe("candidate");
  });
  it("only an explicit accepted decision links a plan into predictions", () => {
    const decisions: Decisions = { ...EMPTY_DECISIONS, plans: { "d1#0": verifiedDecision("gw-a") } };
    const v = verifiedPlanIndex(data, decisions);
    expect(v.get("gw-a")?.[0]).toMatchObject({ status: "verified", verified_by: "test review decision" });
    expect(candidatePlanIndex(data, decisions).size).toBe(0);
    expect(plansForIntersection(data, decisions, "gw-a")[0].status).toBe("verified");
  });
  it("rejected blocks disappear from every index", () => {
    const decisions: Decisions = { ...EMPTY_DECISIONS, plans: { "d1#0": { decision: "rejected", intersection_id: null, at: NOW, by: "r" } } };
    expect(verifiedPlanIndex(data, decisions).size).toBe(0);
    expect(candidatePlanIndex(data, decisions).size).toBe(0);
    expect(plansForIntersection(data, decisions, "gw-a")).toHaveLength(0);
  });
});

describe("coverage categories", () => {
  const verified = junction("d1#0", "ADUGODI", W1, { target: "gw-verified" });
  const pending = junction("d2#0", "SILK BOARD", W2, { target: "gw-pending", tier: "moderate" });
  const data = dataset([source("d1", [verified]), source("d2", [pending])]);
  const decisions: Decisions = { ...EMPTY_DECISIONS, plans: { "d1#0": verifiedDecision("gw-verified") }, controlType: { "gw-ctl": { control_type: "fixed", at: NOW, by: "r" } }, clusters: { "gw-rejected": { decision: "rejected", at: NOW, by: "r" } } };
  const inters = [
    intersection("gw-live"),
    intersection("gw-verified"),
    intersection("gw-pending"),
    intersection("gw-ctl"),
    intersection("gw-osmctl", { control_type: "fixed", control_type_source: "osm" }),
    intersection("gw-loc"),
    intersection("gw-unresolved", { intersection_type: "unresolved" }),
    intersection("gw-rejected"),
  ];
  const c = ctx(inters, data, decisions, new Set(["gw-live"]));

  it("assigns one category per intersection in priority order", () => {
    expect(coverageCategory(inters[0], c)).toBe("live_timing");
    expect(coverageCategory(inters[1], c)).toBe("verified_published");
    expect(coverageCategory(inters[2], c)).toBe("published_awaiting_review");
    expect(coverageCategory(inters[3], c)).toBe("control_type_known");
    expect(coverageCategory(inters[4], c)).toBe("control_type_known");
    expect(coverageCategory(inters[5], c)).toBe("location_only");
    expect(coverageCategory(inters[6], c)).toBe("unknown");
    expect(coverageCategory(inters[7], c)).toBe("unknown");
  });
  it("produces the headline figures the UI must distinguish", () => {
    const s = coverageSummary(c);
    expect(s.mapped).toBe(8);
    expect(s.with_timing_data).toBe(3); // live + verified + awaiting review
    expect(s.verified_published).toBe(1);
    expect(s.live_timing).toBe(1);
    expect(s.location_only).toBe(1);
    expect(s.by_category.unknown).toBe(2);
  });
  it("reports everything as Unknown, never 'untimed', before datasets load", () => {
    const s = unknownSummary(579, 1586, NOW);
    expect(s.by_category.unknown).toBe(579);
    expect(s.location_only).toBe(0);
    expect(s.with_timing_data).toBe(0);
  });
  it("has no category for recorded drives: the site shows published and OSM data only", () => {
    expect(Object.keys(c)).not.toContain("encounterCount");
    expect(coverageCategory(intersection("gw-verified"), c)).toBe("verified_published");
  });
});

describe("timing claims carry full provenance", () => {
  const verified = junction("d1#0", "ADUGODI", W1, { target: "gw-a" });
  const pending = junction("d2#0", "ADUGODI CIRCLE", W2, { target: "gw-a", tier: "moderate", combined: 0.6 });
  const data = dataset([source("d1", [verified]), source("d2", [pending])]);
  const decisions: Decisions = { ...EMPTY_DECISIONS, plans: { "d1#0": verifiedDecision("gw-a") } };
  const inter = intersection("gw-a");
  const c = ctx([inter], data, decisions);
  // Wednesday 2026-09-09 09:00 IST
  const at = Date.UTC(2026, 8, 9, 3, 30, 0);
  const claims = claimsForIntersection(c, "gw-a", at);

  it("orders accepted published → awaiting review and only the accepted one affects recommendations", () => {
    expect(claims.map((x) => x.kind)).toEqual(["published", "published"]);
    expect(claims[0].verification.status).toBe("verified");
    expect(claims[0].affects_recommendations).toBe(true);
    expect(claims[1].verification.status).toBe("awaiting_review");
    expect(claims[1].affects_recommendations).toBe(false);
  });
  it("shows source, junction, applicable window, dates and stale status", () => {
    const k = claims[0];
    expect(k.source.publisher).toBe("Bengaluru Traffic Police (BTP)");
    expect(k.source.url).toMatch(/^https:\/\//);
    expect(k.junction_label).toBe("ADUGODI");
    expect(k.applicable_window).toMatchObject({ start: "07:00", end: "11:00", cycle_s: 100, pedestrian_phase_s: 10 });
    expect(k.document_date).toBe("2010-03-17");
    expect(k.published_at).toBe("2025-11-25T11:57:06");
    expect(k.retrieved_at).toBe("2026-09-06T02:31:00Z");
    expect(k.currency.status).toBe("stale");
    expect(k.quality_flags).toContain("stale_document");
    expect(k.summary).toMatch(/2 windows · C 100–110 s · 4 phase columns · pedestrian stage 10 s/);
  });
  it("reports when the arrival is outside every published window", () => {
    const night = claimsForIntersection(c, "gw-a", Date.UTC(2026, 8, 9, 20, 30, 0)); // 02:00 IST
    expect(night[0].applicable_window).toBeNull();
    expect(night[0].applicable_note).toMatch(/Outside every published window/);
  });
});

describe("quality checks", () => {
  it("detects duplicate blocks (same junction + police station, identical timings)", () => {
    const a = junction("d1#0", "ADUGODI", W1);
    const b = junction("d2#1", "Adugodi Jn", W1);
    const dups = detectDuplicates([a, b]);
    expect(dups.get("d2#1")).toBe("d1#0");
    expect(dups.has("d1#0")).toBe(false);
    expect(timingSignature(a)).toBe(timingSignature(b));
  });
  it("detects conflicting timing plans for one intersection and flags accepted-vs-accepted disagreement", () => {
    const a = junction("d1#0", "ADUGODI", W1, { target: "gw-a" });
    const b = junction("d2#0", "MICO CIRCLE", W2, { target: "gw-a", tier: "moderate" });
    const asCandidates = detectConflicts([a, b], EMPTY_DECISIONS);
    expect(asCandidates.get("gw-a")).toMatchObject({ signatures: 2, among_verified: false, blocks: ["d1#0", "d2#0"] });
    const bothVerified: Decisions = { ...EMPTY_DECISIONS, plans: { "d1#0": verifiedDecision("gw-a"), "d2#0": verifiedDecision("gw-a") } };
    expect(detectConflicts([a, b], bothVerified).get("gw-a")?.among_verified).toBe(true);
    const oneRejected: Decisions = { ...EMPTY_DECISIONS, plans: { "d2#0": { decision: "rejected", intersection_id: null, at: NOW, by: "r" } } };
    expect(detectConflicts([a, b], oneRejected).size).toBe(0);
  });
  it("identical timings are not a conflict and weak matches never create conflicts", () => {
    const a = junction("d1#0", "ADUGODI", W1, { target: "gw-a" });
    const twin = junction("d3#0", "ADUGODI POLICE", W1, { target: "gw-a" });
    expect(detectConflicts([a, twin], EMPTY_DECISIONS).size).toBe(0);
    const weak = junction("d4#0", "SOMEWHERE", W2, { target: "gw-a", tier: "weak", combined: 0.35 });
    expect(isWeakMatch(weak)).toBe(true);
    expect(detectConflicts([a, weak], EMPTY_DECISIONS).size).toBe(0);
  });
  it("flags stale and undated sources at the reference date", () => {
    const stale = staleSources([{ source_id: "s1", document_date: "2010-03-17", published_at: "2025-11-25" }, { source_id: "s2", document_date: null, published_at: null }, { source_id: "s3", document_date: "2026-08-20", published_at: null }], NOW);
    expect(stale.get("s1")).toBe("stale");
    expect(stale.get("s2")).toBe("undated");
    expect(stale.has("s3")).toBe(false);
  });
  it("a newer document with different timings supersedes an older one for the same target", () => {
    const old = junction("d1#0", "ADUGODI", W1, { target: "gw-a", document_date: "2010-03-17" });
    const newer = junction("d5#0", "ADUGODI", W2, { target: "gw-a", document_date: "2018-06-01" });
    expect(supersededBy(old, [old, newer], EMPTY_DECISIONS)).toBe("d5#0");
    expect(supersededBy(newer, [old, newer], EMPTY_DECISIONS)).toBeNull();
  });
});

describe("live timing layer", () => {
  it("has no authorised provider and never claims coverage", () => {
    expect(configuredLiveProvider(undefined)).toBeNull();
    expect(configuredLiveProvider("")).toBeNull();
    expect(configuredLiveProvider("mappls")).toBeNull();
    expect(EMPTY_LIVE.coverage.size).toBe(0);
  });
  it("freshness gate is 30 s", () => {
    const s = { junction_id: "j", intersection_id: "gw-a", approach: null, state: "green" as const, countdown_s: 12, observed_at: NOW - 5_000, received_at: NOW, freshness_s: 5, source: "test", license: "test" };
    expect(isFresh(s, NOW)).toBe(true);
    expect(isFresh({ ...s, observed_at: NOW - 60_000 }, NOW)).toBe(false);
  });
});
