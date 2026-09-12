import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";

import { destination, type LngLat } from "@/lib/geo";
import { insideBengaluru } from "@/lib/grievance/grievance";

/**
 * "Where am I?" for every city map (user request 2026-09-11: navigate and recentre to the correct
 * location). One position request at the press — never a watch — and the map flies to the fix with a
 * flat marker: a warm-white disc with a black casing at the point and a hairline ring for the reported
 * accuracy. A fix outside Bengaluru is refused with one sentence: this is a map of one city.
 *
 * Nothing about the position is kept once the map moves on; the marker is cleared when the map
 * unmounts. Pure functions here are tested; the browser call is the one line in `locateOnce`.
 */
export interface LocationFix {
  point: LngLat;
  /** Radius the device reported, metres (null when it gave none). */
  accuracyM: number | null;
}

export type LocateFailure = "unsupported" | "denied" | "unavailable" | "timeout" | "outside";

export const LOCATE_FAILURE_TEXT: Record<LocateFailure, string> = {
  unsupported: "This browser has no location.",
  denied: "Location is off for this site — allow it in the browser to use this.",
  unavailable: "Location unavailable right now.",
  timeout: "Location took too long — try again.",
  outside: "Your device puts you outside Bengaluru — this map covers the city alone.",
};

/** Source and layer ids carry the `gw-` prefix so the basemap re-tint leaves them alone. */
export const LOCATE_SOURCE = "gw-me";
export const LOCATE_LAYER = { accuracy: "gw-me-accuracy", ring: "gw-me-accuracy-line", dot: "gw-me-dot" } as const;

const MARK = "#F3EFE9";
const CASING = "#000000";

/** The zoom a fix is shown at: close enough to see the kerb, wider when the accuracy is poor. Pure. */
export function locateZoom(accuracyM: number | null, current: number): number {
  const wanted = accuracyM === null ? 16.5 : accuracyM > 500 ? 14 : accuracyM > 150 ? 15.5 : 16.5;
  return Math.max(current, wanted);
}

/** A 48-point polygon approximating the accuracy circle; null when the radius is unknown or under 8 m (the dot covers it). Pure. */
export function accuracyPolygon(center: LngLat, accuracyM: number | null): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM < 8) return null;
  const r = Math.min(accuracyM, 5000);
  const ring: LngLat[] = [];
  for (let i = 0; i <= 48; i++) ring.push(destination(center, (i * 360) / 48, r));
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

/** Classify a GeolocationPositionError by its code. Pure. */
export function failureFor(code: number): LocateFailure {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

export interface GeolocationLike {
  getCurrentPosition(success: (pos: { coords: { longitude: number; latitude: number; accuracy: number } }) => void, error: (err: { code: number }) => void, options?: PositionOptions): void;
}

export type LocateResult = { ok: true; fix: LocationFix } | { ok: false; reason: LocateFailure };

/** One position request. Resolves with a fix inside Bengaluru, or the reason there is none. */
export function locateOnce(geo: GeolocationLike | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation): Promise<LocateResult> {
  if (!geo) return Promise.resolve({ ok: false, reason: "unsupported" });
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => {
        const point: LngLat = [pos.coords.longitude, pos.coords.latitude];
        if (!insideBengaluru(point)) {
          resolve({ ok: false, reason: "outside" });
          return;
        }
        resolve({ ok: true, fix: { point, accuracyM: Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy > 0 ? pos.coords.accuracy : null } });
      },
      (err) => resolve({ ok: false, reason: failureFor(err.code) }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

/** Draw (or move) the fix marker; `null` clears it. Idempotent across style reloads — call again after `style.load`. */
export function upsertLocateMarker(map: MlMap, fix: LocationFix | null): void {
  const circle = fix ? accuracyPolygon(fix.point, fix.accuracyM) : null;
  const accuracy: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: circle ? [circle] : [] };
  const dot: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: fix ? [{ type: "Feature", geometry: { type: "Point", coordinates: fix.point }, properties: {} }] : [] };
  const src = map.getSource(LOCATE_SOURCE) as GeoJSONSource | undefined;
  const acc = map.getSource(`${LOCATE_SOURCE}-accuracy`) as GeoJSONSource | undefined;
  if (src && acc) {
    acc.setData(accuracy);
    src.setData(dot);
    return;
  }
  map.addSource(`${LOCATE_SOURCE}-accuracy`, { type: "geojson", data: accuracy });
  map.addLayer({ id: LOCATE_LAYER.accuracy, type: "fill", source: `${LOCATE_SOURCE}-accuracy`, paint: { "fill-color": MARK, "fill-opacity": 0.08 } });
  map.addLayer({ id: LOCATE_LAYER.ring, type: "line", source: `${LOCATE_SOURCE}-accuracy`, paint: { "line-color": MARK, "line-width": 1, "line-opacity": 0.7 } });
  map.addSource(LOCATE_SOURCE, { type: "geojson", data: dot });
  map.addLayer({
    id: LOCATE_LAYER.dot,
    type: "circle",
    source: LOCATE_SOURCE,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 5.5, 17, 7], "circle-color": MARK, "circle-opacity": 1, "circle-stroke-color": CASING, "circle-stroke-width": 1.5, "circle-stroke-opacity": 1 },
  });
}
