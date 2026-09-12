import type { GeoJSONSource, Map as MlMap, PointLike } from "maplibre-gl";

import type { LngLat } from "@/lib/geo";
import { hitTolerance, pickNearest, pointerTypeOf, type ScreenHit } from "@/lib/map/hit";
import { DENSITY_RAMP } from "@/lib/surveillance/geometry";
import type { Camera } from "@/lib/surveillance/normalize";
import type { CameraView } from "@/lib/surveillance/viewMemory";

import { CASING } from "./layers";

/**
 * Surveillance layers. A camera is never drawn like a traffic signal: signals are flat orange discs,
 * cameras are a warm-white camera glyph with a black casing, clustered into warm-white counted circles
 * at city zoom. Everything is flat — no blur, no glow — and lives in MapLibre layers (one GeoJSON
 * source with native clustering), never in DOM markers, so thousands of records stay smooth.
 * Layer ids start with `gw-` so the basemap re-tint (`applyBasemapMode`) leaves them alone.
 */
export const CAMERA_SOURCE = "gw-cameras";
export const CAMERA_LAYER = { cluster: "gw-cameras-cluster", count: "gw-cameras-count", icon: "gw-cameras-icon" } as const;
export const GRID_SOURCE = "gw-cameras-grid";
export const GRID_LAYER = { fill: "gw-cameras-grid-fill", line: "gw-cameras-grid-line", label: "gw-cameras-grid-label" } as const;
export const CONE_SOURCE = "gw-cameras-cones";
export const CONE_LAYER = "gw-cameras-cones-fill";
export const CAMERA_ICON = "gw-camera";

export const CAMERA_COLORS = {
  /** The glyph and the cluster disc: warm white, the palette's text colour — never orange (a signal), never grey. */
  mark: "#F3EFE9",
  /** Count digits on a cluster. */
  count: "#000000",
  /** Viewing cones: the accent, flat and translucent. */
  cone: "#FF8A2B",
} as const;

/** Cluster disc radius by member count. */
export const CLUSTER_RADIUS: readonly { below: number; radius: number }[] = [
  { below: 10, radius: 12 },
  { below: 50, radius: 16 },
  { below: 200, radius: 21 },
  { below: Infinity, radius: 27 },
];

/** Clusters dissolve into single glyphs above this zoom (MapLibre `clusterMaxZoom`). */
export const CLUSTER_MAX_ZOOM = 14;
export const CLUSTER_RADIUS_PX = 44;
/** In the Density view single glyphs appear only from this zoom, where cells would be bigger than the screen. */
export const DENSITY_ICON_MIN_ZOOM = 15;
/** Viewing cones appear from this zoom. */
export const CONE_MIN_ZOOM = 15.5;
/** Cell counts are printed from this zoom. */
export const GRID_LABEL_MIN_ZOOM = 12.5;
const GLYPH_FONT = ["Noto Sans Regular"];

export interface CameraFeatureProps {
  id: string;
}

export function camerasToGeoJSON(cameras: readonly Camera[]): GeoJSON.FeatureCollection<GeoJSON.Point, CameraFeatureProps> {
  return { type: "FeatureCollection", features: cameras.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { id: String(c.id) } })) };
}

/** MapLibre `step` expression for the cluster radius. Pure; exported for tests. */
export function clusterRadiusExpression(): unknown[] {
  const expr: unknown[] = ["step", ["get", "point_count"], CLUSTER_RADIUS[0].radius];
  for (let i = 1; i < CLUSTER_RADIUS.length; i++) expr.push(CLUSTER_RADIUS[i - 1].below, CLUSTER_RADIUS[i].radius);
  return expr;
}

/** MapLibre `step` expression for the density fill. Pure; exported for tests. */
export function densityColorExpression(): unknown[] {
  const expr: unknown[] = ["step", ["get", "count"], DENSITY_RAMP[0].color];
  for (let i = 1; i < DENSITY_RAMP.length; i++) expr.push(DENSITY_RAMP[i].from, DENSITY_RAMP[i].color);
  return expr;
}

/**
 * The camera pictogram: a rounded body, a lens with a dark pupil, a small mount tab — filled in the
 * mark colour with a casing stroke. Drawn once into a canvas and registered as a map image. Pure
 * given a 2D context; `size` is the canvas edge in device pixels.
 */
export function drawCameraGlyph(ctx: CanvasRenderingContext2D, size: number): void {
  const u = size / 24;
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6 * u;
  ctx.strokeStyle = CASING;
  ctx.fillStyle = CAMERA_COLORS.mark;
  // mount tab
  ctx.beginPath();
  ctx.rect(9.5 * u, 3.5 * u, 5 * u, 4 * u);
  ctx.fill();
  ctx.stroke();
  // body
  ctx.beginPath();
  const x = 3 * u;
  const y = 7 * u;
  const w = 18 * u;
  const h = 12 * u;
  const r = 2.5 * u;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // lens + pupil
  ctx.beginPath();
  ctx.arc(12 * u, 13 * u, 3.6 * u, 0, Math.PI * 2);
  ctx.fillStyle = CASING;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(12 * u, 13 * u, 1.6 * u, 0, Math.PI * 2);
  ctx.fillStyle = CAMERA_COLORS.mark;
  ctx.fill();
}

/** Register the camera pictogram with the map (idempotent). False when no canvas is available. */
export function ensureCameraIcon(map: MlMap): boolean {
  if (map.hasImage(CAMERA_ICON)) return true;
  if (typeof document === "undefined") return false;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  drawCameraGlyph(ctx, size);
  map.addImage(CAMERA_ICON, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  return true;
}

export interface CameraLayerData {
  points: GeoJSON.FeatureCollection<GeoJSON.Point, CameraFeatureProps>;
  grid: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  cones: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
}

function setData(map: MlMap, id: string, data: GeoJSON.FeatureCollection): boolean {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (!src) return false;
  src.setData(data);
  return true;
}

/** Add or update every surveillance layer. Order: density cells, cones, clusters, counts, glyphs. */
export function upsertCameraLayers(map: MlMap, data: CameraLayerData, view: CameraView, showCones: boolean): void {
  if (setData(map, CAMERA_SOURCE, data.points)) {
    setData(map, GRID_SOURCE, data.grid);
    setData(map, CONE_SOURCE, data.cones);
    setCameraView(map, view, showCones);
    return;
  }

  map.addSource(GRID_SOURCE, { type: "geojson", data: data.grid });
  map.addLayer({ id: GRID_LAYER.fill, type: "fill", source: GRID_SOURCE, maxzoom: DENSITY_ICON_MIN_ZOOM, paint: { "fill-color": densityColorExpression() as never, "fill-opacity": 0.62 } });
  map.addLayer({ id: GRID_LAYER.line, type: "line", source: GRID_SOURCE, maxzoom: DENSITY_ICON_MIN_ZOOM, paint: { "line-color": CASING, "line-width": 1, "line-opacity": 0.7 } });
  map.addLayer({
    id: GRID_LAYER.label,
    type: "symbol",
    source: GRID_SOURCE,
    minzoom: GRID_LABEL_MIN_ZOOM,
    maxzoom: DENSITY_ICON_MIN_ZOOM,
    layout: { "text-field": ["to-string", ["get", "count"]], "text-font": GLYPH_FONT, "text-size": 11, "text-allow-overlap": false },
    paint: { "text-color": CAMERA_COLORS.mark, "text-halo-color": CASING, "text-halo-width": 1 },
  });

  map.addSource(CONE_SOURCE, { type: "geojson", data: data.cones });
  map.addLayer({ id: CONE_LAYER, type: "fill", source: CONE_SOURCE, minzoom: CONE_MIN_ZOOM, paint: { "fill-color": CAMERA_COLORS.cone, "fill-opacity": 0.18, "fill-outline-color": CAMERA_COLORS.cone } });

  map.addSource(CAMERA_SOURCE, { type: "geojson", data: data.points, cluster: true, clusterRadius: CLUSTER_RADIUS_PX, clusterMaxZoom: CLUSTER_MAX_ZOOM });
  map.addLayer({
    id: CAMERA_LAYER.cluster,
    type: "circle",
    source: CAMERA_SOURCE,
    filter: ["has", "point_count"],
    paint: { "circle-color": CAMERA_COLORS.mark, "circle-radius": clusterRadiusExpression() as never, "circle-opacity": 0.96, "circle-stroke-color": CASING, "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: CAMERA_LAYER.count,
    type: "symbol",
    source: CAMERA_SOURCE,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": GLYPH_FONT, "text-size": 11, "text-allow-overlap": true },
    paint: { "text-color": CAMERA_COLORS.count },
  });
  if (ensureCameraIcon(map)) {
    map.addLayer({
      id: CAMERA_LAYER.icon,
      type: "symbol",
      source: CAMERA_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: { "icon-image": CAMERA_ICON, "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 0.72, 17, 1], "icon-allow-overlap": true, "icon-ignore-placement": true },
    });
  } else {
    // No canvas (rare): a warm-white disc with a casing still reads as "not a signal".
    map.addLayer({
      id: CAMERA_LAYER.icon,
      type: "circle",
      source: CAMERA_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": CAMERA_COLORS.mark, "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 4.5, 17, 7], "circle-stroke-color": CASING, "circle-stroke-width": 1 },
    });
  }
  setCameraView(map, view, showCones);
}

/** Show the layers a view needs: clusters, or the density cells with glyphs from close zoom only. */
export function setCameraView(map: MlMap, view: CameraView, showCones: boolean): void {
  const density = view === "density";
  const vis = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  for (const id of Object.values(GRID_LAYER)) vis(id, density);
  vis(CAMERA_LAYER.cluster, !density);
  vis(CAMERA_LAYER.count, !density);
  vis(CONE_LAYER, showCones);
  if (map.getLayer(CAMERA_LAYER.icon)) map.setLayerZoomRange(CAMERA_LAYER.icon, density ? DENSITY_ICON_MIN_ZOOM : 0, 24);
}

/** Id of the camera glyph nearest to a screen point within `tolerance` px, or null. */
export function cameraAt(map: MlMap, point: { x: number; y: number }, tolerance: number): number | null {
  if (!map.getLayer(CAMERA_LAYER.icon)) return null;
  const box: [PointLike, PointLike] = [
    [point.x - tolerance, point.y - tolerance],
    [point.x + tolerance, point.y + tolerance],
  ];
  const hits: ScreenHit[] = [];
  try {
    for (const f of map.queryRenderedFeatures(box, { layers: [CAMERA_LAYER.icon] })) {
      if (f.geometry.type !== "Point") continue;
      const id = (f.properties as { id?: unknown } | null)?.id;
      if (typeof id !== "string") continue;
      const p = map.project(f.geometry.coordinates as [number, number]);
      hits.push({ id, x: p.x, y: p.y });
    }
  } catch {
    return null;
  }
  const best = pickNearest(point, hits, tolerance);
  return best === null ? null : Number(best);
}

/** The cluster under a screen point (the disc is large enough for an exact hit), or null. */
export function clusterAt(map: MlMap, point: { x: number; y: number }): { clusterId: number; center: LngLat } | null {
  if (!map.getLayer(CAMERA_LAYER.cluster)) return null;
  try {
    const f = map.queryRenderedFeatures([point.x, point.y], { layers: [CAMERA_LAYER.cluster] })[0];
    if (!f || f.geometry.type !== "Point") return null;
    const clusterId = (f.properties as { cluster_id?: unknown } | null)?.cluster_id;
    if (typeof clusterId !== "number") return null;
    return { clusterId, center: f.geometry.coordinates as LngLat };
  } catch {
    return null;
  }
}

/** Zoom at which a cluster breaks apart; falls back to two levels in if the source cannot say. */
export async function clusterExpansionZoom(map: MlMap, clusterId: number): Promise<number> {
  const src = map.getSource(CAMERA_SOURCE) as GeoJSONSource | undefined;
  try {
    const z = await src?.getClusterExpansionZoom(clusterId);
    if (typeof z === "number" && Number.isFinite(z)) return Math.min(z + 0.2, 19);
  } catch {
    /* fall through */
  }
  return Math.min(map.getZoom() + 2, 19);
}

/** Tolerance for a map event, mirroring the Signal Map's pointer rule. */
export function toleranceFor(originalEvent: unknown, coarseDevice: boolean): number {
  return hitTolerance(pointerTypeOf(originalEvent), coarseDevice);
}
