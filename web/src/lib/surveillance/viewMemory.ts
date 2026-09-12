import { parseSignalMapView, type SignalMapView } from "@/lib/map/viewMemory";

import { parseFiltersString, serializeFilters, type CameraFilters } from "./filters";

/**
 * Where the visitor left the Surveillance map (centre, zoom, view mode, filters), kept in memory for
 * the session. A fresh open starts on the city home (`lib/map/home`); this memory is read only when
 * history moves back to the page. Same validation as the Signal Map's memory; nothing is written to
 * storage and nothing about the visitor is kept.
 */
export type CameraView = "clusters" | "density";

export interface SurveillanceView {
  center: SignalMapView["center"];
  zoom: number;
  view: CameraView;
  filters: CameraFilters;
}

let memory: SurveillanceView | null = null;

const isView = (v: unknown): v is CameraView => v === "clusters" || v === "density";

/** Validate a view record; anything malformed or away from the city is discarded. Pure; exported for tests. */
export function parseSurveillanceView(raw: unknown): SurveillanceView | null {
  const base = parseSignalMapView(raw);
  if (!base) return null;
  return { center: base.center, zoom: base.zoom, view: isView(base.layer) ? base.layer : "clusters", filters: parseFiltersString(base.filter) };
}

/** The remembered view, or null when this session has none. */
export function recallSurveillanceView(): SurveillanceView | null {
  return memory;
}

/** Keep the current view; invalid views are ignored so a broken map state can never be remembered. */
export function rememberSurveillanceView(view: SurveillanceView): void {
  const parsed = parseSurveillanceView({ center: view.center, zoom: view.zoom, layer: view.view, filter: serializeFilters(view.filters) });
  if (parsed) memory = parsed;
}

export function __resetSurveillanceViewForTests(): void {
  memory = null;
}
