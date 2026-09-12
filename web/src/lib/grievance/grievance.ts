import type { Intersection } from "@/lib/data/types";
import { BENGALURU_BBOX, haversine, type LngLat } from "@/lib/geo";
import { formatIST } from "@/lib/models/features";
import { BRAND_NAME } from "@/lib/system/brand";

/**
 * Grievances (user request 2026-09-11): what people face on Bengaluru's roads — a pothole, a footpath
 * that stops, water that stands, nowhere safe to cross, a signal out, a street light dark — filed from
 * /grievance with a photo, a place, or both, and collected on the public board at /grievances so they
 * can be shown together to the people who can act on them.
 *
 * The form requests no identity or contact field. Phone-number and e-mail patterns are refused before
 * submission, and the photo is re-encoded to drop camera metadata. Visible words, pixels, precise
 * coordinates and filing time may still identify a person or place, so the form warns the user. The
 * server enforces the same structural rules. Everything in this module is pure and tested; the
 * browser-only parts live in `photo.ts` (shrinking) and `api.ts` (the board).
 */
export type GrievanceKind = "pothole" | "footpath" | "water" | "crossing" | "signal" | "light" | "parking" | "other";

/** Eight plain kinds — the labels are the whole explanation. The order is the one the board's filter shows. */
export const GRIEVANCE_KINDS: { id: GrievanceKind; label: string; short: string }[] = [
  { id: "pothole", label: "Pothole or broken road", short: "Pothole" },
  { id: "footpath", label: "Footpath missing or blocked", short: "Footpath" },
  { id: "water", label: "Water logging or a leaking pipe", short: "Water" },
  { id: "crossing", label: "No safe way to cross", short: "Crossing" },
  { id: "signal", label: "Traffic signal problem", short: "Signal" },
  { id: "light", label: "Street light out", short: "Light" },
  { id: "parking", label: "Parking or encroachment", short: "Parking" },
  { id: "other", label: "Something else on the road", short: "Other" },
];

export const WORDS_MIN = 10;
export const WORDS_MAX = 2000;

/** Longest edge of the photo after shrinking — enough to read a pothole or a signal head, light enough to post. */
export const PHOTO_MAX_EDGE = 1280;
/** The board accepts 400 KB; the browser aims a little under so a size estimate can never be off by enough to matter. */
export const PHOTO_TARGET_BYTES = 380 * 1024;
export const PHOTO_QUALITY_START = 0.82;
export const PHOTO_QUALITY_MIN = 0.5;
/** A phone photo is 2–12 MB; anything far beyond that is not a photo we can help with. */
export const PHOTO_INPUT_MAX_BYTES = 40 * 1024 * 1024;

/** A marked point names the nearest junction on file when one lies within this distance. */
export const NEAREST_JUNCTION_M = 300;

/** How the place was set — shown on the board, so a reader knows how exact it is. */
export type PlaceSource = "map" | "device" | "junction";

export const PLACE_SOURCE_LABEL: Record<PlaceSource, string> = {
  map: "marked on the map",
  device: "device location",
  junction: "a junction on file",
};

export interface PlaceJunction {
  id: string;
  name: string;
  /** 0 when the junction itself was picked. */
  distanceM: number;
}

export interface GrievancePlace {
  point: LngLat;
  source: PlaceSource;
  /** Radius the device reported, metres; only for `device`. */
  accuracyM: number | null;
  junction: PlaceJunction | null;
}

/** What is known about the photo (the pixels travel separately). */
export interface PhotoFacts {
  width: number;
  height: number;
  bytes: number;
}

export interface GrievancePhoto extends PhotoFacts {
  /** JPEG, shrunk and re-encoded in the browser — the re-encode drops the file's metadata. */
  blob: Blob;
  originalBytes: number;
}

export interface GrievanceDraft {
  kind: GrievanceKind;
  message: string;
  /** Honeypot: must stay empty. */
  website: string;
}

/** The grievance exactly as posted to the board: kind, words, place. Nothing about the person. */
export interface GrievanceSubmission {
  kind: GrievanceKind;
  words: string;
  place: { lng: number; lat: number; source: PlaceSource; accuracyM: number | null; junction: PlaceJunction | null } | null;
  website: "";
}

export function kindLabel(kind: GrievanceKind): string {
  return GRIEVANCE_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

export function kindShort(kind: GrievanceKind): string {
  return GRIEVANCE_KINDS.find((k) => k.id === kind)?.short ?? kind;
}

export function isGrievanceKind(v: unknown): v is GrievanceKind {
  return typeof v === "string" && GRIEVANCE_KINDS.some((k) => k.id === v);
}

/** "12.97160, 77.59460" — latitude first, five decimals (about a metre). */
export function fmtCoord(p: LngLat): string {
  return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}

/** A plain openstreetmap.org link to the point, readable by anyone the grievance reaches. */
export function osmLink(p: LngLat): string {
  const lat = p[1].toFixed(5);
  const lon = p[0].toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

export function fmtBytes(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "11 Sept 2026, 2:05 pm" in IST. */
export function fmtIST(ms: number): string {
  return formatIST(ms, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "11 Sept, 2:05 pm" — the board's shorter stamp (the year is dropped inside the current one). */
export function fmtBoardTime(ms: number, nowMs: number = Date.now()): string {
  const sameYear = new Date(ms).getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return formatIST(ms, sameYear ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Whether a point lies in the city's bounding box — a device position outside it cannot be a Bengaluru grievance. Pure. */
export function insideBengaluru(p: LngLat): boolean {
  const [w, s, e, n] = BENGALURU_BBOX;
  return p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
}

/** A free point (marked, or from the device) with the nearest junction on file within `NEAREST_JUNCTION_M`. Pure. */
export function placeAt(point: LngLat, source: "map" | "device", intersections: readonly Intersection[], accuracyM: number | null = null): GrievancePlace {
  let best: PlaceJunction | null = null;
  for (const i of intersections) {
    const d = haversine(point, [i.lon, i.lat]);
    if (d <= NEAREST_JUNCTION_M && (best === null || d < best.distanceM)) best = { id: i.id, name: i.canonical_name, distanceM: d };
  }
  return { point, source, accuracyM, junction: best };
}

/** A junction picked by name or by tapping its dot: the place IS the junction. Pure. */
export function junctionPlace(i: Intersection): GrievancePlace {
  return { point: [i.lon, i.lat], source: "junction", accuracyM: null, junction: { id: i.id, name: i.canonical_name, distanceM: 0 } };
}

/** Ten or more digits in a row, with optional separators: a phone number, whatever the country. */
const PHONE = /(?:\+?\d[\s\-.()]*){10,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** True when free text carries something that would identify the person who wrote it. Pure. */
export function containsContactDetails(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text);
}

/**
 * Validation sentence, or null when the grievance can be posted. A photo or a place — either is enough
 * (a named kind plus the place is a complete grievance: "No safe way to cross" IS the report); "Something
 * else" needs a photo or a few words to say what. Words carrying a phone number or an e-mail address are
 * refused because the board is public. Pure.
 */
export function validateGrievance(d: GrievanceDraft, place: GrievancePlace | null, hasPhoto: boolean): string | null {
  if (d.website.trim()) return "Please leave the hidden field empty.";
  if (!place && !hasPhoto) return "Add a photo, or mark the place on the map.";
  const words = d.message.trim();
  if (d.kind === "other" && !hasPhoto && words.length < WORDS_MIN) return `Say what it is in at least ${WORDS_MIN} characters, or add a photo.`;
  if (words.length > WORDS_MAX) return `Keep it under ${WORDS_MAX.toLocaleString("en-IN")} characters (${words.length.toLocaleString("en-IN")} now).`;
  if (containsContactDetails(words)) return "Leave out phone numbers and e-mail addresses — the board is public.";
  return null;
}

/** The grievance exactly as posted. Pure. */
export function toSubmission(d: GrievanceDraft, place: GrievancePlace | null): GrievanceSubmission {
  return {
    kind: d.kind,
    words: d.message.trim(),
    place: place ? { lng: Number(place.point[0].toFixed(6)), lat: Number(place.point[1].toFixed(6)), source: place.source, accuracyM: place.accuracyM === null ? null : Math.round(place.accuracyM), junction: place.junction ? { id: place.junction.id, name: place.junction.name, distanceM: Math.round(place.junction.distanceM) } : null } : null,
    website: "",
  };
}

/** One grievance as the board publishes it. */
export interface BoardGrievance {
  id: string;
  kind: GrievanceKind;
  words: string;
  place: { lng: number; lat: number; source: PlaceSource; accuracyM: number | null; junction: PlaceJunction | null } | null;
  photo: PhotoFacts | null;
  /** Epoch ms, to the minute. */
  filedAt: number;
}

/** Plain text for the share sheet or the clipboard: one grievance from the board and its link. Pure. */
export function formatBoardGrievance(g: BoardGrievance, link: string): string {
  const lines: (string | null)[] = [
    `${BRAND_NAME} — grievance · ${kindLabel(g.kind)}`,
    g.place ? `Place: ${fmtCoord([g.place.lng, g.place.lat])}${g.place.junction ? ` · ${g.place.junction.distanceM > 0 ? "near " : ""}${g.place.junction.name}` : ""} · ${osmLink([g.place.lng, g.place.lat])}` : null,
    `Filed: ${fmtIST(g.filedAt)} IST`,
    g.words ? "" : null,
    g.words || null,
    "",
    link,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** `/grievances#g-<id>` on the given origin ("" gives a relative link). Pure. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/grievances#g-${id}`;
}
