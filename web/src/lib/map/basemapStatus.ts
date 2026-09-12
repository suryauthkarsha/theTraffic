import { useSyncExternalStore } from "react";

import type { BasemapMode } from "./basemap";

/**
 * Last reported basemap state, shared with the system status rail. One map is mounted per screen,
 * so the latest report is the current one; screens without a map report "none". The mode is the one
 * the mounted map actually shows — a map pinned to satellite (the junction page) reports satellite
 * whatever the shared Dark / Satellite choice says.
 */
export type BasemapHealth = "none" | "loading" | "ok" | "tiles_pending" | "style_failed" | "webgl_failed";

export interface BasemapReport {
  health: BasemapHealth;
  /** Mode the mounted map shows; null when no map is mounted. */
  mode: BasemapMode | null;
}

const NONE: BasemapReport = { health: "none", mode: null };
let report: BasemapReport = NONE;
const listeners = new Set<() => void>();

export function reportBasemapHealth(health: BasemapHealth, mode: BasemapMode | null = report.mode): void {
  const next: BasemapReport = health === "none" ? NONE : { health, mode };
  if (next.health === report.health && next.mode === report.mode) return;
  report = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The current report (for tests and non-React callers); app code reads it through `useBasemapReport`. */
export function getBasemapReport(): BasemapReport {
  return report;
}

export function useBasemapReport(): BasemapReport {
  return useSyncExternalStore(subscribe, getBasemapReport, getBasemapReport);
}

export function useBasemapHealth(): BasemapHealth {
  return useBasemapReport().health;
}

export function __resetBasemapHealthForTests(): void {
  report = NONE;
}
