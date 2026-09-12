import { destination, type LngLat } from "@/lib/geo";

import type { Camera } from "./normalize";

/**
 * Derived geometry for the Surveillance map: a flat density grid (the "Density" view — square cells
 * coloured by count, no blur, because a heatmap is a blur by construction) and the small viewing
 * cones drawn from mapped `camera:direction` headings at close zoom.
 */

/** Density cell edge in metres. */
export const GRID_CELL_M = 500;
/** Cells are anchored here so the same place always falls in the same cell whatever the filter. */
export const GRID_ORIGIN: LngLat = [77.3, 12.7];
const METRES_PER_DEG_LAT = 111_320;
/** Reference latitude for the longitude scale (the city centre). */
const REF_LAT = 12.97;

export interface GridCellProps {
  count: number;
  key: string;
}

/** Degrees of longitude and latitude one cell spans. */
export function gridCellDegrees(cellM = GRID_CELL_M): { dLon: number; dLat: number } {
  return { dLon: cellM / (METRES_PER_DEG_LAT * Math.cos((REF_LAT * Math.PI) / 180)), dLat: cellM / METRES_PER_DEG_LAT };
}

/** Square cells with the number of records inside each; empty cells are not emitted. Pure. */
export function densityGrid(points: readonly { lon: number; lat: number }[], cellM = GRID_CELL_M): GeoJSON.FeatureCollection<GeoJSON.Polygon, GridCellProps> {
  const { dLon, dLat } = gridCellDegrees(cellM);
  const counts = new Map<string, number>();
  for (const p of points) {
    const i = Math.floor((p.lon - GRID_ORIGIN[0]) / dLon);
    const j = Math.floor((p.lat - GRID_ORIGIN[1]) / dLat);
    const key = `${i}:${j}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const features: GeoJSON.Feature<GeoJSON.Polygon, GridCellProps>[] = [];
  for (const [key, count] of counts) {
    const [i, j] = key.split(":").map(Number);
    const x0 = GRID_ORIGIN[0] + i * dLon;
    const y0 = GRID_ORIGIN[1] + j * dLat;
    const x1 = x0 + dLon;
    const y1 = y0 + dLat;
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
          ],
        ],
      },
      properties: { count, key },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Flat one-hue ramp for cell counts: records per cell → fill. Exported for the legend. */
export const DENSITY_RAMP: readonly { from: number; color: string }[] = [
  { from: 1, color: "#5E3614" },
  { from: 3, color: "#8A4A18" },
  { from: 6, color: "#A0561F" },
  { from: 11, color: "#C0651C" },
  { from: 21, color: "#FF8A2B" },
];

export function densityColor(count: number): string {
  let color = DENSITY_RAMP[0].color;
  for (const step of DENSITY_RAMP) if (count >= step.from) color = step.color;
  return color;
}

/** How far a cone reaches (m) and its half-angle (°). Illustrative — OSM records a heading, not a field of view. */
export const CONE_RADIUS_M = 30;
export const CONE_HALF_ANGLE_DEG = 30;

export interface ConeProps {
  id: string;
  heading: number;
}

/** One wedge per mapped heading, only for records with a parsable direction. Pure. */
export function directionCones(cameras: readonly Camera[], radiusM = CONE_RADIUS_M, halfAngle = CONE_HALF_ANGLE_DEG): GeoJSON.FeatureCollection<GeoJSON.Polygon, ConeProps> {
  const features: GeoJSON.Feature<GeoJSON.Polygon, ConeProps>[] = [];
  const steps = 6;
  for (const c of cameras) {
    for (const heading of c.directions) {
      const centre: LngLat = [c.lon, c.lat];
      const ring: LngLat[] = [centre];
      for (let k = 0; k <= steps; k++) ring.push(destination(centre, heading - halfAngle + (2 * halfAngle * k) / steps, radiusM));
      ring.push(centre);
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { id: String(c.id), heading } });
    }
  }
  return { type: "FeatureCollection", features };
}
