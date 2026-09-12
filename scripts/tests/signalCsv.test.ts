/**
 * bun test scripts/tests/signalCsv.test.ts
 * Rules for a light that is listed in an external CSV but "not there" in the master map.
 */
import { describe, expect, test } from "bun:test";

import { ATTACH_M, intersectionIdFor, locationOnlyIntersection, parseCsv, parseSignalCsv, reconcileSeedRows, rowTags, tagsDiffer, type SeedIntersection, type SeedNodeLike } from "../lib/signalCsv";

const HEADER = '"osm_id","latitude","longitude","name","traffic_signals","direction","crossing","source","osm_url"';
const line = (id: number, lat: number, lon: number, name = "", ts = "", dir = "", crossing = "", source = "OpenStreetMap") =>
  `${id},${lat.toFixed(7)},${lon.toFixed(7)},"${name}","${ts}","${dir}","${crossing}","${source}","https://www.openstreetmap.org/node/${id}"`;

const SILK_BOARD: SeedNodeLike = { id: 1001, lat: 12.9172, lon: 77.6228, tags: { highway: "traffic_signals", traffic_signals: "signal", "traffic_signals:direction": "forward" } };
const HSR: SeedNodeLike = { id: 1002, lat: 12.9116, lon: 77.6389, tags: { highway: "traffic_signals", name: "HSR BDA Complex" } };

function inter(id: string, lat: number, lon: number, nodeIds: number[]): SeedIntersection {
  return {
    id, canonical_name: id, lat, lon, intersection_type: "junction", control_type: "unknown", control_type_source: "none",
    osm_node_ids: nodeIds, node_count: nodeIds.length, spread_m: 0, cluster_confidence: 0.9, score_components: {}, review_needed: false,
    verified: false, road_names: ["Hosur Road"], osm_tags: {}, approaches: [{}, {}],
  };
}

describe("parseCsv", () => {
  test("handles quoted commas, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('\uFEFFa,b\r\n1,"x, y"\r\n2,"say ""hi"""\n\n');
    expect(rows).toEqual([["a", "b"], ["1", "x, y"], ["2", 'say "hi"']]);
  });
});

describe("parseSignalCsv", () => {
  test("maps the export's columns and skips rows without a usable id or coordinate", () => {
    const text = [HEADER, line(1001, 12.9172, 77.6228, "", "signal", "forward"), '"abc",12.9,77.6,"","","","","OpenStreetMap",""', "1003,,77.6,\"\",\"\",\"\",\"\",\"OpenStreetMap\",\"\""].join("\n");
    const { rows, skipped } = parseSignalCsv(text);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(rows[0]).toMatchObject({ osm_id: 1001, lat: 12.9172, lon: 77.6228, traffic_signals: "signal", direction: "forward", source: "OpenStreetMap" });
    expect(rows[0].extra).toEqual({ osm_url: "https://www.openstreetmap.org/node/1001" });
  });

  test("accepts Overpass-style headers (@id, @lat, @lon) and node/ prefixes", () => {
    const { rows } = parseSignalCsv("@id,@lat,@lon\nnode/77,12.95,77.60");
    expect(rows[0]).toMatchObject({ osm_id: 77, lat: 12.95, lon: 77.6 });
  });

  test("refuses a file without coordinates instead of guessing", () => {
    expect(() => parseSignalCsv("osm_id,name\n1,x")).toThrow(/latitude and longitude/);
  });
});

describe("tags", () => {
  test("the flattened direction column is the OSM traffic_signals:direction tag, so it is not a difference", () => {
    const { rows } = parseSignalCsv([HEADER, line(1001, 12.9172, 77.6228, "", "signal", "forward")].join("\n"));
    expect(tagsDiffer(rows[0], SILK_BOARD.tags)).toBe(false);
    expect(rowTags(rows[0])).toEqual({ highway: "traffic_signals", traffic_signals: "signal", "traffic_signals:direction": "forward" });
  });

  test("a new name in the file is reported as a tag difference", () => {
    const { rows } = parseSignalCsv([HEADER, line(1001, 12.9172, 77.6228, "Silk Board", "signal", "forward")].join("\n"));
    expect(tagsDiffer(rows[0], SILK_BOARD.tags)).toBe(true);
  });
});

describe("reconcileSeedRows", () => {
  test("a listed light that is already a source node is present and nothing is added", () => {
    const inters = [inter("gw-a", 12.9172, 77.6228, [1001])];
    const { rows } = parseSignalCsv([HEADER, line(1001, 12.9172, 77.6228)].join("\n"));
    const r = reconcileSeedRows("signals_2026-09-07.csv", rows, 0, [SILK_BOARD, HSR], inters);
    expect(r).toMatchObject({ present: 1, attached: [], added: [], moved: [], as_of: "2026-09-07", provider: "OpenStreetMap", extract_nodes_not_in_file: 1 });
    expect(inters).toHaveLength(1);
    expect(inters[0].seed_node_ids).toBeUndefined();
  });

  test("a present node whose listed coordinate drifted is reported as moved, not relocated", () => {
    const inters = [inter("gw-a", 12.9172, 77.6228, [1001])];
    const { rows } = parseSignalCsv([HEADER, line(1001, 12.9173, 77.6228)].join("\n"));
    const r = reconcileSeedRows("f.csv", rows, 0, [SILK_BOARD], inters);
    expect(r.present).toBe(1);
    expect(r.moved).toEqual([{ osm_id: 1001, distance_m: 11 }]);
    expect(inters[0].lat).toBe(12.9172);
  });

  test("an unknown light within 60 m is recorded on the nearest intersection without changing its id or geometry", () => {
    const inters = [inter("gw-a", 12.9172, 77.6228, [1001])];
    const { rows } = parseSignalCsv([HEADER, line(5001, 12.9175, 77.6228)].join("\n"));
    const r = reconcileSeedRows("f.csv", rows, 0, [SILK_BOARD], inters);
    expect(r.attached).toEqual([{ osm_id: 5001, intersection_id: "gw-a", distance_m: 33 }]);
    expect(r.added).toEqual([]);
    expect(inters).toHaveLength(1);
    expect(inters[0]).toMatchObject({ id: "gw-a", lat: 12.9172, lon: 77.6228, osm_node_ids: [1001], seed_node_ids: [5001] });
    expect(r.attached[0].distance_m).toBeLessThanOrEqual(ATTACH_M);
  });

  test("an unknown light farther than 60 m is added at exactly its listed coordinate as a location-only intersection for review", () => {
    const inters = [inter("gw-a", 12.9172, 77.6228, [1001])];
    const { rows } = parseSignalCsv([HEADER, line(5002, 12.93, 77.6, "Marenahalli Circle", "signal", "", "traffic_signals")].join("\n"));
    const r = reconcileSeedRows("signals_2026-09-07.csv", rows, 0, [SILK_BOARD], inters);
    expect(r.added).toEqual([{ osm_id: 5002, intersection_id: intersectionIdFor([5002]), lat: 12.93, lon: 77.6 }]);
    expect(inters).toHaveLength(2);
    const added = inters[1];
    expect(added).toMatchObject({
      id: intersectionIdFor([5002]), canonical_name: "Marenahalli Circle", lat: 12.93, lon: 77.6, intersection_type: "unresolved", control_type: "unknown",
      osm_node_ids: [5002], node_count: 1, review_needed: true, verified: false, road_names: [], approaches: [], seed_source: "signals_2026-09-07.csv",
      osm_tags: { highway: "traffic_signals", name: "Marenahalli Circle", traffic_signals: "signal", crossing: "traffic_signals" },
    });
    expect(added.cluster_confidence).toBe(0.45);
    expect(added.cluster_confidence).toBeLessThan(0.6);
  });

  test("a location-only addition gets the id the builder would give a single-node cluster of that node", () => {
    const { rows } = parseSignalCsv([HEADER, line(6001, 12.95, 77.65)].join("\n"));
    expect(locationOnlyIntersection(rows[0], "f.csv").id).toBe(intersectionIdFor([6001]));
    expect(intersectionIdFor([3, 1, 2])).toBe(intersectionIdFor([1, 2, 3]));
    expect(intersectionIdFor([6001])).toMatch(/^gw-[0-9a-f]{12}$/);
  });

  test("the bbox and skipped count describe the file, and unnamed additions read 'Unnamed signal'", () => {
    const inters: SeedIntersection[] = [];
    const { rows, skipped } = parseSignalCsv([HEADER, line(7001, 12.9, 77.5), line(7002, 13.1, 77.7), '"x",1,2,"","","","","",""'].join("\n"));
    const r = reconcileSeedRows("f.csv", rows, skipped, [], inters);
    expect(r.bbox).toEqual([77.5, 12.9, 77.7, 13.1]);
    expect(r.skipped_rows).toBe(1);
    expect(r.added).toHaveLength(2);
    expect(inters.map((i) => i.canonical_name)).toEqual(["Unnamed signal", "Unnamed signal"]);
  });
});
