/**
 * What a grievance may contain — the server's copy of the rules the form applies in the browser.
 * Pure: no Cloudflare imports, so `bun test functions/tests` covers every branch.
 *
 * The schema asks for no account or identity field. Free text that carries a phone number or e-mail
 * address is refused rather than stored, but visible details and location can still identify people.
 */
export const KINDS = ["pothole", "footpath", "water", "crossing", "signal", "light", "parking", "other"] as const;
export type Kind = (typeof KINDS)[number];

export const PLACE_SOURCES = ["map", "device", "junction"] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

export const WORDS_MAX = 2000;
/** Every grievance carries a photo (user decision 2026-09-13) — the same sentence the form shows. */
export const PHOTO_REQUIRED = "Add a photo — every grievance needs one.";
export const JUNCTION_NAME_MAX = 120;
/** The browser shrinks a photo to 1280 px and steps the JPEG quality down until it fits well under this. */
export const PHOTO_MAX_BYTES = 400 * 1024;
export const JSON_MAX_BYTES = 8 * 1024;
/** The whole multipart body: photo + JSON + boundaries. Anything larger is refused before it is read. */
export const REQUEST_MAX_BYTES = PHOTO_MAX_BYTES + JSON_MAX_BYTES + 4096;
/** Newest-first pages: the default and the most a reader may ask for. */
export const PAGE_DEFAULT = 30;
export const PAGE_MAX = 60;

/** [west, south, east, north] — the same box the web app uses. */
export const BENGALURU_BBOX: readonly [number, number, number, number] = [77.38, 12.78, 77.82, 13.18];

export const JUNCTION_ID = /^gw-[0-9a-f]{12}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ten or more digits in a row, with optional separators: a phone number, whatever the country. */
const PHONE = /(?:\+?\d[\s\-.()]*){10,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** True when free text carries something that would identify the person who wrote it. */
export function containsContactDetails(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text);
}

/** Control characters out (line breaks kept), NFC, at most two consecutive blank lines, trimmed, capped. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export interface SubmittedJunction {
  id: string;
  name: string;
  distanceM: number;
}

export interface SubmittedPlace {
  lng: number;
  lat: number;
  source: PlaceSource;
  accuracyM: number | null;
  junction: SubmittedJunction | null;
}

/** A grievance as accepted: what will be stored, nothing more. */
export interface Submission {
  kind: Kind;
  words: string;
  place: SubmittedPlace | null;
}

export type ParseResult = { ok: true; value: Submission } | { ok: false; status: number; error: string };

const refuse = (error: string, status = 400): ParseResult => ({ ok: false, status, error });

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function insideBengaluru(lng: number, lat: number): boolean {
  const [w, s, e, n] = BENGALURU_BBOX;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

function parsePlace(raw: unknown): SubmittedPlace | null | "bad" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return "bad";
  const p = raw as Record<string, unknown>;
  if (!finite(p.lng) || !finite(p.lat) || !insideBengaluru(p.lng, p.lat)) return "bad";
  if (!(PLACE_SOURCES as readonly string[]).includes(String(p.source))) return "bad";
  const source = p.source as PlaceSource;
  let accuracyM: number | null = null;
  if (p.accuracyM !== null && p.accuracyM !== undefined) {
    if (!finite(p.accuracyM) || p.accuracyM < 0 || source !== "device") return "bad";
    accuracyM = Math.round(Math.min(p.accuracyM, 100_000));
  }
  let junction: SubmittedJunction | null = null;
  if (p.junction !== null && p.junction !== undefined) {
    if (typeof p.junction !== "object") return "bad";
    const j = p.junction as Record<string, unknown>;
    if (typeof j.id !== "string" || !JUNCTION_ID.test(j.id)) return "bad";
    const name = cleanText(j.name, JUNCTION_NAME_MAX).replace(/\n+/g, " ");
    if (!name || containsContactDetails(name)) return "bad";
    if (!finite(j.distanceM) || j.distanceM < 0 || j.distanceM > 1000) return "bad";
    junction = { id: j.id, name, distanceM: Math.round(j.distanceM) };
  }
  return { lng: Number(p.lng.toFixed(6)), lat: Number(p.lat.toFixed(6)), source, accuracyM, junction };
}

/**
 * The submitted JSON → a `Submission`, or the plain sentence the form shows. `hasPhoto` says whether a
 * file arrived alongside — every grievance carries one, and neither the place nor the words stand in
 * for it; both of those are optional. The honeypot (`website`) must be empty.
 */
export function parseSubmission(raw: unknown, hasPhoto: boolean): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refuse("The grievance could not be read.");
  const r = raw as Record<string, unknown>;
  if (typeof r.website === "string" && r.website.trim()) return refuse("Please leave the hidden field empty.");
  if (typeof r.kind !== "string" || !(KINDS as readonly string[]).includes(r.kind)) return refuse("Pick what the grievance is about.");
  const kind = r.kind as Kind;
  if (!hasPhoto) return refuse(PHOTO_REQUIRED);
  const words = cleanText(r.words, WORDS_MAX + 1);
  if (words.length > WORDS_MAX) return refuse(`Keep it under ${WORDS_MAX.toLocaleString("en-IN")} characters.`);
  if (containsContactDetails(words)) return refuse("Leave out phone numbers and e-mail addresses — the board is public.");
  const place = parsePlace(r.place);
  if (place === "bad") return refuse("The place could not be read — mark it on the map again.");
  return { ok: true, value: { kind, words, place } };
}

/** `?limit=` → a page size inside the caps. */
export function pageLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return PAGE_DEFAULT;
  return Math.min(n, PAGE_MAX);
}

/** `?before=<seq>` → a positive integer cursor, or null for the first page. */
export function pageCursor(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `?kind=` → a known kind, or null for every kind. Unknown values read as "every kind", never an error. */
export function kindFilter(raw: string | null): Kind | null {
  return raw !== null && (KINDS as readonly string[]).includes(raw) ? (raw as Kind) : null;
}
