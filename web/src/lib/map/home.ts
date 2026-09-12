import type { PaddingOptions } from "maplibre-gl";

import { BENGALURU_CENTER, type LngLat } from "@/lib/geo";

/**
 * Where every city map opens on a fresh visit (user decision 2026-09-09): the centre of Bengaluru,
 * close enough that the core reads junction by junction — the visitor pans and zooms out from there.
 * Only a return brings back the view they left: Back / Forward, or a screen that asks for it with
 * `RESTORE_VIEW_STATE` (the junction page's breadcrumb and "Show on map").
 */
export const CITY_HOME: { readonly center: LngLat; readonly zoom: number } = { center: BENGALURU_CENTER, zoom: 13 };

/** `Link state` a screen passes when the map should reopen where the visitor left it. */
export const RESTORE_VIEW_STATE = { restoreView: true } as const;

/**
 * Whether a map screen restores its remembered view instead of opening on the city home. True only
 * when history moved back or forward (`POP`) or the navigation carried `RESTORE_VIEW_STATE`; a tab, a
 * console card, a typed URL and a reload are all fresh opens.
 */
export function shouldRestoreView(navigationType: string, state: unknown): boolean {
  if (navigationType === "POP") return true;
  return typeof state === "object" && state !== null && (state as { restoreView?: unknown }).restoreView === true;
}

/**
 * Padding that keeps the map's centre in the part of the map the visitor can see: on a phone the
 * bottom sheet at half covers the lower half, so the centre moves up into the open half. Nothing on
 * a desk, where the floating panels leave the middle clear.
 */
export function sheetPadding(containerHeight: number, mobile: boolean): PaddingOptions {
  return { top: 0, bottom: mobile ? Math.round(containerHeight * 0.5) : 0, left: 0, right: 0 };
}
