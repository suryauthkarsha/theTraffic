import { describe, expect, it } from "vitest";

import { autocorrelationPeaks, bootstrapGreenStarts, circularResidual, fitGreenStarts, scanCycleLength } from "@/lib/models/periodicity";
import { rng } from "@/lib/models/stats";
import { simulateSignal } from "@/lib/simulation/signalSimulator";

/**
 * SYNTHETIC verification of the periodicity estimators (docs §74–75).
 * These tests use the simulator only; no output here is ever persisted.
 */
describe("periodicity estimators (synthetic)", () => {
  it("recovers a 120 s cycle with 17 s offset from green-start events (Huber fit)", () => {
    const sim = simulateSignal({ cycle_s: 120, green_s: 42, offset_s: 17, arrivals_per_cycle: 4, n_cycles: 200, queue_stop_prob: 0.25, gps_noise_s: 2.5, missing_fraction: 0.15, seed: 42 });
    expect(sim.synthetic).toBe(true);
    const fit = fitGreenStarts(sim.green_starts.map((g) => g.g), { Cmin: 60, Cmax: 150 });
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.C - 120)).toBeLessThan(1.0);
    // green start of cycle k is offset + k*C; recovered O is that value mod C
    expect(circularResidual(fit!.O, 17, fit!.C)).toBeLessThan(4);
    expect(fit!.inlier_fraction).toBeGreaterThan(0.7);
  });

  it("recovers a 90 s cycle with a different offset", () => {
    const sim = simulateSignal({ cycle_s: 90, green_s: 35, offset_s: 61, arrivals_per_cycle: 4, n_cycles: 220, queue_stop_prob: 0.2, gps_noise_s: 2, missing_fraction: 0.1, seed: 7 });
    const fit = fitGreenStarts(sim.green_starts.map((g) => g.g), { Cmin: 60, Cmax: 150 });
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.C - 90)).toBeLessThan(1.0);
    expect(circularResidual(fit!.O, 61, fit!.C)).toBeLessThan(4);
  });

  it("Fourier held-out scan finds periodicity for a fixed signal and rejects it for adaptive timing", () => {
    const fixed = simulateSignal({ cycle_s: 120, green_s: 42, offset_s: 17, arrivals_per_cycle: 5, n_cycles: 250, queue_stop_prob: 0.2, gps_noise_s: 2, missing_fraction: 0.1, seed: 11 });
    const scan = scanCycleLength(fixed.passages, { Cmin: 90, Cmax: 150, K: 2 });
    expect(scan.best).not.toBeNull();
    expect(Math.abs(scan.best!.C - 120)).toBeLessThan(1.5);
    expect(scan.improvement).toBeGreaterThan(0.05);

    const adaptive = simulateSignal({ cycle_s: 120, green_s: 42, offset_s: 17, arrivals_per_cycle: 5, n_cycles: 250, queue_stop_prob: 0.2, gps_noise_s: 2, missing_fraction: 0.1, seed: 3, adaptive: true });
    const scanA = scanCycleLength(adaptive.passages, { Cmin: 90, Cmax: 150, K: 2 });
    expect(scanA.improvement).toBeLessThan(scan.improvement);
  });

  it("autocorrelation shows a peak near the true cycle", () => {
    const sim = simulateSignal({ cycle_s: 100, green_s: 40, offset_s: 5, arrivals_per_cycle: 8, n_cycles: 200, queue_stop_prob: 0.15, gps_noise_s: 1.5, missing_fraction: 0.05, seed: 5 });
    const peaks = autocorrelationPeaks(sim.passages, 60, 150);
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks.some((p) => Math.abs(p.lag - 100) <= 2)).toBe(true);
  });

  it("journey-level bootstrap gives a CI that covers the true cycle", () => {
    const sim = simulateSignal({ cycle_s: 120, green_s: 42, offset_s: 17, arrivals_per_cycle: 4, n_cycles: 150, queue_stop_prob: 0.25, gps_noise_s: 2.5, missing_fraction: 0.15, seed: 21 });
    const boot = bootstrapGreenStarts(sim.green_starts, 30, rng(99), { Cmin: 100, Cmax: 140 });
    expect(boot).not.toBeNull();
    expect(boot!.C_ci[0]).toBeLessThanOrEqual(120.6);
    expect(boot!.C_ci[1]).toBeGreaterThanOrEqual(119.4);
  });

  it("returns null with too few green-start events instead of inventing a cycle", () => {
    expect(fitGreenStarts([10, 130, 250])).toBeNull();
  });
});
