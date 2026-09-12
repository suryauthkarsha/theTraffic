import type { Map as MlMap, PointLike } from "maplibre-gl";

/**
 * Hit-testing for the flat signal dots. A dot is 2.5–5 px across at city zoom — far smaller than a
 * fingertip — so a click or tap is matched to the NEAREST dot within a tolerance around the pointer
 * instead of requiring the exact pixel under it to be painted. The pure parts are exported for tests.
 */

/** Half-width in px of the square around the pointer in which a dot still counts as hit. */
export const HIT_TOLERANCE_PX = {
  /** Mouse / trackpad: a little slack so a 3 px disc does not need pixel-perfect aim. */
  fine: 10,
  /** Finger or pen: roughly half a fingertip. */
  coarse: 22,
} as const;

/**
 * Tolerance for one pointer event. Modern browsers dispatch `click` as a PointerEvent whose
 * `pointerType` says what produced it; when that is missing, the `(pointer: coarse)` media query
 * result for the device decides.
 */
export function hitTolerance(pointerType: string | undefined, coarseDevice: boolean): number {
  if (pointerType === "touch" || pointerType === "pen") return HIT_TOLERANCE_PX.coarse;
  if (pointerType === "mouse") return HIT_TOLERANCE_PX.fine;
  return coarseDevice ? HIT_TOLERANCE_PX.coarse : HIT_TOLERANCE_PX.fine;
}

export interface ScreenHit {
  id: string;
  x: number;
  y: number;
}

/** The candidate nearest to `point` within `tolerance` px (Euclidean), or null. Ties keep the first. */
export function pickNearest(point: { x: number; y: number }, hits: readonly ScreenHit[], tolerance: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - point.x, h.y - point.y);
    if (d <= tolerance && d < bestDistance) {
      bestDistance = d;
      best = h.id;
    }
  }
  return best;
}

/** `pointerType` of the DOM event behind a MapLibre event, when the browser provides one. */
export function pointerTypeOf(e: unknown): string | undefined {
  const t = (e as { pointerType?: unknown } | null | undefined)?.pointerType;
  return typeof t === "string" ? t : undefined;
}

/**
 * Id of the signal dot nearest to a screen point, or null when no dot on `layerId` lies within
 * `tolerance` px. Safe to call before the layer exists (returns null).
 */
export function signalAt(map: MlMap, layerId: string, point: { x: number; y: number }, tolerance: number): string | null {
  if (!map.getLayer(layerId)) return null;
  const box: [PointLike, PointLike] = [
    [point.x - tolerance, point.y - tolerance],
    [point.x + tolerance, point.y + tolerance],
  ];
  const hits: ScreenHit[] = [];
  try {
    for (const f of map.queryRenderedFeatures(box, { layers: [layerId] })) {
      if (f.geometry.type !== "Point") continue;
      const id = (f.properties as { id?: unknown } | null)?.id;
      if (typeof id !== "string") continue;
      const p = map.project(f.geometry.coordinates as [number, number]);
      hits.push({ id, x: p.x, y: p.y });
    }
  } catch {
    return null;
  }
  return pickNearest(point, hits, tolerance);
}
