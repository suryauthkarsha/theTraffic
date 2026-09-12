/**
 * Surveillance records: OpenStreetMap `man_made=surveillance` nodes inside the Bengaluru boundary,
 * synchronized by `scripts/sync-surveillance.ts` into `web/public/data/surveillance_cameras.v1.json`.
 *
 * This module is pure and imports nothing, so the sync script (bun) and the browser share ONE
 * reading of the tags: the same facets, the same direction parsing, the same sanitizing. Every
 * value here is what a contributor typed into OpenStreetMap — never a claim of ours. A record says
 * a camera was mapped at a place; it never says the camera is on, recording, or who watches it.
 */

/** One synchronized OSM node, exactly as stored in the snapshot (tags already sanitized). */
export interface RawCameraRecord {
  /** OSM node id. */
  id: number;
  lat: number;
  lon: number;
  /** OSM object version. */
  v: number;
  /** OSM last-edit timestamp (ISO 8601). */
  t: string;
  tags: Record<string, string>;
}

/** What `surveillance:type` says the node is. Most are cameras; a few are guard posts or viewpoints. */
export type CameraKind = "camera" | "alpr" | "guard" | "viewpoint" | "other" | "none";
/** `surveillance=*` — who the camera watches for, as the contributor tagged it. */
export type CategoryFacet = "public" | "outdoor" | "indoor" | "private" | "traffic" | "other" | "none";
/** `surveillance:zone=*` — what it watches. */
export type ZoneFacet = "traffic" | "area" | "town" | "street" | "building" | "other" | "none";
/** `camera:type=*`. */
export type CameraTypeFacet = "fixed" | "dome" | "panning" | "other" | "none";

export interface Camera {
  id: number;
  lat: number;
  lon: number;
  version: number;
  /** OSM last-edit timestamp (ISO 8601). */
  updatedAt: string;
  kind: CameraKind;
  category: CategoryFacet;
  zone: ZoneFacet;
  cameraType: CameraTypeFacet;
  /** Raw tag values for the detail panel (`null` = not mapped). */
  surveillance: string | null;
  surveillanceType: string | null;
  zoneRaw: string | null;
  cameraTypeRaw: string | null;
  mount: string | null;
  operator: string | null;
  name: string | null;
  ref: string | null;
  description: string | null;
  /** `survey:date`, else `check_date` — when someone last confirmed it on the ground. */
  surveyDate: string | null;
  /** Headings in degrees clockwise from north, parsed from `camera:direction` (else `direction`); empty when none or unparsable. */
  directions: number[];
  /** The direction tag as typed, for the detail panel. */
  directionRaw: string | null;
  tags: Record<string, string>;
}

export const OSM_NODE_URL = (id: number): string => `https://www.openstreetmap.org/node/${id}`;
export const OSM_EDIT_URL = (id: number): string => `https://www.openstreetmap.org/edit?node=${id}`;
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";
export const CREDIT = { name: "Thejesh GN's Surveillance in Bengaluru", url: "https://thejeshgn.com/projects/surveillance-in-bengaluru/" } as const;

const MAX_KEY = 64;
const MAX_VALUE = 256;
// C0 and C1 control characters, plus the bidi / zero-width formatting characters that can disguise text.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/** A tag value fit to render: control characters out, whitespace collapsed, length capped; empty → null. */
export function cleanText(v: unknown, max = MAX_VALUE): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Every tag with a clean key and value; anything else is dropped rather than repaired. */
export function sanitizeTags(tags: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tags) return out;
  for (const k of Object.keys(tags).sort()) {
    const key = cleanText(k, MAX_KEY);
    const value = cleanText(tags[k]);
    if (key && value) out[key] = value;
  }
  return out;
}

const CARDINAL: Record<string, number> = {
  n: 0,
  north: 0,
  nne: 22.5,
  ne: 45,
  northeast: 45,
  "north-east": 45,
  ene: 67.5,
  e: 90,
  east: 90,
  ese: 112.5,
  se: 135,
  southeast: 135,
  "south-east": 135,
  sse: 157.5,
  s: 180,
  south: 180,
  ssw: 202.5,
  sw: 225,
  southwest: 225,
  "south-west": 225,
  wsw: 247.5,
  w: 270,
  west: 270,
  wnw: 292.5,
  nw: 315,
  northwest: 315,
  "north-west": 315,
  nnw: 337.5,
};

/**
 * Headings from a `camera:direction` value: degrees 0–360 or a compass point, several separated by
 * `;` (one camera housing pointing three ways). Anything else — a range, a stray character, a negative
 * number — yields no heading at all: the raw text still shows in the detail panel, but no cone is drawn
 * from a guess.
 */
export function parseDirections(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(";")) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    if (/^\d+(\.\d+)?$/.test(p)) {
      const n = Number(p);
      if (n > 360) return [];
      out.push(n % 360);
      continue;
    }
    const c = CARDINAL[p];
    if (c === undefined) return [];
    out.push(c);
  }
  return out;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** 16-point compass label for a heading. */
export function compassLabel(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function kindOf(surveillanceType: string | null): CameraKind {
  if (surveillanceType === null) return "none";
  const v = surveillanceType.toLowerCase();
  if (v === "camera") return "camera";
  if (v === "alpr" || v === "anpr") return "alpr";
  if (v === "guard") return "guard";
  if (v === "viewpoint") return "viewpoint";
  return "other";
}

export function categoryOf(surveillance: string | null): CategoryFacet {
  if (surveillance === null) return "none";
  const v = surveillance.toLowerCase();
  if (v === "public" || v === "outdoor" || v === "indoor" || v === "private" || v === "traffic") return v;
  return "other";
}

export function zoneOf(zone: string | null): ZoneFacet {
  if (zone === null) return "none";
  const v = zone.toLowerCase();
  if (v === "traffic" || v === "area" || v === "town" || v === "street" || v === "building") return v;
  return "other";
}

export function cameraTypeOf(cameraType: string | null): CameraTypeFacet {
  if (cameraType === null) return "none";
  const v = cameraType.toLowerCase();
  if (v === "fixed" || v === "dome" || v === "panning") return v;
  return "other";
}

const tag = (tags: Record<string, string>, key: string): string | null => cleanText(tags[key]);

/** One snapshot record → the shape the page reads. Pure. */
export function normalizeCamera(r: RawCameraRecord): Camera {
  const tags = r.tags ?? {};
  const surveillance = tag(tags, "surveillance");
  const surveillanceType = tag(tags, "surveillance:type");
  const zoneRaw = tag(tags, "surveillance:zone");
  const cameraTypeRaw = tag(tags, "camera:type");
  const directionRaw = tag(tags, "camera:direction") ?? tag(tags, "direction");
  return {
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    version: r.v,
    updatedAt: r.t,
    kind: kindOf(surveillanceType),
    category: categoryOf(surveillance),
    zone: zoneOf(zoneRaw),
    cameraType: cameraTypeOf(cameraTypeRaw),
    surveillance,
    surveillanceType,
    zoneRaw,
    cameraTypeRaw,
    mount: tag(tags, "camera:mount"),
    operator: tag(tags, "operator"),
    name: tag(tags, "name"),
    ref: tag(tags, "ref"),
    description: tag(tags, "description"),
    surveyDate: tag(tags, "survey:date") ?? tag(tags, "check_date"),
    directions: parseDirections(directionRaw),
    directionRaw,
    tags,
  };
}

export interface SurveillanceSummary {
  total: number;
  kinds: Record<CameraKind, number>;
  categories: Record<CategoryFacet, number>;
  zones: Record<ZoneFacet, number>;
  camera_types: Record<CameraTypeFacet, number>;
  operator_mapped: number;
  direction_mapped: number;
  named: number;
  osm_updated: { oldest: string | null; newest: string | null };
}

export const KINDS: readonly CameraKind[] = ["camera", "alpr", "guard", "viewpoint", "other", "none"];
export const CATEGORIES: readonly CategoryFacet[] = ["public", "outdoor", "indoor", "private", "traffic", "other", "none"];
export const ZONES: readonly ZoneFacet[] = ["traffic", "area", "town", "street", "building", "other", "none"];
export const CAMERA_TYPES: readonly CameraTypeFacet[] = ["fixed", "dome", "panning", "other", "none"];

const zeroes = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Counts over a set of records — the same function feeds the snapshot meta, the source registry and the page. Pure. */
export function summarise(cameras: readonly Camera[]): SurveillanceSummary {
  const s: SurveillanceSummary = {
    total: cameras.length,
    kinds: zeroes(KINDS),
    categories: zeroes(CATEGORIES),
    zones: zeroes(ZONES),
    camera_types: zeroes(CAMERA_TYPES),
    operator_mapped: 0,
    direction_mapped: 0,
    named: 0,
    osm_updated: { oldest: null, newest: null },
  };
  for (const c of cameras) {
    s.kinds[c.kind]++;
    s.categories[c.category]++;
    s.zones[c.zone]++;
    s.camera_types[c.cameraType]++;
    if (c.operator) s.operator_mapped++;
    if (c.directions.length) s.direction_mapped++;
    if (c.name) s.named++;
    if (!s.osm_updated.oldest || c.updatedAt < s.osm_updated.oldest) s.osm_updated.oldest = c.updatedAt;
    if (!s.osm_updated.newest || c.updatedAt > s.osm_updated.newest) s.osm_updated.newest = c.updatedAt;
  }
  return s;
}
