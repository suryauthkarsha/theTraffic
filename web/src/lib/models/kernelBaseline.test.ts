import { describe, expect, it } from "vitest";

import { effectiveSampleSize, hourlySummary, kernelEstimate } from "@/lib/models/kernelBaseline";
import { coldStartLevel, predictSignal, unknownPrediction } from "@/lib/models/predict";
import type { WeightedSample } from "@/lib/models/types";
import type { Intersection } from "@/lib/data/types";

const IST = 5.5 * 3600 * 1000;
/** Epoch ms for a given IST weekday (0=Mon) and hour, in the week of 2026-08-31 (a Monday). */
const at = (dow: number, hour: number, minute = 0): number => Date.UTC(2026, 7, 31 + dow, hour, minute) - IST;

function samplesAt(dow: number, hour: number, n: number, delay: number, stopped: boolean): WeightedSample[] {
  return Array.from({ length: n }, (_, i) => ({ t: at(dow, hour, (i * 7) % 60), delay_s: delay + (i % 3), stopped, quality: 0.9, journey_id: `j${dow}-${hour}-${i}` }));
}

const inter: Intersection = {
  id: "gw-test",
  canonical_name: "Test Jn",
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
};

describe("kernel time-of-week baseline", () => {
  const now = at(6, 23);
  const morning = samplesAt(1, 8, 30, 60, true); // Tuesday 08:xx — heavy delay
  const night = samplesAt(1, 23, 30, 4, false); // Tuesday 23:xx — free flow
  const all = [...morning, ...night];

  it("estimates high delay at 08:00 and low delay at 23:00 on the same weekday", () => {
    const m = kernelEstimate(all, at(1, 8, 30), now);
    const n = kernelEstimate(all, at(1, 23, 30), now);
    expect(m).not.toBeNull();
    expect(n).not.toBeNull();
    expect(m!.mean_delay_s).toBeGreaterThan(50);
    expect(n!.mean_delay_s).toBeLessThan(10);
    expect(m!.p_stop).toBeGreaterThan(0.9);
    expect(n!.p_stop).toBeLessThan(0.1);
  });

  it("treats 23:59 and 00:01 as neighbours (circular time)", () => {
    const lateNight = samplesAt(1, 23, 40, 5, false).map((s, i) => ({ ...s, t: at(1, 23, 55 + (i % 4)) }));
    const est = kernelEstimate(lateNight, at(2, 0, 2), now, { h_day_s: 900, h_week_s: 3 * 86_400, tau_s: 45 * 86_400, min_effective_n: 8, h_congestion: 0.25 });
    expect(est).not.toBeNull();
    expect(est!.mean_delay_s).toBeLessThan(10);
  });

  it("returns null (UNKNOWN) when the effective sample size is too small", () => {
    expect(kernelEstimate(samplesAt(1, 8, 3, 60, true), at(1, 8), now)).toBeNull();
    expect(kernelEstimate([], at(1, 8), now)).toBeNull();
  });

  it("effective sample size is n for equal weights and < n otherwise", () => {
    expect(effectiveSampleSize([1, 1, 1, 1])).toBeCloseTo(4);
    expect(effectiveSampleSize([1, 0.1, 0.1, 0.1])).toBeLessThan(2);
  });

  it("hourly summary leaves cells null below minN", () => {
    const cells = hourlySummary(morning, "weekday", 5);
    expect(cells[8].n).toBe(30);
    expect(cells[8].median_delay_s).not.toBeNull();
    expect(cells[9].median_delay_s).toBeNull();
  });
});

describe("cold-start levels and predictions", () => {
  it("maps encounter counts to levels A–E", () => {
    expect(coldStartLevel(0, false)).toBe("E");
    expect(coldStartLevel(9, false)).toBe("E");
    expect(coldStartLevel(10, false)).toBe("D");
    expect(coldStartLevel(60, false)).toBe("C");
    expect(coldStartLevel(300, false)).toBe("B");
    expect(coldStartLevel(300, true)).toBe("A");
  });

  it("Level E prediction is fully UNKNOWN and says so", () => {
    const p = unknownPrediction({ intersection: inter, approachId: null, encounters: [], arrivalTime: Date.now(), now: Date.now(), plan: null, publishedPlanOnFile: false });
    expect(p.level).toBe("E");
    expect(p.mean_delay_s).toBeNull();
    expect(p.p_stop).toBeNull();
    expect(p.model_family).toBe("none");
    expect(p.model_confidence).toBe(0);
    expect(p.notes[0]).toMatch(/nothing invented|no timing invented/i);
  });

  it("predictSignal with zero encounters and no verified plan never invents a delay", () => {
    const p = predictSignal({ intersection: inter, approachId: "a1", encounters: [], arrivalTime: Date.now(), now: Date.now(), plan: null, publishedPlanOnFile: true });
    expect(p.level).toBe("E");
    expect(p.mean_delay_s).toBeNull();
    expect(p.published_plan_available).toBe(true);
  });
});
