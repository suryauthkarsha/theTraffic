/**
 * Geospatial primitives shared by the pipeline, the optimizer and the UI.
 * All distances in metres, bearings in degrees clockwise from north, coordinates WGS84.
 */
export type LngLat = [number, number];

const R = 6371008.8;
export const toRad = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Great-circle distance in metres between two [lng,lat] points. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees in [0,360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Circular angular difference Δθ = min(|h−θ|, 360−|h−θ|). */
export function angularDifference(h: number, θ: number): number {
  const d = Math.abs(((h - θ) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(start: LngLat, brg: number, dist: number): LngLat {
  const δ = dist / R;
  const θ = toRad(brg);
  const φ1 = toRad(start[1]);
  const λ1 = toRad(start[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(λ2), toDeg(φ2)];
}

/** Local equirectangular projection (metres) around a reference latitude — accurate for city-scale work. */
export function projector(refLat: number): { toXY: (p: LngLat) => [number, number]; fromXY: (xy: [number, number]) => LngLat } {
  const k = Math.cos(toRad(refLat));
  return {
    toXY: (p) => [toRad(p[0]) * R * k, toRad(p[1]) * R],
    fromXY: (xy) => [toDeg(xy[0] / (R * k)), toDeg(xy[1] / R)],
  };
}

/** Cumulative along-track distances for a polyline. */
export function cumulativeDistances(line: LngLat[]): number[] {
  const out = new Array<number>(line.length).fill(0);
  for (let i = 1; i < line.length; i++) out[i] = out[i - 1] + haversine(line[i - 1], line[i]);
  return out;
}

/**
 * Project a point onto a polyline. Returns the nearest segment index, the distance to the line,
 * the along-track distance from the start and the interpolated point.
 */
export function projectOntoPolyline(
  line: LngLat[],
  cum: number[],
  p: LngLat,
): { segment: number; distance_m: number; along_m: number; point: LngLat; fraction: number } {
  const proj = projector(p[1]);
  const P = proj.toXY(p);
  let best = { segment: 0, distance_m: Infinity, along_m: 0, point: line[0], fraction: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const A = proj.toXY(line[i]);
    const B = proj.toXY(line[i + 1]);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const X: [number, number] = [A[0] + t * dx, A[1] + t * dy];
    const d = Math.hypot(P[0] - X[0], P[1] - X[1]);
    if (d < best.distance_m) {
      const segLen = cum[i + 1] - cum[i];
      best = { segment: i, distance_m: d, along_m: cum[i] + t * segLen, point: proj.fromXY(X), fraction: t };
    }
  }
  return best;
}

/** Point on the polyline at along-track distance `s`. */
export function pointAtDistance(line: LngLat[], cum: number[], s: number): LngLat {
  if (s <= 0) return line[0];
  const total = cum[cum.length - 1];
  if (s >= total) return line[line.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < s) i++;
  const f = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f];
}

/** Bearing of a polyline at along-track distance s, measured over a window of `w` metres upstream. */
export function bearingAtDistance(line: LngLat[], cum: number[], s: number, w = 40): number {
  const a = pointAtDistance(line, cum, Math.max(0, s - w));
  const b = pointAtDistance(line, cum, Math.min(cum[cum.length - 1], s + 5));
  return bearing(a, b);
}

/** Simple uniform grid index for fast radius queries over a static point set. */
export class GridIndex<T extends { lat: number; lon: number }> {
  private cells = new Map<string, T[]>();
  private cellDeg: number;
  constructor(items: T[], cellMetres = 500) {
    this.cellDeg = cellMetres / 111_320;
    for (const it of items) {
      const k = this.key(it.lat, it.lon);
      const arr = this.cells.get(k) ?? [];
      arr.push(it);
      this.cells.set(k, arr);
    }
  }
  private key(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }
  /** Items within `radius` metres of (lat, lon), with distances. */
  within(lat: number, lon: number, radius: number): { item: T; distance_m: number }[] {
    const r = Math.ceil(radius / 111_320 / this.cellDeg) + 1;
    const cy = Math.floor(lat / this.cellDeg);
    const cx = Math.floor(lon / this.cellDeg);
    const out: { item: T; distance_m: number }[] = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const arr = this.cells.get(`${y}:${x}`);
        if (!arr) continue;
        for (const it of arr) {
          const d = haversine([lon, lat], [it.lon, it.lat]);
          if (d <= radius) out.push({ item: it, distance_m: d });
        }
      }
    }
    return out.sort((a, b) => a.distance_m - b.distance_m);
  }
}

/** Decode a Google/OSRM encoded polyline (precision 5 or 6) to [lng,lat] pairs. */
export function decodePolyline(str: string, precision = 5): LngLat[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: LngLat[] = [];
  const factor = 10 ** precision;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

export const BENGALURU_CENTER: LngLat = [77.5946, 12.9716];
export const BENGALURU_BBOX: [number, number, number, number] = [77.38, 12.78, 77.82, 13.18];
