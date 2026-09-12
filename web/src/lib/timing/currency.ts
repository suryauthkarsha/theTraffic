/**
 * Document currency — the explicit rule ("currency-v1") shared with scripts/ingest_opencity_timing.py.
 * Keep the thresholds identical in both places.
 *
 *   effective date = document's own date (PDF metadata / printed date) when present,
 *                    else the portal publication date
 *   current  ≤ 180 days      aging 181–365 days      stale > 365 days      undated: no date at all
 *   historical: planning / survey documents are never "current" whatever their date
 *   live: a feed observation is judged by freshness in seconds, not by this rule
 *
 * Even a "current" document is a snapshot: nothing here is confirmed against the live programme.
 */
export const CURRENCY_RULE_ID = "currency-v1";
export const CURRENCY_CURRENT_DAYS = 180;
export const CURRENCY_AGING_DAYS = 365;
const DAY_MS = 86_400_000;

export type CurrencyStatus = "current" | "aging" | "stale" | "undated" | "historical" | "superseded" | "live";

export interface Currency {
  status: CurrencyStatus;
  /** ISO date the status was judged from (document date, else portal date). */
  effective_date: string | null;
  effective_date_source: "document" | "portal" | null;
  age_days: number | null;
  /** Human sentence for provenance rows. */
  label: string;
  rule: typeof CURRENCY_RULE_ID;
}

/** Parses "YYYY", "YYYY-MM" or "YYYY-MM-DD" (also full ISO timestamps) to epoch ms at UTC midnight; null when unparsable. */
export function parseDocumentDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 0;
  const d = m[3] ? Number(m[3]) : 1;
  const t = Date.UTC(y, mo, d);
  return Number.isFinite(t) ? t : null;
}

function fmtDateShort(iso: string): string {
  const t = parseDocumentDate(iso);
  if (t === null) return iso;
  const precision = iso.length <= 4 ? "year" : iso.length <= 7 ? "month" : "day";
  return new Intl.DateTimeFormat("en-IN", precision === "day" ? { day: "numeric", month: "short", year: "numeric" } : precision === "month" ? { month: "short", year: "numeric" } : { year: "numeric" }).format(new Date(t));
}

export function fmtAgeDays(days: number): string {
  if (days < 45) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30.4)} mo`;
  const y = days / 365.25;
  return y < 10 ? `${y.toFixed(1)} y` : `${Math.round(y)} y`;
}

/**
 * Currency of a dated document at `asOf`. `kind` "historical" short-circuits to the historical
 * status (planning/survey evidence is never a current timing, whatever its date).
 */
export function documentCurrency(documentDate: string | null | undefined, portalDate: string | null | undefined, asOf: number = Date.now(), kind: "published" | "historical" = "published"): Currency {
  const docT = parseDocumentDate(documentDate);
  const portalT = parseDocumentDate(portalDate);
  const eff = docT !== null ? { t: docT, iso: String(documentDate), src: "document" as const } : portalT !== null ? { t: portalT, iso: String(portalDate).slice(0, 10), src: "portal" as const } : null;
  if (!eff) {
    return { status: kind === "historical" ? "historical" : "undated", effective_date: null, effective_date_source: null, age_days: null, label: kind === "historical" ? "Historical document without a recoverable date — evidence only, never a current timing" : "Undated — neither the document nor the portal carries a date; cannot be treated as current", rule: CURRENCY_RULE_ID };
  }
  const age = Math.max(0, Math.floor((asOf - eff.t) / DAY_MS));
  const dated = `dated ${fmtDateShort(eff.iso)}${eff.src === "portal" ? " (portal date; document undated)" : ""}`;
  if (kind === "historical") {
    return { status: "historical", effective_date: eff.iso, effective_date_source: eff.src, age_days: age, label: `Historical — planning/survey document ${dated}, ${fmtAgeDays(age)} old; evidence only, never a current timing`, rule: CURRENCY_RULE_ID };
  }
  if (age <= CURRENCY_CURRENT_DAYS) return { status: "current", effective_date: eff.iso, effective_date_source: eff.src, age_days: age, label: `Recent snapshot — ${dated}, ${fmtAgeDays(age)} old; not confirmed against the live programme`, rule: CURRENCY_RULE_ID };
  if (age <= CURRENCY_AGING_DAYS) return { status: "aging", effective_date: eff.iso, effective_date_source: eff.src, age_days: age, label: `Aging — ${dated}, ${fmtAgeDays(age)} old; may not reflect the current programme`, rule: CURRENCY_RULE_ID };
  return { status: "stale", effective_date: eff.iso, effective_date_source: eff.src, age_days: age, label: `Stale — ${dated}, ${fmtAgeDays(age)} old; may not reflect the current programme`, rule: CURRENCY_RULE_ID };
}

/** Currency of a live observation judged by freshness (seconds since observed). */
export function liveCurrency(observedAt: number, now: number = Date.now(), maxFreshS = 30): Currency {
  const age = Math.max(0, (now - observedAt) / 1000);
  const fresh = age <= maxFreshS;
  return { status: fresh ? "live" : "stale", effective_date: new Date(observedAt).toISOString(), effective_date_source: "document", age_days: 0, label: fresh ? `Live — observed ${Math.round(age)} s ago` : `Stale live sample — observed ${Math.round(age)} s ago (> ${maxFreshS} s); not shown as current`, rule: CURRENCY_RULE_ID };
}

/** Tone for pills: current/live → orange, historical → grey, superseded → red, stale/undated/aging → ember. */
export function currencyTone(status: CurrencyStatus): "orange" | "ember" | "grey" | "red" {
  switch (status) {
    case "current":
    case "live":
      return "orange";
    case "historical":
      return "grey";
    case "superseded":
      return "red";
    default:
      return "ember";
  }
}
