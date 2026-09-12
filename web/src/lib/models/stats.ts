/** Small, dependency-free statistics helpers used across models and validation. */

export function weightedQuantile(values: number[], weights: number[], q: number): number {
  if (values.length === 0) return NaN;
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = idx.reduce((s, i) => s + weights[i], 0);
  if (total <= 0) return NaN;
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc / total >= q) return values[i];
  }
  return values[idx[idx.length - 1]];
}

export function weightedMean(values: number[], weights: number[]): number {
  let s = 0;
  let w = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i] * weights[i];
    w += weights[i];
  }
  return w > 0 ? s / w : NaN;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Huber loss ρ_δ(r). */
export function huber(r: number, δ: number): number {
  const a = Math.abs(r);
  return a <= δ ? 0.5 * r * r : δ * (a - 0.5 * δ);
}

/** Quantile (pinball) loss L_τ(y, q). */
export function pinball(y: number, q: number, τ: number): number {
  return y >= q ? τ * (y - q) : (1 - τ) * (q - y);
}

export function brier(probs: number[], outcomes: number[]): number {
  return mean(probs.map((p, i) => (p - outcomes[i]) ** 2));
}

export function logLoss(probs: number[], outcomes: number[], eps = 1e-6): number {
  return -mean(probs.map((p, i) => {
    const pc = clip(p, eps, 1 - eps);
    return outcomes[i] ? Math.log(pc) : Math.log(1 - pc);
  }));
}

export function mae(pred: number[], actual: number[]): number {
  return mean(pred.map((p, i) => Math.abs(p - actual[i])));
}

/** Expected Calibration Error with equal-width bins. */
export function expectedCalibrationError(probs: number[], outcomes: number[], bins = 10): number {
  const n = probs.length;
  if (!n) return NaN;
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const idx = probs.map((_, i) => i).filter((i) => probs[i] >= lo && (probs[i] < hi || (b === bins - 1 && probs[i] <= hi)));
    if (!idx.length) continue;
    const conf = mean(idx.map((i) => probs[i]));
    const acc = mean(idx.map((i) => outcomes[i]));
    ece += (idx.length / n) * Math.abs(acc - conf);
  }
  return ece;
}

/** Deterministic PRNG (mulberry32) so Monte Carlo and tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box–Muller from a uniform generator. */
export function normalSample(u: () => number): number {
  let a = 0;
  while (a === 0) a = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
}

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
