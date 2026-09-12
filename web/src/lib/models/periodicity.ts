import { huber } from "./stats";

/**
 * Periodicity detection and fixed-time inference (docs/METHODOLOGY.md §23–28).
 *
 * METHOD A — likelihood scan over candidate cycle C with a circular (Fourier) logistic model
 *            logit P(y=1) = β0 + Σ_k a_k cos(kφ) + b_k sin(kφ),  φ = 2π (t mod C)/C
 *            scored on HELD-OUT journeys (never on training fit alone).
 * METHOD C — robust approximate-GCD-style estimator on green-start events:
 *            min_{C,O} Σ ρ_Huber( dist_circular(g_i − O, C) ).
 *
 * Everything here is exercised by the synthetic simulator tests (src/lib/simulation) — synthetic
 * data is used ONLY to verify the estimators and never enters the research store.
 */

export interface PassageObservation {
  /** Arrival time at the stop line, epoch seconds (float). */
  t: number;
  /** 1 = favourable/no-stop passage, 0 = stopped. */
  y: 0 | 1;
  journey_id: string;
  weight?: number;
}

export interface FourierFit {
  C: number;
  K: number;
  beta: number[]; // [β0, a1, b1, a2, b2, ...]
  train_logloss: number;
  heldout_logloss: number;
  heldout_brier: number;
  n_train: number;
  n_test: number;
}

function design(t: number, C: number, K: number): number[] {
  const φ = (2 * Math.PI * (((t % C) + C) % C)) / C;
  const row = [1];
  for (let k = 1; k <= K; k++) row.push(Math.cos(k * φ), Math.sin(k * φ));
  return row;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** L2-regularised logistic regression via Newton iterations (small K → tiny Hessian). */
export function fitLogistic(X: number[][], y: number[], w: number[], l2 = 1e-2, iters = 25): number[] {
  const p = X[0].length;
  let beta = new Array<number>(p).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(p).fill(0);
    const H: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, x, j) => s + x * beta[j], 0);
      const μ = sigmoid(z);
      const r = w[i] * (y[i] - μ);
      const v = w[i] * μ * (1 - μ);
      for (let a = 0; a < p; a++) {
        g[a] += r * X[i][a];
        for (let b = 0; b < p; b++) H[a][b] -= v * X[i][a] * X[i][b];
      }
    }
    for (let a = 1; a < p; a++) {
      g[a] -= l2 * beta[a];
      H[a][a] -= l2;
    }
    const step = solve(H.map((row) => row.map((v) => -v)), g); // Newton: β ← β + (−H)^{-1} g
    let maxStep = 0;
    beta = beta.map((b, j) => {
      maxStep = Math.max(maxStep, Math.abs(step[j]));
      return b + step[j];
    });
    if (maxStep < 1e-6) break;
  }
  return beta;
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function logloss(X: number[][], y: number[], beta: number[]): { ll: number; brier: number } {
  let ll = 0;
  let br = 0;
  for (let i = 0; i < X.length; i++) {
    const μ = Math.min(1 - 1e-6, Math.max(1e-6, sigmoid(X[i].reduce((s, x, j) => s + x * beta[j], 0))));
    ll -= y[i] ? Math.log(μ) : Math.log(1 - μ);
    br += (μ - y[i]) ** 2;
  }
  return { ll: ll / X.length, brier: br / X.length };
}

/** Deterministic journey-level split: ~30 % of journeys held out by hash. */
export function splitByJourney<T extends { journey_id: string }>(obs: T[], heldOutFraction = 0.3): { train: T[]; test: T[] } {
  const ids = Array.from(new Set(obs.map((o) => o.journey_id)));
  const test = new Set(ids.filter((id) => hash(id) % 1000 < heldOutFraction * 1000));
  return { train: obs.filter((o) => !test.has(o.journey_id)), test: obs.filter((o) => test.has(o.journey_id)) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fitFourierAtCycle(obs: PassageObservation[], C: number, K: number): FourierFit {
  const { train, test } = splitByJourney(obs);
  const Xtr = train.map((o) => design(o.t, C, K));
  const ytr = train.map((o) => o.y);
  const wtr = train.map((o) => o.weight ?? 1);
  const beta = fitLogistic(Xtr, ytr, wtr);
  const tr = logloss(Xtr, ytr, beta);
  const te = test.length ? logloss(test.map((o) => design(o.t, C, K)), test.map((o) => o.y), beta) : { ll: NaN, brier: NaN };
  return { C, K, beta, train_logloss: tr.ll, heldout_logloss: te.ll, heldout_brier: te.brier, n_train: train.length, n_test: test.length };
}

export interface CycleScanResult {
  best: FourierFit | null;
  scan: { C: number; heldout_logloss: number }[];
  /** Null-model held-out log loss (constant probability) for comparison. */
  null_logloss: number;
  /** Relative improvement over the null model; ≥ 0.05 is treated as evidence of periodicity. */
  improvement: number;
}

/** METHOD A — coarse 1 s scan over [Cmin, Cmax], then 0.1 s refinement around the maximum. */
export function scanCycleLength(obs: PassageObservation[], opts: { Cmin?: number; Cmax?: number; K?: number; minObs?: number } = {}): CycleScanResult {
  const { Cmin = 30, Cmax = 240, K = 2, minObs = 60 } = opts;
  const { train, test } = splitByJourney(obs);
  const pTrain = train.length ? train.reduce((s, o) => s + o.y, 0) / train.length : 0.5;
  const pc = Math.min(1 - 1e-6, Math.max(1e-6, pTrain));
  const nullLL = test.length ? -test.reduce((s, o) => s + (o.y ? Math.log(pc) : Math.log(1 - pc)), 0) / test.length : NaN;
  if (obs.length < minObs || test.length < 10) return { best: null, scan: [], null_logloss: nullLL, improvement: 0 };
  const scan: { C: number; heldout_logloss: number }[] = [];
  let best: FourierFit | null = null;
  for (let C = Cmin; C <= Cmax; C += 1) {
    const f = fitFourierAtCycle(obs, C, K);
    scan.push({ C, heldout_logloss: f.heldout_logloss });
    if (!best || f.heldout_logloss < best.heldout_logloss) best = f;
  }
  if (best) {
    for (let C = best.C - 1; C <= best.C + 1; C += 0.1) {
      const f = fitFourierAtCycle(obs, Number(C.toFixed(1)), K);
      if (f.heldout_logloss < best.heldout_logloss) best = f;
    }
  }
  const improvement = best && Number.isFinite(nullLL) && nullLL > 0 ? (nullLL - best.heldout_logloss) / nullLL : 0;
  return { best, scan, null_logloss: nullLL, improvement };
}

/** METHOD B — autocorrelation of a binary passage series aggregated to 1 s bins. */
export function autocorrelationPeaks(obs: PassageObservation[], Cmin = 30, Cmax = 240): { lag: number; r: number }[] {
  if (obs.length < 50) return [];
  const t0 = Math.min(...obs.map((o) => o.t));
  const T = Math.ceil(Math.max(...obs.map((o) => o.t)) - t0) + 1;
  if (T > 200_000) return [];
  const series = new Float32Array(T);
  const count = new Float32Array(T);
  for (const o of obs) {
    const i = Math.floor(o.t - t0);
    series[i] += o.y;
    count[i] += 1;
  }
  const x = Array.from(series, (v, i) => (count[i] ? v / count[i] : NaN));
  const valid = x.filter((v) => !Number.isNaN(v));
  const μ = valid.reduce((a, b) => a + b, 0) / valid.length;
  const out: { lag: number; r: number }[] = [];
  for (let lag = Cmin; lag <= Cmax; lag++) {
    let num = 0;
    let den = 0;
    let n = 0;
    for (let i = 0; i + lag < T; i++) {
      if (Number.isNaN(x[i]) || Number.isNaN(x[i + lag])) continue;
      num += (x[i] - μ) * (x[i + lag] - μ);
      den += (x[i] - μ) ** 2;
      n++;
    }
    if (n > 20 && den > 0) out.push({ lag, r: num / den });
  }
  return out.sort((a, b) => b.r - a.r).slice(0, 5);
}

/** Circular residual r_i = min_k |g_i − O − kC|. */
export function circularResidual(g: number, O: number, C: number): number {
  const d = (((g - O) % C) + C) % C;
  return Math.min(d, C - d);
}

export interface GreenStartFit {
  C: number;
  O: number;
  cost: number;
  n: number;
  inlier_fraction: number;
}

/**
 * METHOD C — robust (C, O) estimate from green-start (movement-resumption) events g_i,
 * minimising Σ ρ_Huber(circular residual). Coarse 1 s grid over C and 1 s over O, then refine.
 *
 * Sub-harmonic ambiguity: green starts recur at O + kC, so every divisor C/n of the true cycle fits
 * the events equally well. Like an approximate GCD we therefore take the LARGEST C whose cost is
 * within tolerance of the minimum (multiples of the true cycle split events into several phase
 * clusters and are rejected by their cost).
 */
export function fitGreenStarts(events: number[], opts: { Cmin?: number; Cmax?: number; delta?: number } = {}): GreenStartFit | null {
  const { Cmin = 30, Cmax = 240, delta = 4 } = opts;
  if (events.length < 12) return null;
  const t0 = Math.min(...events);
  const g = events.map((e) => e - t0);
  const coarse: GreenStartFit[] = [];
  for (let C = Cmin; C <= Cmax; C += 1) {
    // offsets are only identifiable modulo C; scan with 1 s steps
    let bestO = 0;
    let bestCost = Infinity;
    for (let O = 0; O < C; O += 1) {
      const cost = g.reduce((s, x) => s + huber(circularResidual(x, O, C), delta), 0);
      if (cost < bestCost) {
        bestCost = cost;
        bestO = O;
      }
    }
    coarse.push({ C, O: bestO, cost: bestCost, n: events.length, inlier_fraction: 0 });
  }
  const minCost = Math.min(...coarse.map((c) => c.cost));
  const tolerance = Math.max(minCost * 0.1, 1e-9);
  let best: GreenStartFit | null = coarse.filter((c) => c.cost <= minCost + tolerance).reduce<GreenStartFit | null>((b, c) => (!b || c.C > b.C ? c : b), null);
  if (!best) return null;
  // local refinement (0.1 s) around the coarse optimum
  for (let C = best.C - 1; C <= best.C + 1; C += 0.1) {
    for (let O = best.O - 1; O <= best.O + 1; O += 0.1) {
      const cost = g.reduce((s, x) => s + huber(circularResidual(x, ((O % C) + C) % C, C), delta), 0);
      if (cost < best.cost) best = { ...best, C: Number(C.toFixed(1)), O: Number((((O % C) + C) % C).toFixed(1)), cost };
    }
  }
  const inliers = g.filter((x) => circularResidual(x, best!.O, best!.C) <= delta).length;
  return { ...best, O: Number(((((best.O + t0) % best.C) + best.C) % best.C).toFixed(1)), inlier_fraction: inliers / g.length };
}

/**
 * Journey-level bootstrap for (C, O) uncertainty — resample journeys, not events.
 * Returns median and 95 % interval for C and a circular 95 % half-width for O.
 */
export function bootstrapGreenStarts(
  events: { g: number; journey_id: string }[],
  B: number,
  seedRandom: () => number,
  opts: { Cmin?: number; Cmax?: number } = {},
): { C_median: number; C_ci: [number, number]; O_median: number; O_halfwidth: number } | null {
  const byJourney = new Map<string, number[]>();
  for (const e of events) byJourney.set(e.journey_id, [...(byJourney.get(e.journey_id) ?? []), e.g]);
  const journeys = Array.from(byJourney.values());
  if (journeys.length < 5) return null;
  const Cs: number[] = [];
  const Os: number[] = [];
  const base = fitGreenStarts(events.map((e) => e.g), opts);
  if (!base) return null;
  for (let b = 0; b < B; b++) {
    const sample: number[] = [];
    for (let i = 0; i < journeys.length; i++) sample.push(...journeys[Math.floor(seedRandom() * journeys.length)]);
    const f = fitGreenStarts(sample, { Cmin: Math.max(30, base.C - 5), Cmax: Math.min(240, base.C + 5) });
    if (f) {
      Cs.push(f.C);
      Os.push(f.O);
    }
  }
  if (Cs.length < 10) return null;
  Cs.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const Omed = base.O;
  const devs = Os.map((o) => circularResidual(o, Omed, base.C)).sort((a, b) => a - b);
  return { C_median: q(Cs, 0.5), C_ci: [q(Cs, 0.025), q(Cs, 0.975)], O_median: Omed, O_halfwidth: q(devs, 0.95) };
}
