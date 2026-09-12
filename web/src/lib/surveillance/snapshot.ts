import type { RawCameraRecord, SurveillanceSummary } from "./normalize";

/**
 * Shape of `web/public/data/surveillance_cameras.v1.json`, the synchronized snapshot of OpenStreetMap
 * `man_made=surveillance` nodes inside the Bengaluru boundary. Written only by
 * `scripts/sync-surveillance.ts` after a complete, validated Overpass result; the browser only reads
 * it — no visitor ever triggers an Overpass query.
 */
// The schema id keeps the project's original codename: it is a data contract stamped into every
// snapshot, not branding (the product is theTraffic. since 2026-09-09 — see lib/system/brand).
export const SURVEILLANCE_SCHEMA = "greenwave.surveillance_cameras.v1";
export const SURVEILLANCE_DATASET_URL = "/data/surveillance_cameras.v1.json";

/** The OSM boundary relation the query is scoped to. */
export const BENGALURU_RELATION = { id: 7902476, name: "Bengaluru", admin_level: "7", url: "https://www.openstreetmap.org/relation/7902476" } as const;

export interface SyncStats {
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Elements dropped for a bad id or coordinate. */
  malformed: number;
  /** Ids that appeared more than once in the response (last wins). */
  duplicates: number;
  /** Requests it took (retries and mirrors included). */
  attempts: number;
  endpoint: string;
  previous_synced_at: string | null;
}

export interface SurveillanceSnapshotMeta {
  schema: typeof SURVEILLANCE_SCHEMA;
  dataset: string;
  /** When the sync ran (ISO 8601, UTC). */
  synced_at: string;
  /** Overpass `timestamp_osm_base`: the OSM edits the result includes up to. */
  osm_base: string;
  areas_base: string | null;
  area: typeof BENGALURU_RELATION;
  query_file: string;
  count: number;
  counts: SurveillanceSummary;
  sync: SyncStats;
  license: string;
  attribution: string;
  copyright_url: string;
  credit: { name: string; url: string };
  /** The normalized fields the page derives from `tags` (documentation for reusers). */
  fields: string[];
}

export interface SurveillanceDataset {
  meta: SurveillanceSnapshotMeta;
  records: RawCameraRecord[];
}
