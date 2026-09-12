import { useSyncExternalStore } from "react";

/**
 * What the Surveillance page knows about its snapshot, shared with the system status rail the same
 * way a mounted map shares its basemap health: the page reports while it is mounted and resets on
 * unmount, so the rail's `cameras` item exists only where the dataset is in use. Nothing here loads
 * the dataset — other screens never download it.
 */
export type SurveillanceState = "none" | "loading" | "ok" | "error";

export interface SurveillanceReport {
  state: SurveillanceState;
  count: number | null;
  /** OSM base timestamp of the snapshot (ISO 8601). */
  osmBase: string | null;
  /** When the snapshot was synchronized (ISO 8601). */
  syncedAt: string | null;
}

const NONE: SurveillanceReport = { state: "none", count: null, osmBase: null, syncedAt: null };
let report: SurveillanceReport = NONE;
const listeners = new Set<() => void>();

export function reportSurveillance(next: SurveillanceReport | null): void {
  const value = next ?? NONE;
  if (value.state === report.state && value.count === report.count && value.osmBase === report.osmBase && value.syncedAt === report.syncedAt) return;
  report = value;
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function getSurveillanceReport(): SurveillanceReport {
  return report;
}

export function useSurveillanceReport(): SurveillanceReport {
  return useSyncExternalStore(subscribe, getSurveillanceReport, getSurveillanceReport);
}

export function __resetSurveillanceReportForTests(): void {
  report = NONE;
}
