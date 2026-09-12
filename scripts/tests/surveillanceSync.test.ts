import { describe, expect, it } from "bun:test";

import type { SourceRegistry } from "../../web/src/lib/data/types";
import type { RawCameraRecord } from "../../web/src/lib/surveillance/normalize";
import { buildDataset, completenessGuard, diffRecords, registryEntries, serializeDataset, toRecords, upsertRegistry, validateOverpassResponse, type OverpassElement } from "../lib/surveillanceSync";

const node = (id: number, tags: Record<string, unknown> = {}, extra: Partial<OverpassElement> = {}): OverpassElement => ({ type: "node", id, lat: 12.97, lon: 77.59, version: 1, timestamp: "2023-05-04T10:00:00Z", tags, ...extra });

describe("Overpass response validation", () => {
  it("accepts a complete result and refuses partial or malformed ones", () => {
    const ok = validateOverpassResponse({ osm3s: { timestamp_osm_base: "2026-09-09T03:50:33Z", timestamp_areas_base: "2026-09-08T17:15:46Z" }, elements: [node(1)] });
    expect(ok.osmBase).toBe("2026-09-09T03:50:33Z");
    expect(ok.areasBase).toBe("2026-09-08T17:15:46Z");
    expect(() => validateOverpassResponse({ osm3s: { timestamp_osm_base: "2026-09-09T03:50:33Z" }, elements: [node(1)], remark: "runtime error: Query timed out in \"query\" at line 4 after 120 seconds." })).toThrow(/remark/);
    expect(() => validateOverpassResponse({ osm3s: { timestamp_osm_base: "2026-09-09T03:50:33Z" }, elements: [] })).toThrow(/zero elements/);
    expect(() => validateOverpassResponse({ elements: [node(1)] })).toThrow(/base timestamp/);
    expect(() => validateOverpassResponse("<html>")).toThrow(/JSON object/);
    expect(() => validateOverpassResponse(null)).toThrow();
  });
});

describe("node → record conversion", () => {
  it("keeps clean nodes, drops and reports bad ids, missing or out-of-area coordinates, wrong types; last duplicate wins", () => {
    const r = toRecords([
      node(10, { man_made: "surveillance", "camera:type": "fixed" }),
      node(11, {}, { lat: undefined }),
      node(12, {}, { lat: 28.6, lon: 77.2 }), // Delhi
      { type: "way", id: 13 },
      node(-1),
      node(14, {}, { timestamp: undefined }),
      node(10, { man_made: "surveillance", "camera:type": "dome" }, { version: 2 }),
    ]);
    expect(r.records.map((x) => x.id)).toEqual([10]);
    expect(r.records[0]).toMatchObject({ v: 2, tags: { "camera:type": "dome", man_made: "surveillance" } });
    expect(r.duplicates).toBe(1);
    expect(r.malformed.map((m) => m.reason)).toEqual(["missing coordinate", expect.stringContaining("outside Bengaluru"), "type way", "bad id", "missing OSM timestamp"]);
  });

  it("sanitizes tags and drops contact-style keys before anything is stored", () => {
    const r = toRecords([node(1, { name: " Gate\u0000 1 ", phone: "+91 98765", "contact:email": "x@y", operator: "BTP", description: "" })]);
    expect(r.records[0].tags).toEqual({ name: "Gate 1", operator: "BTP" });
  });

  it("rounds coordinates to 7 decimals and sorts by id", () => {
    const r = toRecords([node(5, {}, { lat: 12.923456789, lon: 77.687654321 }), node(2)]);
    expect(r.records.map((x) => x.id)).toEqual([2, 5]);
    expect(r.records[1]).toMatchObject({ lat: 12.9234568, lon: 77.6876543 });
  });
});

describe("snapshot upsert", () => {
  const prev: RawCameraRecord[] = [
    { id: 1, lat: 12.97, lon: 77.59, v: 1, t: "2023-01-01T00:00:00Z", tags: { a: "1" } },
    { id: 2, lat: 12.97, lon: 77.59, v: 1, t: "2023-01-01T00:00:00Z", tags: { a: "1" } },
    { id: 3, lat: 12.97, lon: 77.59, v: 1, t: "2023-01-01T00:00:00Z", tags: { a: "1" } },
  ];
  it("counts inserted, updated (version, tags or position), unchanged and removed by OSM id", () => {
    const d = diffRecords(prev, [prev[0], { ...prev[1], v: 2, tags: { a: "2" } }, { id: 4, lat: 12.9, lon: 77.6, v: 1, t: "2026-01-01T00:00:00Z", tags: {} }]);
    expect(d).toMatchObject({ inserted: 1, updated: 1, unchanged: 1, removed: 1, removedIds: [3] });
    expect(diffRecords(null, prev)).toMatchObject({ inserted: 3, updated: 0, removed: 0, unchanged: 0 });
  });

  it("refuses to remove records from a result under half the previous size — stale records leave only with a complete sync", () => {
    expect(completenessGuard(2818, 2800)).toBeNull();
    expect(completenessGuard(null, 5)).toBeNull();
    expect(completenessGuard(2818, 1200)).toMatch(/refusing to remove 1618 records/);
  });
});

describe("dataset, registry and serialization", () => {
  const records = toRecords([node(1, { surveillance: "public", "surveillance:type": "camera", "camera:type": "fixed", "camera:direction": "90", operator: "BTP" }), node(2, { "surveillance:type": "guard" })]).records;
  const dataset = buildDataset({ syncedAt: "2026-09-09T04:00:00Z", osmBase: "2026-09-09T03:50:33Z", areasBase: null, records, queryFile: "scripts/overpass/surveillance.overpassql", sync: { inserted: 2, updated: 0, removed: 0, unchanged: 0, malformed: 0, duplicates: 0, attempts: 1, endpoint: "test", previous_synced_at: null } });

  it("carries schema, area, licence, credit and the summary counts computed by the shared normalizer", () => {
    expect(dataset.meta.schema).toBe("greenwave.surveillance_cameras.v1");
    expect(dataset.meta.area.id).toBe(7902476);
    expect(dataset.meta.attribution).toBe("© OpenStreetMap contributors, ODbL 1.0");
    expect(dataset.meta.credit.url).toContain("thejeshgn.com");
    expect(dataset.meta.count).toBe(2);
    expect(dataset.meta.counts.kinds).toMatchObject({ camera: 1, guard: 1 });
    expect(dataset.meta.counts.operator_mapped).toBe(1);
    expect(dataset.meta.counts.direction_mapped).toBe(1);
  });

  it("serializes one record per line and parses back to the same dataset", () => {
    const text = serializeDataset(dataset);
    expect(text.split("\n").filter((l) => l.startsWith('{"id":')).length).toBe(2);
    expect(JSON.parse(text)).toEqual(dataset);
  });

  it("registry rows: the OSM dataset counts, and the Safe City tender as reference only — never merged into the camera count", () => {
    const entries = registryEntries(dataset.meta);
    expect(entries.map((e) => e.id)).toEqual(["osm-surveillance-cameras", "bscp-safe-city-tender"]);
    expect(entries[0].counts.records).toBe(2);
    expect(entries[0].timing_source).toBe(false);
    expect(entries[0].license).toContain("ODbL");
    expect(entries[1].status).toBe("reference_only");
    expect(entries[1].note).toMatch(/Not imported/);
    expect(entries[1].note).toMatch(/never installed cameras/);
    const registry: SourceRegistry = { meta: { dataset: "x", version: "v1", generated_at: "2026-09-06T00:00:00Z", as_of: "2026-09-06" }, sources: [{ ...entries[0], counts: { records: 1 } }, { id: "other", class: "live", name: "n", publisher: "p", status: "s", timing_source: true, url: "", dates: {}, counts: {}, license: "", note: "" }] };
    const out = upsertRegistry(registry, entries, "2026-09-09T04:00:00Z");
    expect(out.sources.map((s) => s.id)).toEqual(["osm-surveillance-cameras", "other", "bscp-safe-city-tender"]);
    expect(out.sources[0].counts.records).toBe(2);
    expect(out.meta.as_of).toBe("2026-09-09");
  });
});
