/**
 * Cross-check of an external traffic-signal list (CSV of OSM nodes, e.g. an Overpass/QGIS export)
 * against the signal master map, and the rule for what happens to a light that is "not there":
 *
 *  - row's OSM node id is already a source node          → present (coordinates of the extract are
 *    kept: they carry the way geometry; a row > MOVED_M away is reported as `moved`)
 *  - id unknown, within ATTACH_M of an existing intersection → recorded on that intersection as a
 *    `seed_node_ids` entry. Its id, geometry and approaches are untouched, so every reference from
 *    published plans / reviewer decisions stays valid.
 *  - id unknown, farther than ATTACH_M                    → a new location-only intersection at the
 *    CSV coordinate: `intersection_type: "unresolved"`, no approaches, `review_needed: true`. The id
 *    is the same sha1(node id) the builder would give a single-node cluster, so a later Overpass
 *    refresh that contains the node keeps the id stable.
 *
 * Nothing here is verified, and no coordinate from the file overrides the extract.
 */
import { createHash } from "node:crypto";

/** One CSV row after header mapping; unknown columns are kept in `extra`. */
export interface SeedRow {
  osm_id: number;
  lat: number;
  lon: number;
  name: string;
  traffic_signals: string;
  /** `traffic_signals:direction` in OSM; exporters usually flatten it to `direction`. */
  direction: string;
  crossing: string;
  source: string;
  extra: Record<string, string>;
}

export interface SeedNodeLike {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export type SeedIntersectionType = "junction" | "pedestrian_crossing" | "midblock_or_single_road" | "unresolved";

/** The subset of the built intersection shape the reconciliation reads or creates. */
export interface SeedIntersection {
  id: string;
  canonical_name: string;
  lat: number;
  lon: number;
  intersection_type: SeedIntersectionType;
  control_type: string;
  control_type_source: string;
  osm_node_ids: number[];
  node_count: number;
  spread_m: number;
  cluster_confidence: number;
  score_components: Record<string, number>;
  review_needed: boolean;
  verified: false;
  road_names: string[];
  osm_tags: Record<string, string>;
  approaches: unknown[];
  /** External-list node ids represented by this intersection without changing its geometry. */
  seed_node_ids?: number[];
  /** File the intersection was created from (location-only additions). */
  seed_source?: string;
}

export interface SeedReconciliation {
  file: string;
  /** ISO date found in the file name, when present. */
  as_of: string | null;
  /** Most common value of the file's `source` column. */
  provider: string;
  rows: number;
  skipped_rows: number;
  present: number;
  moved: { osm_id: number; distance_m: number }[];
  attached: { osm_id: number; intersection_id: string; distance_m: number }[];
  added: { osm_id: number; intersection_id: string; lat: number; lon: number }[];
  /** Rows whose name / signal type / direction / crossing differ from the extract's tags. */
  tag_differences: number;
  /** Signals the extract holds that the file does not list (out of its bbox or newer than it). */
  extract_nodes_not_in_file: number;
  /** [minLon, minLat, maxLon, maxLat] of the file's rows. */
  bbox: [number, number, number, number] | null;
}

export const ATTACH_M = 60;
export const MOVED_M = 5;

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

const COLUMN_ALIASES: Record<keyof Omit<SeedRow, "extra">, string[]> = {
  osm_id: ["osm_id", "id", "node_id", "@id", "osmid"],
  lat: ["latitude", "lat", "y", "@lat"],
  lon: ["longitude", "lon", "lng", "long", "x", "@lon"],
  name: ["name"],
  traffic_signals: ["traffic_signals", "signal_type"],
  direction: ["direction", "traffic_signals:direction"],
  crossing: ["crossing"],
  source: ["source"],
};

/** Maps a signal CSV to rows; rows without a finite id or coordinate are counted, not guessed. */
export function parseSignalCsv(text: string): { rows: SeedRow[]; skipped: number } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0 };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (key: keyof Omit<SeedRow, "extra">): number => {
    for (const alias of COLUMN_ALIASES[key]) {
      const idx = header.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idx = {
    osm_id: col("osm_id"),
    lat: col("lat"),
    lon: col("lon"),
    name: col("name"),
    traffic_signals: col("traffic_signals"),
    direction: col("direction"),
    crossing: col("crossing"),
    source: col("source"),
  };
  if (idx.osm_id === -1 || idx.lat === -1 || idx.lon === -1) {
    throw new Error(`signal CSV needs id, latitude and longitude columns; got: ${header.join(", ")}`);
  }
  const known = new Set(Object.values(idx));
  const rows: SeedRow[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const get = (i: number) => (i === -1 ? "" : (cells[i] ?? "").trim());
    const num = (text: string): number => (text === "" ? NaN : Number(text));
    const osm_id = num(get(idx.osm_id).replace(/^node\//i, ""));
    const lat = num(get(idx.lat));
    const lon = num(get(idx.lon));
    if (!Number.isInteger(osm_id) || osm_id <= 0 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    const extra: Record<string, string> = {};
    header.forEach((h, i) => {
      if (!known.has(i) && h && (cells[i] ?? "") !== "") extra[h] = cells[i];
    });
    rows.push({
      osm_id,
      lat,
      lon,
      name: get(idx.name),
      traffic_signals: get(idx.traffic_signals),
      direction: get(idx.direction),
      crossing: get(idx.crossing),
      source: get(idx.source),
      extra,
    });
  }
  return { rows, skipped };
}

/** OSM-style tags for a row (the flattened `direction` column goes back to its OSM key). */
export function rowTags(row: SeedRow): Record<string, string> {
  const tags: Record<string, string> = { highway: "traffic_signals" };
  if (row.name) tags.name = row.name;
  if (row.traffic_signals) tags.traffic_signals = row.traffic_signals;
  if (row.direction) tags["traffic_signals:direction"] = row.direction;
  if (row.crossing) tags.crossing = row.crossing;
  return tags;
}

/** True when the row's descriptive columns disagree with the extract's tags for the same node. */
export function tagsDiffer(row: SeedRow, tags: Record<string, string> | undefined): boolean {
  const t = tags ?? {};
  const extractDirection = t["traffic_signals:direction"] ?? t.direction ?? "";
  return (t.name ?? "") !== row.name || (t.traffic_signals ?? "") !== row.traffic_signals || extractDirection !== row.direction || (t.crossing ?? "") !== row.crossing;
}

/** Same id the builder gives a cluster made of exactly these node ids. */
export function intersectionIdFor(nodeIds: number[]): string {
  return "gw-" + createHash("sha1").update([...nodeIds].sort((a, b) => a - b).join(",")).digest("hex").slice(0, 12);
}

/** Builder's confidence heuristic for a single node without any road context or approaches. */
export const LOCATION_ONLY_SCORE: Record<string, number> = { base: 0.7, node_count: 0.1, spread: 0.1, road_context: -0.15, approaches: -0.3 };

/** A location-only intersection for a listed light the extract does not know. */
export function locationOnlyIntersection(row: SeedRow, file: string): SeedIntersection {
  const confidence = Object.values(LOCATION_ONLY_SCORE).reduce((s, v) => s + v, 0);
  return {
    id: intersectionIdFor([row.osm_id]),
    canonical_name: row.name || "Unnamed signal",
    lat: Number(row.lat.toFixed(7)),
    lon: Number(row.lon.toFixed(7)),
    intersection_type: "unresolved",
    control_type: "unknown",
    control_type_source: "none",
    osm_node_ids: [row.osm_id],
    node_count: 1,
    spread_m: 0,
    cluster_confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
    score_components: { ...LOCATION_ONLY_SCORE },
    review_needed: true,
    verified: false,
    road_names: [],
    osm_tags: rowTags(row),
    approaches: [],
    seed_source: file,
  };
}

function asOfFromName(file: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(file);
  return m ? m[1] : null;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
  return best;
}

/**
 * Reconciles one file against the extract and the built intersections. MUTATES `intersections`
 * (attaches seed ids, appends location-only additions) and returns the report.
 */
export function reconcileSeedRows(file: string, rows: SeedRow[], skipped: number, extractNodes: SeedNodeLike[], intersections: SeedIntersection[]): SeedReconciliation {
  const byId = new Map<number, SeedNodeLike>();
  for (const n of extractNodes) byId.set(n.id, n);
  const fileIds = new Set<number>();
  const report: SeedReconciliation = {
    file,
    as_of: asOfFromName(file),
    provider: mostCommon(rows.map((r) => r.source)),
    rows: rows.length,
    skipped_rows: skipped,
    present: 0,
    moved: [],
    attached: [],
    added: [],
    tag_differences: 0,
    extract_nodes_not_in_file: 0,
    bbox: null,
  };
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const row of rows) {
    fileIds.add(row.osm_id);
    minLat = Math.min(minLat, row.lat); maxLat = Math.max(maxLat, row.lat);
    minLon = Math.min(minLon, row.lon); maxLon = Math.max(maxLon, row.lon);
    const known = byId.get(row.osm_id);
    if (known) {
      report.present++;
      const d = haversineM(row.lat, row.lon, known.lat, known.lon);
      if (d > MOVED_M) report.moved.push({ osm_id: row.osm_id, distance_m: Math.round(d) });
      if (tagsDiffer(row, known.tags)) report.tag_differences++;
      continue;
    }
    let nearest: SeedIntersection | null = null;
    let nearestD = Infinity;
    for (const it of intersections) {
      const d = haversineM(row.lat, row.lon, it.lat, it.lon);
      if (d < nearestD) [nearest, nearestD] = [it, d];
    }
    if (nearest && nearestD <= ATTACH_M) {
      nearest.seed_node_ids = Array.from(new Set([...(nearest.seed_node_ids ?? []), row.osm_id])).sort((a, b) => a - b);
      report.attached.push({ osm_id: row.osm_id, intersection_id: nearest.id, distance_m: Math.round(nearestD) });
      continue;
    }
    const created = locationOnlyIntersection(row, file);
    intersections.push(created);
    report.added.push({ osm_id: row.osm_id, intersection_id: created.id, lat: created.lat, lon: created.lon });
  }
  if (rows.length > 0) report.bbox = [Number(minLon.toFixed(7)), Number(minLat.toFixed(7)), Number(maxLon.toFixed(7)), Number(maxLat.toFixed(7))];
  for (const n of extractNodes) if (!fileIds.has(n.id)) report.extract_nodes_not_in_file++;
  return report;
}

/** Parses and reconciles a file in one go. */
export function reconcileSeedFile(file: string, text: string, extractNodes: SeedNodeLike[], intersections: SeedIntersection[]): SeedReconciliation {
  const { rows, skipped } = parseSignalCsv(text);
  return reconcileSeedRows(file, rows, skipped, extractNodes, intersections);
}
