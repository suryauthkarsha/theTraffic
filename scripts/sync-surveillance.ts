/**
 * theTraffic. · Bengaluru — surveillance snapshot sync.
 *
 * Runs the cached Overpass query in scripts/overpass/surveillance.overpassql (OpenStreetMap
 * `man_made=surveillance` nodes inside the Bengaluru boundary, relation 7902476), validates the
 * result, and writes web/public/data/surveillance_cameras.v1.json — the only thing the site ever
 * reads. No visitor triggers an Overpass call.
 *
 * Rules
 *  - Retries with backoff across public mirrors; a result with an Overpass `remark` (time or memory
 *    limit hit) is partial and refused.
 *  - Nodes with a bad id or a coordinate outside Bengaluru are dropped and counted, never repaired;
 *    tags are sanitized (control characters out, contact-style keys dropped).
 *  - Upsert by OSM id against the previous snapshot; the counts (inserted / updated / removed /
 *    unchanged) go into the snapshot meta and data/sync/data_sync_runs.jsonl. Stale records leave
 *    only with a complete successful sync — a result under half the previous size is refused unless
 *    --force is given. On any failure the previous snapshot stays in place.
 *  - The source registry rows (Research page) are refreshed from the same counts.
 *
 * Run:  bun run scripts/sync-surveillance.ts            (fetch from Overpass)
 *       bun run scripts/sync-surveillance.ts --from <overpass.json>   (use a saved response)
 *       bun run scripts/sync-surveillance.ts --force    (skip the completeness guard)
 * Refresh no more than once a day: the snapshot's synced_at is checked and a run within 24 h is a
 * no-op unless --force is given.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { SourceRegistry } from "../web/src/lib/data/types";
import type { SurveillanceDataset } from "../web/src/lib/surveillance/snapshot";
import { buildDataset, completenessGuard, diffRecords, registryEntries, serializeDataset, toRecords, upsertRegistry, validateOverpassResponse, type ValidatedResponse } from "./lib/surveillanceSync";

const QUERY_FILE = "scripts/overpass/surveillance.overpassql";
const OUT = "web/public/data/surveillance_cameras.v1.json";
const REGISTRY = "web/public/data/source_registry.v1.json";
const LOG = "data/sync/data_sync_runs.jsonl";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const BACKOFF_MS = [2_000, 8_000, 30_000];
const REQUEST_TIMEOUT_MS = 180_000;
const MIN_INTERVAL_MS = 24 * 3600 * 1000;
/**
 * Overpass etiquette asks every client to identify itself with a way to reach its operator. The
 * contact comes from the environment (`GW_CONTACT`: an e-mail address or a URL) so no personal
 * address is written into the repository; without it the agent still names the project.
 */
const CONTACT = process.env.GW_CONTACT?.trim() || null;
const USER_AGENT = CONTACT ? `theTraffic-Bengaluru-sync/1.0 (+${CONTACT})` : "theTraffic-Bengaluru-sync/1.0";

const args = process.argv.slice(2);
const force = args.includes("--force");
const fromIdx = args.indexOf("--from");
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null;

const startedAt = new Date().toISOString();
const log = (msg: string) => console.log(`[sync-surveillance] ${msg}`);

function readPrevious(): SurveillanceDataset | null {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, "utf8")) as SurveillanceDataset;
  } catch (e) {
    log(`previous snapshot unreadable (${(e as Error).message}); treating as first sync`);
    return null;
  }
}

function record(run: Record<string, unknown>): void {
  mkdirSync("data/sync", { recursive: true });
  appendFileSync(LOG, `${JSON.stringify({ dataset: "surveillance_cameras", started_at: startedAt, finished_at: new Date().toISOString(), ...run })}\n`);
}

async function fetchOverpass(query: string): Promise<{ body: ValidatedResponse; endpoint: string; attempts: number }> {
  const errors: string[] = [];
  let attempts = 0;
  for (let round = 0; round < BACKOFF_MS.length + 1; round++) {
    for (const endpoint of ENDPOINTS) {
      attempts++;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, Accept: "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = validateOverpassResponse(await res.json());
        return { body, endpoint, attempts };
      } catch (e) {
        const msg = `${endpoint}: ${(e as Error).message}`;
        errors.push(msg);
        log(`attempt ${attempts} failed — ${msg}`);
      }
    }
    const wait = BACKOFF_MS[Math.min(round, BACKOFF_MS.length - 1)];
    if (round < BACKOFF_MS.length) {
      log(`backing off ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`every attempt failed:\n  ${errors.join("\n  ")}`);
}

async function main(): Promise<void> {
  const previous = readPrevious();
  if (previous && !force && !fromFile) {
    const age = Date.now() - Date.parse(previous.meta.synced_at);
    if (Number.isFinite(age) && age < MIN_INTERVAL_MS) {
      log(`last sync ${previous.meta.synced_at} is ${Math.round(age / 3600000)} h old (< 24 h); nothing to do (use --force to refresh anyway)`);
      return;
    }
  }

  const query = readFileSync(QUERY_FILE, "utf8");
  let body: ValidatedResponse;
  let endpoint: string;
  let attempts: number;
  if (fromFile) {
    body = validateOverpassResponse(JSON.parse(readFileSync(fromFile, "utf8")));
    endpoint = `file:${fromFile}`;
    attempts = 1;
    log(`using saved response ${fromFile}`);
  } else {
    log(`querying Overpass (${ENDPOINTS.length} mirrors, ${BACKOFF_MS.length} retries)`);
    ({ body, endpoint, attempts } = await fetchOverpass(query));
  }
  log(`${body.elements.length} elements · osm base ${body.osmBase} · via ${endpoint} · ${attempts} attempt(s)`);

  const conv = toRecords(body.elements);
  for (const m of conv.malformed.slice(0, 20)) log(`dropped ${String(m.id)}: ${m.reason}`);
  if (conv.malformed.length > 20) log(`… ${conv.malformed.length - 20} more dropped`);

  const guard = completenessGuard(previous?.records.length ?? null, conv.records.length);
  if (guard && !force) {
    record({ ok: false, endpoint, attempts, osm_base: body.osmBase, count: conv.records.length, error: guard });
    throw new Error(guard);
  }
  if (guard) log(`WARNING (forced): ${guard}`);

  const diff = diffRecords(previous?.records ?? null, conv.records);
  const syncedAt = new Date().toISOString();
  const dataset = buildDataset({
    syncedAt,
    osmBase: body.osmBase,
    areasBase: body.areasBase,
    records: conv.records,
    queryFile: QUERY_FILE,
    sync: { inserted: diff.inserted, updated: diff.updated, removed: diff.removed, unchanged: diff.unchanged, malformed: conv.malformed.length, duplicates: conv.duplicates, attempts, endpoint, previous_synced_at: previous?.meta.synced_at ?? null },
  });

  writeFileSync(OUT, serializeDataset(dataset));
  const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as SourceRegistry;
  writeFileSync(REGISTRY, `${JSON.stringify(upsertRegistry(registry, registryEntries(dataset.meta), syncedAt), null, 1)}\n`);

  const c = dataset.meta.counts;
  log(`wrote ${OUT}: ${dataset.meta.count} records (${c.kinds.camera + c.kinds.alpr} tagged camera / ALPR · ${c.kinds.guard} guard · ${c.kinds.viewpoint} viewpoint · ${c.kinds.other + c.kinds.none} other or untyped)`);
  log(`operator mapped ${c.operator_mapped} · direction mapped ${c.direction_mapped} · named ${c.named}`);
  log(`inserted ${diff.inserted} · updated ${diff.updated} · removed ${diff.removed} · unchanged ${diff.unchanged} · malformed ${conv.malformed.length} · duplicates ${conv.duplicates}`);
  if (diff.removedIds.length) log(`removed ids: ${diff.removedIds.slice(0, 50).join(", ")}${diff.removedIds.length > 50 ? " …" : ""}`);
  record({ ok: true, endpoint, attempts, osm_base: body.osmBase, count: dataset.meta.count, inserted: diff.inserted, updated: diff.updated, removed: diff.removed, unchanged: diff.unchanged, malformed: conv.malformed.length, duplicates: conv.duplicates, forced: force });
}

main().catch((e: Error) => {
  log(`FAILED: ${e.message}`);
  record({ ok: false, error: e.message.slice(0, 500) });
  process.exit(1);
});
