import type { PassageObservation } from "@/lib/models/periodicity";
import { normalSample, rng } from "@/lib/models/stats";

/**
 * SYNTHETIC signal simulator — for verifying estimators only (docs/METHODOLOGY.md §75).
 * Output is tagged `synthetic: true` and MUST NEVER be written to the research store or counted in
 * any research statistic. Used by unit tests and the Methodology page's in-browser harness.
 */
export interface SimulatorConfig {
  cycle_s: number;
  green_s: number;
  offset_s: number;
  /** Mean vehicle arrivals per cycle (Poisson-ish). */
  arrivals_per_cycle: number;
  n_cycles: number;
  /** Probability a vehicle arriving on green still stops (queue not yet discharged). */
  queue_stop_prob: number;
  /** Std-dev of timing noise on stop-line arrival (GPS + clock), seconds. */
  gps_noise_s: number;
  /** Fraction of passages dropped to imitate missing GPS. */
  missing_fraction: number;
  seed: number;
  /** If set, the cycle switches to this value after `plan_change_cycle` cycles (time-of-day plan change). */
  plan_change?: { after_cycle: number; new_cycle_s: number; new_green_s: number } | null;
  /** If true, cycle length is randomised each cycle to imitate adaptive control. */
  adaptive?: boolean;
}

export interface SimulatedPassage extends PassageObservation {
  delay_s: number;
  green_start_event: number | null;
  synthetic: true;
}

export function simulateSignal(cfg: SimulatorConfig): { passages: SimulatedPassage[]; green_starts: { g: number; journey_id: string }[]; synthetic: true } {
  const u = rng(cfg.seed);
  const passages: SimulatedPassage[] = [];
  const greenStarts: { g: number; journey_id: string }[] = [];
  let t0 = cfg.offset_s;
  let C = cfg.cycle_s;
  let G = cfg.green_s;
  let journeyCounter = 0;
  for (let k = 0; k < cfg.n_cycles; k++) {
    if (cfg.plan_change && k === cfg.plan_change.after_cycle) {
      C = cfg.plan_change.new_cycle_s;
      G = cfg.plan_change.new_green_s;
    }
    const thisC = cfg.adaptive ? Math.max(30, C + (u() - 0.5) * 40) : C;
    const greenStart = t0;
    const n = Math.max(0, Math.round(cfg.arrivals_per_cycle + normalSample(u) * Math.sqrt(cfg.arrivals_per_cycle)));
    for (let i = 0; i < n; i++) {
      if (u() < cfg.missing_fraction) continue;
      const arrival = t0 + u() * thisC; // uniform arrivals over the cycle
      const phase = arrival - greenStart;
      const inGreen = phase >= 0 && phase < G;
      let stopped: boolean;
      let delay: number;
      if (inGreen) {
        stopped = u() < cfg.queue_stop_prob;
        delay = stopped ? Math.max(0, 3 + Math.abs(normalSample(u)) * 6) : 0;
      } else {
        stopped = true;
        delay = thisC - phase + Math.abs(normalSample(u)) * 2; // wait until next green + start-up lag
      }
      const jid = `sim-j${journeyCounter++}`;
      passages.push({ t: arrival + normalSample(u) * cfg.gps_noise_s, y: stopped ? 0 : 1, journey_id: jid, delay_s: delay, green_start_event: stopped && !inGreen ? t0 + thisC + Math.abs(normalSample(u)) * 1.5 : null, synthetic: true });
      if (stopped && !inGreen && u() < 0.6) greenStarts.push({ g: t0 + thisC + normalSample(u) * 1.5, journey_id: jid });
    }
    t0 += thisC;
  }
  return { passages: passages.sort((a, b) => a.t - b.t), green_starts: greenStarts, synthetic: true };
}
