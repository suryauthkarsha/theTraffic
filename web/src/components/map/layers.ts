import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";

import type { Intersection } from "@/lib/data/types";
import type { LngLat } from "@/lib/geo";

/**
 * Map palette — black & orange (user decision 2026-09-08). Every signal is a flat dot in one of these
 * colours (see `upsertSignalLayer`), so the palette is a brightness ramp of one hue:
 *   orange  the accent: low expected delay, strong data, focus / selection rings
 *   ember   the dimmed orange for anything partial or uncertain: moderate delay, sparse data, unreviewed plans
 *   red     high expected delay, flagged for review
 *   dim     a dark orange — a signal stands here and nothing more is on file. Never grey (user decision
 *           2026-09-08), and bright enough that a 3 px disc still reads on the black canvas.
 */
export const COLORS = {
  orange: "#FF8A2B",
  ember: "#C0651C",
  red: "#F0535A",
  dim: "#8A4A18",
  text: "#F3EFE9",
} as const;

/** Colour semantics for markers — expected delay / data quality, NEVER live lamp state. */
export function delayColor(meanDelay: number | null, level: string | null): string {
  if (meanDelay === null || level === "E") return COLORS.dim;
  if (meanDelay < 25) return COLORS.orange;
  if (meanDelay < 60) return COLORS.ember;
  return COLORS.red;
}

export interface SignalFeatureProps {
  id: string;
  name: string;
  color: string;
  value: number | null;
  radius: number;
  label: string;
}

export function intersectionsToGeoJSON(items: Intersection[], style: (i: Intersection) => { color: string; value: number | null; radius?: number; label?: string }): GeoJSON.FeatureCollection<GeoJSON.Point, SignalFeatureProps> {
  return {
    type: "FeatureCollection",
    features: items.map((i) => {
      const s = style(i);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lon, i.lat] },
        properties: { id: i.id, name: i.canonical_name, color: s.color, value: s.value, radius: s.radius ?? 3.5, label: s.label ?? "" },
      };
    }),
  };
}

/** Dark casing colour for lines and dots (the canvas) — crisp, never a glow. */
export const CASING = "#000000";

/**
 * Flat signal dots (user decision 2026-09-08: "instead of the glow, just add orange dots"). One solid
 * disc per signal in its own colour, no blur, no bloom, no lifted core.
 */
export const SIGNAL_DOT = {
  /** Disc radius at zoom 10, before the per-feature `radius` takes over at zoom 14. */
  minRadius: 2.5,
  /** Multiplier on the per-feature radius at zoom 17. */
  scale17: 1.8,
  /** Hairline canvas-dark casing so a disc stays crisp over roads and satellite imagery. */
  strokeWidth: 1,
  strokeOpacity: 0.9,
} as const;

export interface SignalLayerOptions {
  /** Disc radius at zoom 10, before the per-feature radius takes over. */
  minRadius?: number;
}

/**
 * Add or update the marker layer for a point collection: one `-dot` circle layer of flat discs in the
 * feature's own `color` with a hairline canvas-dark casing (`CASING`). No glow, no blur, no second
 * layer (user decision 2026-09-08: "instead of the glow, just add orange dots"). Nothing blurred sits
 * under or over it either — the heat surface left with the glow (user decision 2026-09-08: "kindly
 * remove the glow"). The colour says what we know — never the lamp.
 */
export function upsertSignalLayer(map: MlMap, id: string, data: GeoJSON.FeatureCollection, opts: SignalLayerOptions = {}): void {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
  const minRadius = opts.minRadius ?? SIGNAL_DOT.minRadius;
  map.addLayer({
    id: `${id}-dot`,
    type: "circle",
    source: id,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, minRadius, 14, ["get", "radius"], 17, ["*", ["get", "radius"], SIGNAL_DOT.scale17]],
      "circle-color": ["get", "color"],
      "circle-opacity": 1,
      "circle-stroke-color": CASING,
      "circle-stroke-width": SIGNAL_DOT.strokeWidth,
      "circle-stroke-opacity": SIGNAL_DOT.strokeOpacity,
    },
  });
}

export function upsertLine(map: MlMap, id: string, coords: LngLat[], paint: { color: string; width: number; opacity?: number; halo?: boolean; dash?: number[] }): void {
  const data: GeoJSON.Feature<GeoJSON.LineString> = { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} };
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    map.setPaintProperty(`${id}-line`, "line-color", paint.color);
    map.setPaintProperty(`${id}-line`, "line-width", paint.width);
    map.setPaintProperty(`${id}-line`, "line-opacity", paint.opacity ?? 1);
    if (map.getLayer(`${id}-halo`)) map.setPaintProperty(`${id}-halo`, "line-width", paint.width + 4);
    return;
  }
  map.addSource(id, { type: "geojson", data });
  if (paint.halo) {
    // Cartographic casing: a crisp canvas-dark line under the route separates it from roads and
    // imagery without any blur.
    map.addLayer({
      id: `${id}-halo`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": CASING, "line-width": paint.width + 4, "line-opacity": 0.9 },
    });
  }
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": paint.color, "line-width": paint.width, "line-opacity": paint.opacity ?? 1, ...(paint.dash ? { "line-dasharray": paint.dash } : {}) },
  });
}

export function removeLayerAndSource(map: MlMap, id: string): void {
  for (const l of [`${id}-line`, `${id}-halo`, `${id}-dot`, `${id}-ring`]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(id)) map.removeSource(id);
}

/**
 * Visible hover / focus / selection state for a marker: a bright ring drawn around the given point
 * (empty collection clears it). Colour follows the design contract's focus ring (orange) for
 * keyboard focus and selection, text colour for mouse hover.
 */
export function upsertFocusRing(map: MlMap, id: string, point: LngLat | null, opts: { color?: string; label?: string } = {}): void {
  const data: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: point ? [{ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: { label: opts.label ?? "" } }] : [] };
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    if (map.getLayer(`${id}-ring`)) map.setPaintProperty(`${id}-ring`, "circle-stroke-color", opts.color ?? COLORS.orange);
    return;
  }
  map.addSource(id, { type: "geojson", data });
  map.addLayer({
    id: `${id}-ring`,
    type: "circle",
    source: id,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 14, 11, 17, 16],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": opts.color ?? COLORS.orange,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.95,
    },
  });
}
