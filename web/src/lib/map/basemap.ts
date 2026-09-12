import type { Map as MlMap } from "maplibre-gl";
import { useSyncExternalStore } from "react";

/**
 * Basemap mode shared by every map on the site: the tinted OpenFreeMap vector "dark" style, or a
 * satellite hybrid — imagery tiles slotted under the same vector roads and labels, with the land /
 * water / building fills hidden so the imagery shows through.
 *
 * Imagery defaults to Esri World Imagery (attribution required, no key) and can be pointed at any
 * XYZ raster source with VITE_SATELLITE_TILE_URL (+ VITE_SATELLITE_ATTRIBUTION). The choice persists
 * in localStorage so a reviewer who prefers satellite keeps it across screens and visits.
 */
export type BasemapMode = "dark" | "satellite";

/**
 * How much of the imagery shows through in satellite mode. `standard` is the city map; `dim` is the
 * junction page, where the imagery is context and the orange signal nodes are the subject.
 */
export type ImageryTone = "standard" | "dim";

const STORAGE_KEY = "gw.basemap";

// Each key is read on its own: reading `import.meta.env` as a whole object would inline every VITE_ value.
export const SATELLITE_TILE_URL: string = import.meta.env.VITE_SATELLITE_TILE_URL?.trim() || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION: string = import.meta.env.VITE_SATELLITE_ATTRIBUTION?.trim() || "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";
export const SATELLITE_MAX_ZOOM = 19;

export const BASEMAP_MODES: { id: BasemapMode; label: string; description: string }[] = [
  { id: "dark", label: "Dark", description: "Tinted vector basemap — roads and labels only." },
  { id: "satellite", label: "Satellite", description: "Aerial imagery under the same roads and labels." },
];

export function isBasemapMode(v: unknown): v is BasemapMode {
  return v === "dark" || v === "satellite";
}

function readStored(): BasemapMode {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return isBasemapMode(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

let mode: BasemapMode = readStored();
const listeners = new Set<() => void>();

export function getBasemapMode(): BasemapMode {
  return mode;
}

export function setBasemapMode(next: BasemapMode): void {
  if (!isBasemapMode(next) || next === mode) return;
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable (private mode): the choice lasts for this page only */
  }
  for (const l of listeners) l();
}

export function subscribeBasemapMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding: [mode, setMode]. */
export function useBasemapMode(): [BasemapMode, (m: BasemapMode) => void] {
  const m = useSyncExternalStore(subscribeBasemapMode, getBasemapMode, getBasemapMode);
  return [m, setBasemapMode];
}

/** Test hook. */
export function __resetBasemapForTests(): void {
  mode = "dark";
}

// ---- style surgery ------------------------------------------------------------------------------

export const SATELLITE_SOURCE_ID = "gw-satellite";
export const SATELLITE_LAYER_ID = "gw-satellite";

/** Fill layers that hide the imagery; hidden in satellite mode. */
export function isGroundFill(layer: { id: string; type: string }): boolean {
  return layer.type === "fill" && /^(water|landcover|landuse|building|aeroway-area|road_area|park|wood|grass|forest|cemetery|golf|pitch|farm|land)/i.test(layer.id);
}

/** Vector road / rail lines from the basemap (never our own route or corridor layers). */
export function isBasemapLine(layer: { id: string; type: string; source?: string }): boolean {
  return layer.type === "line" && (layer.source === "openmaptiles" || /^(highway|road|railway|aeroway|waterway|boundary)/i.test(layer.id)) && !layer.id.startsWith("route-") && !layer.id.startsWith("appr-") && !layer.id.startsWith("gw-");
}

/** Warm near-black tint so the vector basemap sits under the orange dots without a blue cast. */
export const DARK_TINT = {
  background: "#050505",
  water: "#020202",
  land: "#0B0A09",
  building: "#121110",
  arterial: "#33302B",
  minor: "#1E1B18",
  casing: "#000000",
  label: "#6B6560",
  labelHalo: "#000000",
} as const;

export const SATELLITE_TINT = {
  arterial: "#E3DDD3",
  minor: "#C2BAAE",
  label: "#F7F3EE",
  labelHalo: "#000000",
  roadOpacityArterial: 0.42,
  roadOpacityMinor: 0.22,
} as const;

/**
 * Imagery exposure per tone (MapLibre raster paint). Both hold the imagery well under white so the
 * dots stay the brightest thing on the map: `standard` (the city map) caps the brightest pixel at
 * 0.62 so even the faint end of the coverage ramp — a 3 px `#8A4A18` or `#5E3614` dot — still reads
 * over a sunlit roof or a concrete flyover; `dim` (the junction page) goes to half and drains most of
 * the colour, so the imagery is a dark grey ground and a 4 px orange node is the warmest thing in it.
 */
export const IMAGERY_TONE: Record<ImageryTone, { brightnessMax: number; brightnessMin: number; saturation: number; contrast: number }> = {
  standard: { brightnessMax: 0.62, brightnessMin: 0, saturation: -0.4, contrast: 0.1 },
  dim: { brightnessMax: 0.5, brightnessMin: 0, saturation: -0.55, contrast: 0.1 },
};

export interface ApplyBasemapOptions {
  /** Imagery exposure in satellite mode (default `standard`). */
  imagery?: ImageryTone;
}

/**
 * Apply a basemap mode to a loaded style. Idempotent; safe to call after every `style.load` and on
 * every mode change. Only touches basemap layers — the site's own layers (signal dots, focus rings,
 * approach corridors) are left alone and stay on top because the imagery is inserted right above `background`.
 */
export function applyBasemapMode(map: MlMap, next: BasemapMode, opts: ApplyBasemapOptions = {}): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const satellite = next === "satellite";
  const tone = IMAGERY_TONE[opts.imagery ?? "standard"];

  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(SATELLITE_SOURCE_ID, { type: "raster", tiles: [SATELLITE_TILE_URL], tileSize: 256, maxzoom: SATELLITE_MAX_ZOOM, attribution: SATELLITE_ATTRIBUTION });
  }
  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    const firstNonBackground = style.layers.find((l) => l.type !== "background")?.id;
    map.addLayer(
      {
        id: SATELLITE_LAYER_ID,
        type: "raster",
        source: SATELLITE_SOURCE_ID,
        paint: { "raster-opacity": 0, "raster-fade-duration": 250 },
      },
      firstNonBackground,
    );
  }
  map.setPaintProperty(SATELLITE_LAYER_ID, "raster-opacity", satellite ? 1 : 0);
  map.setPaintProperty(SATELLITE_LAYER_ID, "raster-brightness-max", tone.brightnessMax);
  map.setPaintProperty(SATELLITE_LAYER_ID, "raster-brightness-min", tone.brightnessMin);
  map.setPaintProperty(SATELLITE_LAYER_ID, "raster-saturation", tone.saturation);
  map.setPaintProperty(SATELLITE_LAYER_ID, "raster-contrast", tone.contrast);
  map.setLayoutProperty(SATELLITE_LAYER_ID, "visibility", satellite ? "visible" : "none");

  for (const layer of style.layers) {
    if (layer.id === SATELLITE_LAYER_ID || layer.id.startsWith("gw-") || layer.id.startsWith("route-") || layer.id.startsWith("appr-") || layer.id.startsWith("signal") || layer.id.startsWith("all-signals") || layer.id.startsWith("nodes")) continue;
    const id = layer.id;
    try {
      if (layer.type === "background") {
        map.setPaintProperty(id, "background-color", DARK_TINT.background);
      } else if (isGroundFill(layer)) {
        map.setLayoutProperty(id, "visibility", satellite ? "none" : "visible");
        if (!satellite) {
          if (/water/i.test(id)) map.setPaintProperty(id, "fill-color", DARK_TINT.water);
          else if (/building/i.test(id)) map.setPaintProperty(id, "fill-color", DARK_TINT.building);
          else map.setPaintProperty(id, "fill-color", DARK_TINT.land);
        }
      } else if (isBasemapLine(layer)) {
        const casing = /casing|outline/i.test(id);
        const arterial = /(motorway|trunk|primary|secondary|major)/i.test(id);
        if (casing) {
          map.setLayoutProperty(id, "visibility", satellite ? "none" : "visible");
          if (!satellite) map.setPaintProperty(id, "line-color", DARK_TINT.casing);
        } else if (satellite) {
          map.setPaintProperty(id, "line-color", arterial ? SATELLITE_TINT.arterial : SATELLITE_TINT.minor);
          map.setPaintProperty(id, "line-opacity", arterial ? SATELLITE_TINT.roadOpacityArterial : SATELLITE_TINT.roadOpacityMinor);
        } else {
          map.setPaintProperty(id, "line-color", arterial ? DARK_TINT.arterial : DARK_TINT.minor);
          map.setPaintProperty(id, "line-opacity", 1);
        }
      } else if (layer.type === "symbol") {
        map.setPaintProperty(id, "text-color", satellite ? SATELLITE_TINT.label : DARK_TINT.label);
        map.setPaintProperty(id, "text-halo-color", satellite ? SATELLITE_TINT.labelHalo : DARK_TINT.labelHalo);
        map.setPaintProperty(id, "text-halo-width", satellite ? 1.4 : 1);
      }
    } catch {
      /* the layer may not support the property; ignore */
    }
  }
}
