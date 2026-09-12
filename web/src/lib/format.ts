import { formatIST } from "@/lib/models/features";

export const fmtTime = (ms: number): string => formatIST(ms);

export function fmtDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtSeconds(s: number | null, digits = 0): string {
  if (s === null || !Number.isFinite(s)) return "—";
  return `${s.toFixed(digits)} s`;
}

export function fmtSignedSeconds(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const body = a >= 60 ? `${Math.floor(a / 60)}m ${Math.round(a % 60)}s` : `${Math.round(a)} s`;
  return `${s < 0 ? "−" : s > 0 ? "+" : ""}${body}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

export function fmtProb(p: number | null): string {
  return p === null || !Number.isFinite(p) ? "—" : p.toFixed(2);
}

export function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtDate(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export function fmtDayTime(ms: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/**
 * A URL from a dataset that may be rendered as an outbound link: http(s) only, anything else
 * (javascript:, data:, a relative path, garbage) yields null and the link is not drawn. The datasets
 * are ours, but a link target is the one place where a poisoned JSON could run code, so the guard is cheap.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
