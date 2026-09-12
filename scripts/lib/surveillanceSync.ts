/**
 * Pure parts of the surveillance sync (`scripts/sync-surveillance.ts`): response validation, node →
 * record conversion, snapshot diffing, the completeness guard, registry entries and serialization.
 * No IO here so `bun test scripts/tests/surveillanceSync.test.ts` covers every rule.
 */
import type { RegistrySource, SourceRegistry } from "../../web/src/lib/data/types";
import { CREDIT, normalizeCamera, OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, sanitizeTags, summarise, type RawCameraRecord, type SurveillanceSummary } from "../../web/src/lib/surveillance/normalize";
import { BENGALURU_RELATION, SURVEILLANCE_SCHEMA, type SurveillanceDataset, type SurveillanceSnapshotMeta, type SyncStats } from "../../web/src/lib/surveillance/snapshot";

/** Generous box around the Bengaluru boundary relation; anything outside is a malformed coordinate, not a camera. */
export const BENGALURU_BOUNDS = { minLon: 77.2, minLat: 12.6, maxLon: 78.0, maxLat: 13.4 } as const;

/** Contact-style tags are dropped before anything is stored: a camera record needs none of them. */
export const PII_TAG = /^(phone|mobile|fax|email|contact:.*)$/i;

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  version?: number;
  timestamp?: string;
  tags?: Record<string, unknown>;
}

export interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string; timestamp_areas_base?: string };
  elements?: unknown[];
  remark?: string;
}

export interface ValidatedResponse {
  osmBase: string;
  areasBase: string | null;
  elements: OverpassElement[];
}

/**
 * A usable Overpass result: JSON with an OSM base timestamp, a non-empty element list and NO
 * `remark` — Overpass appends one when the query hit a time or memory limit, and such a result is
 * silently partial. Throws with the reason otherwise.
 */
export function validateOverpassResponse(body: unknown): ValidatedResponse {
  if (!body || typeof body !== "object") throw new Error("response is not a JSON object");
  const r = body as OverpassResponse;
  if (typeof r.remark === "string" && r.remark.trim()) throw new Error(`Overpass remark: ${r.remark.trim().slice(0, 200)}`);
  const osmBase = r.osm3s?.timestamp_osm_base;
  if (typeof osmBase !== "string" || Number.isNaN(Date.parse(osmBase))) throw new Error("response carries no OSM base timestamp");
  if (!Array.isArray(r.elements)) throw new Error("response carries no elements array");
  if (r.elements.length === 0) throw new Error("response carries zero elements");
  return { osmBase, areasBase: typeof r.osm3s?.timestamp_areas_base === "string" ? r.osm3s.timestamp_areas_base : null, elements: r.elements as OverpassElement[] };
}

export interface ConversionReport {
  records: RawCameraRecord[];
  malformed: { id: unknown; reason: string }[];
  duplicates: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Nodes → snapshot records. A bad id, a missing or out-of-area coordinate or a wrong type is dropped and reported, never repaired. */
export function toRecords(elements: readonly OverpassElement[]): ConversionReport {
  const byId = new Map<number, RawCameraRecord>();
  const malformed: ConversionReport["malformed"] = [];
  let duplicates = 0;
  for (const e of elements) {
    if (!e || typeof e !== "object") {
      malformed.push({ id: null, reason: "not an object" });
      continue;
    }
    if (e.type !== "node") {
      malformed.push({ id: e.id, reason: `type ${String(e.type)}` });
      continue;
    }
    if (!Number.isInteger(e.id) || (e.id as number) <= 0) {
      malformed.push({ id: e.id, reason: "bad id" });
      continue;
    }
    if (!finite(e.lat) || !finite(e.lon)) {
      malformed.push({ id: e.id, reason: "missing coordinate" });
      continue;
    }
    if (e.lon < BENGALURU_BOUNDS.minLon || e.lon > BENGALURU_BOUNDS.maxLon || e.lat < BENGALURU_BOUNDS.minLat || e.lat > BENGALURU_BOUNDS.maxLat) {
      malformed.push({ id: e.id, reason: `coordinate outside Bengaluru (${e.lat}, ${e.lon})` });
      continue;
    }
    if (typeof e.timestamp !== "string" || Number.isNaN(Date.parse(e.timestamp))) {
      malformed.push({ id: e.id, reason: "missing OSM timestamp" });
      continue;
    }
    const tags = sanitizeTags(e.tags);
    for (const k of Object.keys(tags)) if (PII_TAG.test(k)) delete tags[k];
    if (byId.has(e.id)) duplicates++;
    byId.set(e.id, { id: e.id, lat: Number(e.lat.toFixed(7)), lon: Number(e.lon.toFixed(7)), v: Number.isInteger(e.version) && (e.version as number) > 0 ? (e.version as number) : 1, t: e.timestamp, tags });
  }
  const records = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  return { records, malformed, duplicates };
}

export interface SnapshotDiff {
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  removedIds: number[];
}

const sameRecord = (a: RawCameraRecord, b: RawCameraRecord): boolean => a.v === b.v && a.t === b.t && a.lat === b.lat && a.lon === b.lon && JSON.stringify(a.tags) === JSON.stringify(b.tags);

/** Upsert semantics by OSM id: what a fresh complete result inserts, updates, leaves and removes relative to the last snapshot. */
export function diffRecords(previous: readonly RawCameraRecord[] | null, next: readonly RawCameraRecord[]): SnapshotDiff {
  if (!previous) return { inserted: next.length, updated: 0, removed: 0, unchanged: 0, removedIds: [] };
  const prev = new Map(previous.map((r) => [r.id, r]));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of next) {
    const p = prev.get(r.id);
    if (!p) inserted++;
    else if (sameRecord(p, r)) unchanged++;
    else updated++;
    prev.delete(r.id);
  }
  const removedIds = Array.from(prev.keys()).sort((a, b) => a - b);
  return { inserted, updated, removed: removedIds.length, unchanged, removedIds };
}

/**
 * Stale records are removed only after a COMPLETE successful sync. A result far smaller than the last
 * snapshot is more likely a partial answer than a mass deletion, so it is refused (reason returned)
 * unless the operator forces it.
 */
export function completenessGuard(previousCount: number | null, nextCount: number, minRatio = 0.5): string | null {
  if (previousCount === null || previousCount === 0) return null;
  if (nextCount < previousCount * minRatio) return `only ${nextCount} records against ${previousCount} in the last snapshot (< ${Math.round(minRatio * 100)} %) — refusing to remove ${previousCount - nextCount} records from a possibly partial result`;
  return null;
}

/** The fields the page derives from `tags`; documented in the snapshot for reusers. */
export const NORMALIZED_FIELDS = ["id (OSM node)", "lat", "lon", "surveillance", "surveillance:type", "surveillance:zone", "camera:type", "camera:direction (else direction) → headings in degrees", "camera:mount", "operator", "name", "ref", "description", "survey:date (else check_date)", "osm version (v)", "osm last edit (t)", "tags (all, sanitized)"];

export interface BuildMetaInput {
  syncedAt: string;
  osmBase: string;
  areasBase: string | null;
  records: RawCameraRecord[];
  sync: SyncStats;
  queryFile: string;
}

export function buildDataset(input: BuildMetaInput): SurveillanceDataset {
  const counts: SurveillanceSummary = summarise(input.records.map(normalizeCamera));
  const meta: SurveillanceSnapshotMeta = {
    schema: SURVEILLANCE_SCHEMA,
    dataset: "theTraffic. · Bengaluru — surveillance records mapped in OpenStreetMap (man_made=surveillance) inside the Bengaluru boundary",
    synced_at: input.syncedAt,
    osm_base: input.osmBase,
    areas_base: input.areasBase,
    area: BENGALURU_RELATION,
    query_file: input.queryFile,
    count: input.records.length,
    counts,
    sync: input.sync,
    license: "ODbL 1.0",
    attribution: OSM_ATTRIBUTION,
    copyright_url: OSM_COPYRIGHT_URL,
    credit: { name: CREDIT.name, url: CREDIT.url },
    fields: NORMALIZED_FIELDS,
  };
  return { meta, records: input.records };
}

/** Meta pretty-printed, one record per line: readable diffs, modest size. */
export function serializeDataset(d: SurveillanceDataset): string {
  const records = d.records.map((r) => JSON.stringify(r)).join(",\n");
  return `{\n"meta": ${JSON.stringify(d.meta, null, 1)},\n"records": [\n${records}\n]\n}\n`;
}

/** Registry rows the Research page renders: the OSM camera dataset, and the Safe City tender as a reference that is NOT imported. */
export function registryEntries(meta: SurveillanceSnapshotMeta): RegistrySource[] {
  const c = meta.counts;
  return [
    {
      id: "osm-surveillance-cameras",
      class: "location",
      name: "OpenStreetMap — man_made=surveillance nodes inside the Bengaluru boundary (relation 7902476), after Thejesh GN's Surveillance in Bengaluru project",
      publisher: "OpenStreetMap contributors (community-mapped)",
      status: "ingested",
      timing_source: false,
      url: CREDIT.url,
      dates: { osm_base: meta.osm_base, synchronized_at: meta.synced_at, newest_edit: c.osm_updated.newest, oldest_edit: c.osm_updated.oldest },
      counts: { records: c.total, tagged_camera: c.kinds.camera + c.kinds.alpr, guard_posts: c.kinds.guard, operator_mapped: c.operator_mapped, direction_mapped: c.direction_mapped },
      license: "ODbL 1.0 — © OpenStreetMap contributors",
      note: "Location and tags only, exactly as contributors typed them. A record means a camera was mapped at a place — never that it is on, recording, or who watches it; `surveillance=public` says who it watches, not who owns it. Coverage may be incomplete. Synchronized by scripts/sync-surveillance.ts from a cached Overpass query; the browser never queries Overpass.",
    },
    {
      id: "bscp-safe-city-tender",
      class: "historical",
      name: "Bengaluru Safe City Project — tender annexures 16.13.3 (proposed camera locations) and 16.13.4 (existing cameras)",
      publisher: "Bengaluru City Police e-procurement tender; transcribed to a spreadsheet by Thejesh GN",
      status: "reference_only",
      timing_source: false,
      url: "https://thejeshgn.com/documents/bengaluru-safe-city-project-tender/",
      dates: { probed_at: meta.synced_at },
      counts: { proposed_location_rows: 2745, proposed_locations_stated_approx: 3000, existing_camera_rows: 742, existing_cameras_stated_installed: 1100 },
      license: "Tender document; the transcription is a view-only spreadsheet with no stated licence — reference only",
      note: "Not imported and never added to the OpenStreetMap count. The transcription carries place names with approximate geocodes (2 087 distinct coordinates for 2 745 proposed rows, 554 for 742 existing rows) and no licence, so no row can be placed reliably or matched to a mapped camera. Proposed locations are proposals — never installed cameras; the tender itself says the list 'may vary at the time of implementation'.",
    },
  ];
}

/** Replace or append entries by id; everything else in the registry is untouched. */
export function upsertRegistry(registry: SourceRegistry, entries: readonly RegistrySource[], asOf: string): SourceRegistry {
  const sources = [...registry.sources];
  for (const e of entries) {
    const i = sources.findIndex((s) => s.id === e.id);
    if (i >= 0) sources[i] = e;
    else sources.push(e);
  }
  return { meta: { ...registry.meta, generated_at: asOf, as_of: asOf.slice(0, 10) }, sources };
}
