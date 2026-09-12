/**
 * theTraffic. · Bengaluru — Signal master map builder (Milestones 1–2).
 *
 * Input : raw Overpass extracts in data/raw/osm (nodes + ways touching signal nodes)
 * Output: web/public/data/intersections.v1.json — logical intersections + directional approaches
 *
 * Method
 *  1. Every OSM highway=traffic_signals node becomes a source_signal_node.
 *  2. Node-level approaches are derived from the OSM ways passing through the node:
 *     one approach per incoming travel direction, respecting oneway tags, bearing measured
 *     over ~60 m upstream.
 *  3. Candidate clusters are generated with DBSCAN (eps 35 m, min_samples 1) — a candidate
 *     generator only.
 *  4. Topology-aware merge: nodes that share an OSM way and lie within 90 m are merged even if
 *     DBSCAN separated them (dual carriageways / staggered signal heads).
 *  5. cluster_confidence in [0,1] is scored from spread, node count, shared roads; anything under
 *     0.6 is flagged review_needed for the admin queue. Nothing here is treated as verified.
 *  6. Every external signal list in data/raw/osm/*.csv (OSM node exports) is cross-checked by node
 *     id. A listed light the extract does not know is recorded on the nearest intersection within
 *     60 m (seed_node_ids, geometry untouched) or, beyond that, added at its own coordinate as a
 *     location-only "unresolved" intersection flagged review_needed — see scripts/lib/signalCsv.ts.
 *
 * Run: bun run scripts/build-intersections.ts
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

import { reconcileSeedFile, type SeedIntersection, type SeedIntersectionType, type SeedReconciliation } from "./lib/signalCsv";

type OsmNode = { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> };
type OsmWay = {
  type: "way";
  id: number;
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

const RAW = "data/raw/osm";
const OUT = "web/public/data/intersections.v1.json";
const DATE = "2026-09-05";

const nodesFile = JSON.parse(readFileSync(`${RAW}/traffic_signal_nodes_${DATE}.json`, "utf8"));
const nodes: OsmNode[] = nodesFile.elements.filter((e: OsmNode) => e.type === "node");
const osmTimestamp: string = nodesFile.osm3s?.timestamp_osm_base ?? "unknown";

const ways = new Map<number, OsmWay>();
for (let i = 1; i <= 4; i++) {
  const f = JSON.parse(readFileSync(`${RAW}/signal_ways_tile${i}_${DATE}.json`, "utf8"));
  for (const e of f.elements as OsmWay[]) if (e.type === "way") ways.set(e.id, e);
}

// ---------- geo helpers ----------
const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = toRad(aLat), φ2 = toRad(bLat), Δλ = toRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
const angDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

// ---------- index way geometry by coordinate ----------
const coordToWays = new Map<string, { way: OsmWay; idx: number }[]>();
for (const w of ways.values()) {
  w.geometry.forEach((g, idx) => {
    const k = key(g.lat, g.lon);
    const arr = coordToWays.get(k) ?? [];
    arr.push({ way: w, idx });
    coordToWays.set(k, arr);
  });
}

type NodeApproach = {
  bearing: number;
  road_name: string | null;
  highway: string | null;
  way_id: number;
  oneway: boolean;
  maxspeed: string | null;
  lanes: string | null;
  turn_lanes: string | null;
  upstream: [number, number][]; // [lon,lat] from ~150 m upstream to the node
};

/** Walk along a way from index k in direction dir (-1 or +1) until `metres` accumulated. */
function walk(w: OsmWay, k: number, dir: -1 | 1, metres: number): { lat: number; lon: number }[] {
  const pts: { lat: number; lon: number }[] = [w.geometry[k]];
  let acc = 0;
  let i = k;
  while (acc < metres) {
    const j = i + dir;
    if (j < 0 || j >= w.geometry.length) break;
    const a = w.geometry[i], b = w.geometry[j];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    if (acc + d > metres) {
      const f = (metres - acc) / d;
      pts.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      acc = metres;
      break;
    }
    pts.push(b);
    acc += d;
    i = j;
  }
  return pts;
}

function nodeApproaches(n: OsmNode): NodeApproach[] {
  const hits = coordToWays.get(key(n.lat, n.lon)) ?? [];
  const out: NodeApproach[] = [];
  for (const { way, idx } of hits) {
    const t = way.tags ?? {};
    const hw = t.highway ?? null;
    if (hw && ["footway", "path", "cycleway", "steps", "pedestrian"].includes(hw)) continue;
    const oneway = t.oneway;
    const forwardOnly = oneway === "yes" || oneway === "1" || oneway === "true" || t.junction === "roundabout";
    const reverseOnly = oneway === "-1" || oneway === "reverse";
    const mk = (dir: -1 | 1): NodeApproach | null => {
      // traffic arriving from geometry index idx+dir side (upstream side)
      const up = walk(way, idx, dir, 150);
      if (up.length < 2) return null;
      const b60 = walk(way, idx, dir, 60);
      const far = b60[b60.length - 1];
      if (haversine(far.lat, far.lon, n.lat, n.lon) < 8) return null; // degenerate stub
      const brg = bearing(far.lat, far.lon, n.lat, n.lon);
      return {
        bearing: Math.round(brg * 10) / 10,
        road_name: t.name ?? t.ref ?? null,
        highway: hw,
        way_id: way.id,
        oneway: forwardOnly || reverseOnly,
        maxspeed: t.maxspeed ?? null,
        lanes: t.lanes ?? null,
        turn_lanes: t["turn:lanes"] ?? null,
        upstream: up.reverse().map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
      };
    };
    // Vehicles travelling in node order arrive from idx-1 (upstream = -1 side)
    if (!reverseOnly && idx > 0) { const a = mk(-1); if (a) out.push(a); }
    // Vehicles travelling against node order arrive from idx+1
    if (!forwardOnly && idx < way.geometry.length - 1) { const a = mk(1); if (a) out.push(a); }
  }
  return out;
}

const nodeInfo = nodes.map((n) => ({ n, approaches: nodeApproaches(n), wayIds: new Set((coordToWays.get(key(n.lat, n.lon)) ?? []).map((h) => h.way.id)) }));

// ---------- DBSCAN candidate generation (eps 35 m, min_samples 1) ----------
const EPS = 35;
const labels = new Array<number>(nodes.length).fill(-1);
let cid = 0;
for (let i = 0; i < nodes.length; i++) {
  if (labels[i] !== -1) continue;
  const stack = [i];
  labels[i] = cid;
  while (stack.length) {
    const a = stack.pop()!;
    for (let b = 0; b < nodes.length; b++) {
      if (labels[b] !== -1) continue;
      if (haversine(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon) <= EPS) {
        labels[b] = cid;
        stack.push(b);
      }
    }
  }
  cid++;
}

// ---------- topology-aware merge: shared way within 90 m ----------
const parent = Array.from({ length: cid }, (_, i) => i);
const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
const union = (a: number, b: number) => { parent[find(a)] = find(b); };
let topoMerges = 0;
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    if (find(labels[i]) === find(labels[j])) continue;
    const d = haversine(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
    if (d > 90) continue;
    let shared = false;
    for (const w of nodeInfo[i].wayIds) if (nodeInfo[j].wayIds.has(w)) { shared = true; break; }
    // Also merge when the two nodes sit on parallel carriageways of the same named road
    if (!shared) {
      const ni = new Set(nodeInfo[i].approaches.map((a) => a.road_name).filter(Boolean));
      const nj = nodeInfo[j].approaches.map((a) => a.road_name).filter(Boolean);
      shared = d <= 60 && nj.some((x) => ni.has(x));
    }
    if (shared) { union(labels[i], labels[j]); topoMerges++; }
  }
}
const groups = new Map<number, number[]>();
nodes.forEach((_, i) => {
  const g = find(labels[i]);
  const arr = groups.get(g) ?? [];
  arr.push(i);
  groups.set(g, arr);
});

// ---------- build logical intersections ----------
type Approach = {
  id: string;
  bearing_deg: number;
  compass: string;
  road_name: string | null;
  highway: string | null;
  movement: string;
  movement_source: "default" | "turn_lanes";
  osm_way_ids: number[];
  source_node_ids: number[];
  maxspeed: string | null;
  lanes: string | null;
  turn_lanes: string | null;
  upstream_geometry: [number, number][];
  verified: false;
};

function compass(b: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(b / 45) % 8];
}
function directionWord(b: number): string {
  const map: Record<string, string> = { N: "northbound", NE: "northeast-bound", E: "eastbound", SE: "southeast-bound", S: "southbound", SW: "southwest-bound", W: "westbound", NW: "northwest-bound" };
  return map[compass(b)];
}

const intersections: SeedIntersection[] = [];
let reviewCount = 0;
let approachTotal = 0;
const typeCounts: Record<string, number> = {};

for (const [, idxs] of groups) {
  const members = idxs.map((i) => nodeInfo[i]);
  const lat = members.reduce((s, m) => s + m.n.lat, 0) / members.length;
  const lon = members.reduce((s, m) => s + m.n.lon, 0) / members.length;
  const spread = Math.max(0, ...members.map((m) => haversine(lat, lon, m.n.lat, m.n.lon)));
  const nodeIds = members.map((m) => m.n.id).sort((a, b) => a - b);
  const id = "gw-" + createHash("sha1").update(nodeIds.join(",")).digest("hex").slice(0, 12);

  // merge node-level approaches into cluster approaches (same road, bearing within 20°)
  const merged: Approach[] = [];
  for (const m of members) {
    for (const a of m.approaches) {
      const hit = merged.find((x) => angDiff(x.bearing_deg, a.bearing) <= 20 && (x.road_name ?? "") === (a.road_name ?? ""));
      if (hit) {
        if (!hit.osm_way_ids.includes(a.way_id)) hit.osm_way_ids.push(a.way_id);
        if (!hit.source_node_ids.includes(m.n.id)) hit.source_node_ids.push(m.n.id);
        if (a.upstream.length > hit.upstream_geometry.length) hit.upstream_geometry = a.upstream;
        continue;
      }
      merged.push({
        id: `${id}-a${merged.length + 1}`,
        bearing_deg: a.bearing,
        compass: compass(a.bearing),
        road_name: a.road_name,
        highway: a.highway,
        movement: a.turn_lanes ? "through+turns" : "through",
        movement_source: a.turn_lanes ? "turn_lanes" : "default",
        osm_way_ids: [a.way_id],
        source_node_ids: [m.n.id],
        maxspeed: a.maxspeed,
        lanes: a.lanes,
        turn_lanes: a.turn_lanes,
        upstream_geometry: a.upstream,
        verified: false,
      });
    }
  }
  merged.sort((a, b) => a.bearing_deg - b.bearing_deg);
  merged.forEach((a, i) => { a.id = `${id}-a${i + 1}`; });
  approachTotal += merged.length;

  const roadNames = Array.from(new Set(merged.map((a) => a.road_name).filter((x): x is string => !!x)));
  const namedTag = members.map((m) => m.n.tags?.name).find(Boolean) ?? null;
  const crossingOnly = members.every((m) => m.n.tags?.crossing || m.n.tags?.["highway"] === "traffic_signals" && m.approaches.length <= 2 && roadNames.length <= 1 && (m.n.tags?.button_operated || m.n.tags?.crossing));
  const isPedestrian = members.some((m) => m.n.tags?.crossing === "traffic_signals" || m.n.tags?.button_operated === "yes") && roadNames.length <= 1;

  let intersection_type: SeedIntersectionType;
  if (isPedestrian || crossingOnly) intersection_type = "pedestrian_crossing";
  else if (roadNames.length >= 2 || merged.length >= 3) intersection_type = "junction";
  else if (merged.length >= 1) intersection_type = "midblock_or_single_road";
  else intersection_type = "unresolved";
  typeCounts[intersection_type] = (typeCounts[intersection_type] ?? 0) + 1;

  let canonical_name: string;
  if (namedTag) canonical_name = namedTag;
  else if (roadNames.length >= 2) canonical_name = `${roadNames[0]} × ${roadNames[1]}`;
  else if (roadNames.length === 1) canonical_name = `${roadNames[0]} signal`;
  else canonical_name = "Unnamed signal";

  // confidence heuristic (explained in score_components)
  const comp: Record<string, number> = {};
  comp.base = 0.7;
  comp.node_count = members.length === 1 ? 0.1 : members.length <= 4 ? 0.05 : -0.1 * (members.length - 4);
  comp.spread = spread <= 25 ? 0.1 : spread <= 60 ? 0 : -0.2;
  comp.road_context = roadNames.length >= 2 ? 0.1 : roadNames.length === 1 ? 0 : -0.15;
  comp.approaches = merged.length === 0 ? -0.3 : 0;
  const cluster_confidence = Math.max(0, Math.min(1, Object.values(comp).reduce((s, v) => s + v, 0)));
  const review_needed = cluster_confidence < 0.6 || members.length > 6;
  if (review_needed) reviewCount++;

  intersections.push({
    id,
    canonical_name,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    intersection_type,
    control_type: "unknown",
    control_type_source: "none",
    osm_node_ids: nodeIds,
    node_count: members.length,
    spread_m: Math.round(spread),
    cluster_confidence: Number(cluster_confidence.toFixed(2)),
    score_components: comp,
    review_needed,
    verified: false,
    road_names: roadNames,
    osm_tags: Object.fromEntries(members.flatMap((m) => Object.entries(m.n.tags ?? {}).filter(([k]) => k.startsWith("traffic_signals") || k === "crossing" || k === "button_operated" || k === "name" || k === "junction"))),
    approaches: merged.map((a) => ({ ...a, direction: directionWord(a.bearing_deg) })),
  });
}

// ---------- cross-check external signal lists (data/raw/osm/*.csv) ----------
const seedFiles = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
const reconciliation: SeedReconciliation[] = seedFiles.map((f) => reconcileSeedFile(f, readFileSync(`${RAW}/${f}`, "utf8"), nodes, intersections));
let seedAttached = 0;
let seedAdded = 0;
for (const r of reconciliation) {
  seedAttached += r.attached.length;
  seedAdded += r.added.length;
  reviewCount += r.added.length;
  typeCounts.unresolved = (typeCounts.unresolved ?? 0) + r.added.length;
}

mkdirSync("web/public/data", { recursive: true });
const meta = {
  dataset: "theTraffic. · Bengaluru — signal master map",
  version: "v1",
  generated_at: new Date().toISOString(),
  source: {
    provider: "OpenStreetMap via Overpass API",
    query: 'node["highway"="traffic_signals"](12.78,77.38,13.18,77.82); way(bn)["highway"]',
    osm_timestamp_base: osmTimestamp,
    retrieved_at: `${DATE}T07:45:00Z`,
    license: "ODbL 1.0 — © OpenStreetMap contributors",
  },
  bbox: [77.38, 12.78, 77.82, 13.18],
  counts: {
    source_signal_nodes: nodes.length,
    ways_touching_signals: ways.size,
    logical_intersections: intersections.length,
    approaches: approachTotal,
    review_needed: reviewCount,
    topology_merges: topoMerges,
    by_type: typeCounts,
    seed_nodes_attached: seedAttached,
    seed_nodes_added: seedAdded,
  },
  reconciliation,
  method: {
    candidate_clustering: "DBSCAN eps=35 m, min_samples=1",
    topology_merge: "shared OSM way within 90 m, or same named road within 60 m",
    approach_bearing: "bearing from ~60 m upstream along the OSM way into the signal node; oneway tags respected",
    approach_merge: "same road name and bearing within 20°",
    confidence: "heuristic; < 0.6 flagged review_needed. Nothing is verified.",
    seed_reconciliation: "external signal CSVs matched by OSM node id; unknown ids within 60 m are recorded on the nearest intersection (seed_node_ids, geometry untouched), farther ones become location-only 'unresolved' intersections at the listed coordinate, flagged review_needed",
  },
};
writeFileSync(OUT, JSON.stringify({ meta, intersections }));
console.log(JSON.stringify(meta.counts, null, 2));
for (const r of reconciliation) {
  console.log(`cross-check ${r.file}: ${r.rows} rows (${r.skipped_rows} skipped) · ${r.present} present · ${r.attached.length} attached · ${r.added.length} added · ${r.moved.length} moved · ${r.tag_differences} tag differences · ${r.extract_nodes_not_in_file} extract nodes not listed`);
}
console.log("wrote", OUT, (JSON.stringify({ meta, intersections }).length / 1e6).toFixed(2), "MB");
