/** Cyclic time features (docs/METHODOLOGY.md §22). Times are interpreted in Asia/Kolkata. */

const KOLKATA_OFFSET_MS = 5.5 * 3600 * 1000;

/** Seconds since local midnight (Asia/Kolkata, fixed UTC+5:30, no DST). */
export function secondsSinceMidnightIST(epochMs: number): number {
  const local = epochMs + KOLKATA_OFFSET_MS;
  return Math.floor((local % 86_400_000) / 1000);
}

/** Day of week 0=Sunday … 6=Saturday in IST. */
export function dayOfWeekIST(epochMs: number): number {
  const local = epochMs + KOLKATA_OFFSET_MS;
  return new Date(local).getUTCDay();
}

/** Seconds since local Monday 00:00 (week position, period 604800). */
export function secondsSinceWeekStartIST(epochMs: number): number {
  const dow = (dayOfWeekIST(epochMs) + 6) % 7; // Monday=0
  return dow * 86_400 + secondsSinceMidnightIST(epochMs);
}

export interface CyclicFeatures {
  x1: number; // sin day
  x2: number; // cos day
  x3: number; // sin week
  x4: number; // cos week
  weekend: 0 | 1;
}

export function cyclicFeatures(epochMs: number): CyclicFeatures {
  const s = secondsSinceMidnightIST(epochMs);
  const dow = dayOfWeekIST(epochMs);
  return {
    x1: Math.sin((2 * Math.PI * s) / 86_400),
    x2: Math.cos((2 * Math.PI * s) / 86_400),
    x3: Math.sin((2 * Math.PI * dow) / 7),
    x4: Math.cos((2 * Math.PI * dow) / 7),
    weekend: dow === 0 || dow === 6 ? 1 : 0,
  };
}

/** Circular distance on a period P: δ = min(|a−b|, P−|a−b|). */
export function circularDistance(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

export function formatIST(epochMs: number, opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...opts }).format(new Date(epochMs));
}
