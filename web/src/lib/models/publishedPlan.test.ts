import { describe, expect, it } from "vitest";

import type { Intersection, PublishedJunction } from "@/lib/data/types";
import { rng } from "@/lib/models/stats";

import { predictSignal } from "./predict";
import { dayPlanFor, fitOffsetGivenCycle, marginalUniformEstimate, phaseModelEstimate, uniformDelay, vehiclePhases, windowAt } from "./publishedPlan";

const window = (start: string, end: string, phases: number[], cycle: number, mode: "timed" | "blinking" = "timed") => ({
  start,
  end,
  mode,
  phases: mode === "timed" ? phases : phases.map(() => null),
  alternates: phases.map(() => null),
  cycle_s: mode === "timed" ? cycle : null,
  cycle_source: mode === "timed" ? ("stated_in_row" as const) : null,
  consistent: mode === "timed" ? phases.reduce((a, b) => a + b, 0) === cycle : null,
  flags: [],
});

/** Mirrors the Marathahalli-Bridge-style BTP block: 3 phases incl. a 10–15 s exclusive pedestrian stage. */
const junction: PublishedJunction = {
  junction_key: "test#0",
  source_id: "test",
  panel_index: 0,
  original_junction_name: "TEST",
  police_station: "TEST",
  control_label_in_document: "FIXED",
  control_type_hint: "fixed",
  road_descriptor: "A RD X B RD",
  approach_landmarks: [],
  phase_count: 3,
  pedestrian_phase_index: 2,
  phase_labels: ["A·LS", "B·LSR", "pedestrian (EXCLUSIVE)"],
  approach_rows: [],
  movement_matrix_confidence: 0,
  parse_confidence: 1,
  parse_confidence_components: {},
  day_plans: [
    { day_type: "weekday_default", windows_ordered: true, windows: [window("07:00", "08:00", [75, 70, 10], 155), window("08:00", "11:30", [110, 100, 15], 225), window("11:30", "16:00", [0, 0, 0], 0, "blinking"), window("16:00", "21:30", [110, 100, 15], 225)] },
    { day_type: "sunday", windows_ordered: true, windows: [window("07:00", "23:00", [70, 55, 15], 140)] },
  ],
  match: { candidates: [], best: null, second_best_combined: 0, tier: "strong", geocode: null, descriptor_roads: [] },
  verification: { status: "rule_set_passed", score: 1, criteria: {}, blocking: [], rule_set: "v1", complete_windows: 3, timed_windows: 3 },
  review: { status: "pre_validated", rule_set: "v1", rule_set_passed: true, blocking: [], proposed_intersection_id: "gw-test", requires_explicit_review_decision: true, affects_recommendations: false },
  document_date: "2010-03-17",
  published_at: "2025-11-25T11:57:06Z",
  retrieved_at: "2026-09-06T02:31:00Z",
  document_currency: { status: "stale", effective_date: "2010-03-17", effective_date_source: "pdf_metadata", age_days: 6017, rule: "currency-v1" },
  quality_flags: ["stale_document"],
  duplicate_of: null,
  conflicts_with: [],
  review_priority: 1,
  corridor_importance: 4,
  notes: "",
};

const inter: Intersection = {
  id: "gw-test",
  canonical_name: "Test",
  lat: 12.95,
  lon: 77.65,
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
  approaches: [{ id: "a1", bearing_deg: 0, compass: "N", direction: "northbound", road_name: null, highway: null, movement: "through", movement_source: "default", osm_way_ids: [], source_node_ids: [], maxspeed: null, lanes: null, turn_lanes: null, upstream_geometry: [], verified: false }],
};

/** IST epoch for a given local weekday (0=Mon) and HH:MM in the week of 2026-09-07 (a Monday). */
const ist = (dow: number, hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 8, 7 + dow, h, m, 0) - 5.5 * 3600 * 1000;
};

describe("uniform-arrival delay (Webster first term, X = 0)", () => {
  it("matches the closed form for one approach", () => {
    const u = uniformDelay(120, 40); // r = 80
    expect(u.p_stop).toBeCloseTo(80 / 120);
    expect(u.mean).toBeCloseTo((80 * 80) / 240); // 26.67 s
    expect(u.quantile(0.5)).toBeCloseTo(0.5 * 120 - 40); // 20 s
    expect(u.quantile(0.1)).toBe(0); // 10 % < g/C = 1/3 → no wait
  });

  it("marginal over phases is flow-weighted and bounded by the per-phase range", () => {
    const est = marginalUniformEstimate(225, [110, 100]);
    const w1 = 110 / 210;
    const expected = w1 * ((115 * 115) / 450) + (1 - w1) * ((125 * 125) / 450);
    expect(est.mean_delay_s).toBeCloseTo(expected, 5);
    expect(est.range[0]).toBeLessThanOrEqual(est.mean_delay_s);
    expect(est.range[1]).toBeGreaterThanOrEqual(est.mean_delay_s);
    expect(est.p_stop).toBeCloseTo(w1 * (115 / 225) + (1 - w1) * (125 / 225), 5);
    // mixture quantiles are monotone
    expect(est.quantiles.p10).toBeLessThanOrEqual(est.quantiles.p50);
    expect(est.quantiles.p50).toBeLessThanOrEqual(est.quantiles.p90);
  });

  it("an assigned approach phase collapses the marginal to that phase", () => {
    const est = marginalUniformEstimate(225, [110, 100], 100);
    expect(est.mean_delay_s).toBeCloseTo((125 * 125) / 450, 5);
    expect(est.weights).toEqual([1]);
  });
});

describe("plan windows", () => {
  it("removes the exclusive pedestrian phase from vehicle candidates", () => {
    expect(vehiclePhases(junction, junction.day_plans[0].windows[1])).toEqual([110, 100]);
  });

  it("selects the window by IST time and the day plan by weekday, assuming weekday only when no Sunday plan exists", () => {
    expect(windowAt(junction, ist(0, "09:15")).window?.cycle_s).toBe(225);
    expect(windowAt(junction, ist(0, "12:00")).mode).toBe("blinking");
    expect(windowAt(junction, ist(0, "23:30")).mode).toBe("outside_windows");
    expect(windowAt(junction, ist(6, "10:00")).window?.cycle_s).toBe(140);
    expect(dayPlanFor(junction, 5).plan?.day_type).toBe("weekday_default"); // Saturday = weekday in BTP tables
    const noSunday = { ...junction, day_plans: [junction.day_plans[0]] };
    const sun = windowAt(noSunday, ist(6, "10:00"));
    expect(sun.assumed).toBe(true);
    expect(sun.window?.cycle_s).toBe(225);
  });
});

describe("Level P prediction", () => {
  const plan = { junction, source_id: "src", published_at: "2023-01-01", approach_phase_index: null };

  it("produces a bounded prior with residual zero against itself and honest notes", () => {
    const p = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: ist(1, "17:00"), now: ist(1, "16:30"), plan, publishedPlanOnFile: true });
    expect(p.level).toBe("P");
    expect(p.model_family).toBe("published_plan_prior");
    expect(p.fixed_cycle_estimate).toBe(225);
    expect(p.mean_delay_s).not.toBeNull();
    expect(p.historical_mean_delay_s).toBe(p.mean_delay_s); // flat within a window → no departure-time advantage
    expect(p.phase_offset).toBeNull();
    expect(p.plan?.synchronised).toBe(false);
    expect(p.delay_range_s![0]).toBeLessThanOrEqual(p.mean_delay_s!);
    expect(p.notes.join(" ")).toMatch(/offset unknown/i);
  });

  it("is UNKNOWN (no invented numbers) in blinking or uncovered windows", () => {
    const blink = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: ist(1, "12:00"), now: ist(1, "11:00"), plan, publishedPlanOnFile: true });
    expect(blink.mean_delay_s).toBeNull();
    expect(blink.plan?.mode).toBe("blinking");
    const night = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: ist(1, "23:45"), now: ist(1, "23:00"), plan, publishedPlanOnFile: true });
    expect(night.mean_delay_s).toBeNull();
    expect(night.plan?.mode).toBe("outside_windows");
  });

  it("time-of-day plan switches change the prior across the departure window", () => {
    const a = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: ist(1, "07:50"), now: ist(1, "07:40"), plan, publishedPlanOnFile: true });
    const b = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: ist(1, "08:10"), now: ist(1, "07:40"), plan, publishedPlanOnFile: true });
    expect(a.fixed_cycle_estimate).toBe(155);
    expect(b.fixed_cycle_estimate).toBe(225);
    expect(a.mean_delay_s).not.toBeCloseTo(b.mean_delay_s!, 0);
  });
});

describe("offset calibration with a known cycle (Level A path)", () => {
  it("recovers O from noisy green starts and rejects when too few", () => {
    const C = 120;
    const O = 37;
    const u = rng(11);
    const events = Array.from({ length: 30 }, (_, i) => O + i * C * 3 + (u() - 0.5) * 4); // 3 cycles apart, ±2 s jitter
    const fit = fitOffsetGivenCycle(events, C);
    expect(fit).not.toBeNull();
    expect(Math.min(Math.abs(fit!.O - O), C - Math.abs(fit!.O - O))).toBeLessThan(2.5);
    expect(fit!.inlier_fraction).toBeGreaterThan(0.9);
    expect(fitOffsetGivenCycle(events.slice(0, 8), C)).toBeNull();
  });

  it("phase model degrades to the uniform prior as arrival uncertainty grows", () => {
    const params = { C: 120, O: 0, green_intervals: [[0, 60]] as [number, number][], p_g: 0.9, p_r: 0.1 };
    const sharp = phaseModelEstimate(30, 2, params); // squarely in green
    expect(sharp.p_stop).toBeLessThan(0.05);
    const blurred = phaseModelEstimate(30, 300, params);
    expect(blurred.p_stop).toBeGreaterThan(0.4);
    expect(blurred.p_stop).toBeLessThan(0.6);
    const uniform = uniformDelay(120, 60);
    expect(Math.abs(blurred.mean_delay_s - uniform.mean)).toBeLessThan(3);
  });
});
