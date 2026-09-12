import { BENGALURU_BBOX, type LngLat } from "@/lib/geo";

/**
 * Where the visitor left the Signal Map (centre, zoom, layer, filter), kept in memory for the
 * session. A fresh open of the map — a tab, a console card, a typed URL or a reload — starts on the
 * city home (`lib/map/home`); this memory is read only when history moves back to the map or the
 * junction page asks for it (its breadcrumb and "Show on map"). Nothing is written to storage and
 * nothing about the visitor is kept — only a map position and two control values.
 */
export interface SignalMapView {
  center: LngLat;
  zoom: number;
  layer: string | null;
  filter: string | null;
}

/** Degrees of slack around the city bounding box before a remembered centre is discarded. */
const PAD_DEG = 0.5;
export const VIEW_ZOOM_RANGE = { min: 8, max: 19 } as const;

let memory: SignalMapView | null = null;

/** Validate a view record; anything malformed, out of range or away from the city is discarded. Pure; exported for tests. */
export function parseSignalMapView(raw: unknown): SignalMapView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c = r.center;
  if (!Array.isArray(c) || c.length !== 2) return null;
  const [lng, lat] = c as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const [minX, minY, maxX, maxY] = BENGALURU_BBOX;
  if (lng < minX - PAD_DEG || lng > maxX + PAD_DEG || lat < minY - PAD_DEG || lat > maxY + PAD_DEG) return null;
  const zoom = r.zoom;
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < VIEW_ZOOM_RANGE.min || zoom > VIEW_ZOOM_RANGE.max) return null;
  return {
    center: [lng, lat],
    zoom,
    layer: typeof r.layer === "string" && r.layer ? r.layer : null,
    filter: typeof r.filter === "string" && r.filter ? r.filter : null,
  };
}

/** The remembered view, or null when this session has none. */
export function recallSignalMapView(): SignalMapView | null {
  return memory;
}

/** Keep the current view; invalid views are ignored so a broken map state can never be remembered. */
export function rememberSignalMapView(view: SignalMapView): void {
  const v = parseSignalMapView(view);
  if (v) memory = v;
}

/** Test hook. */
export function __resetSignalMapViewForTests(): void {
  memory = null;
}
