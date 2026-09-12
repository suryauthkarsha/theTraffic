/**
 * ASCII trefoil knot renderer (pure). The tube geometry is computed once; each frame rotates the
 * samples around X (angle A) and Y (angle B), projects them onto an 80×40 character grid with a
 * z-buffer and shades every cell with a Lambert term mapped onto the brightness ramp
 * `.,-~:;=!*#$@`. The React component in `components/ui/knot-animation.tsx` is a thin painter over
 * this module; `knotFrame` + `frameToText` / `frameToHtml` are what the tests exercise.
 */

export const KNOT_W = 80;
export const KNOT_H = 40;

/** Brightness ramp, darkest → brightest. */
export const KNOT_RAMP = ".,-~:;=!*#$@";

const TUBE_RADIUS = 0.3;
const U_STEP = 0.06;
const V_STEP = 0.2;
const CAMERA_Z = 5.0;
const TWO_PI = Math.PI * 2;

type Vec3 = { x: number; y: number; z: number };

const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vmul = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vnorm = (v: Vec3): Vec3 => vmul(v, 1 / Math.sqrt(vdot(v, v)));
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

const LIGHT: Vec3 = vnorm({ x: -1, y: 1, z: -1 });

interface TubeGeometry {
  /** Surface points, 3 floats per sample. */
  points: Float64Array;
  /** Unit normals, 3 floats per sample. */
  normals: Float64Array;
  /** Tube segment index per sample (drives the colour cycle). */
  segment: Uint16Array;
  /** Number of tube segments (u steps). */
  segments: number;
}

let geometry: TubeGeometry | null = null;

/** Trefoil tube samples — position + normal per (u, v). Built lazily, once per module. */
function tubeGeometry(): TubeGeometry {
  if (geometry) return geometry;
  const pts: number[] = [];
  const nrm: number[] = [];
  const seg: number[] = [];
  let segments = 0;
  for (let u = 0; u < TWO_PI; u += U_STEP, segments++) {
    const C: Vec3 = { x: Math.sin(u) + 2 * Math.sin(2 * u), y: Math.cos(u) - 2 * Math.cos(2 * u), z: -Math.sin(3 * u) };
    const T = vnorm({ x: Math.cos(u) + 4 * Math.cos(2 * u), y: -Math.sin(u) + 4 * Math.sin(2 * u), z: -3 * Math.cos(3 * u) });
    const up: Vec3 = Math.abs(vdot(T, { x: 0, y: 1, z: 0 })) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const N = vnorm(cross(T, up));
    const Bn = cross(T, N);
    for (let v = 0; v < TWO_PI; v += V_STEP) {
      const offs = vadd(vmul(N, Math.cos(v) * TUBE_RADIUS), vmul(Bn, Math.sin(v) * TUBE_RADIUS));
      const p = vadd(C, offs);
      const n = vnorm(offs);
      pts.push(p.x, p.y, p.z);
      nrm.push(n.x, n.y, n.z);
      seg.push(segments);
    }
  }
  geometry = { points: Float64Array.from(pts), normals: Float64Array.from(nrm), segment: Uint16Array.from(seg), segments };
  return geometry;
}

export interface KnotFrame {
  /** Ramp index + 1 per cell; 0 = blank. Row-major, KNOT_W × KNOT_H. */
  cells: Uint8Array;
  /** Tube segment index per cell (meaningful only where `cells` > 0). */
  segment: Uint16Array;
  /** Number of tube segments, for palette cycling. */
  segments: number;
}

/** Render one frame of the knot rotated by A (about X) and B (about Y). */
export function knotFrame(A: number, B: number): KnotFrame {
  const g = tubeGeometry();
  const cells = new Uint8Array(KNOT_W * KNOT_H);
  const segment = new Uint16Array(KNOT_W * KNOT_H);
  const zbuf = new Float64Array(KNOT_W * KNOT_H);

  const cA = Math.cos(A);
  const sA = Math.sin(A);
  const cB = Math.cos(B);
  const sB = Math.sin(B);
  const maxRamp = KNOT_RAMP.length - 1;

  for (let i = 0, k = 0; i < g.segment.length; i++, k += 3) {
    const px0 = g.points[k];
    const py0 = g.points[k + 1];
    const pz0 = g.points[k + 2];
    const y1 = py0 * cA - pz0 * sA;
    const z1 = py0 * sA + pz0 * cA;
    const x2 = px0 * cB + z1 * sB;
    const z2 = -px0 * sB + z1 * cB + CAMERA_Z;
    const invz = 1 / z2;
    const px = Math.floor(KNOT_W / 2 + 40 * x2 * invz);
    const py = Math.floor(KNOT_H / 2 - 20 * y1 * invz);
    if (px < 0 || px >= KNOT_W || py < 0 || py >= KNOT_H) continue;
    const idx = px + py * KNOT_W;
    if (invz <= zbuf[idx]) continue;
    zbuf[idx] = invz;

    const nx0 = g.normals[k];
    const ny0 = g.normals[k + 1];
    const nz0 = g.normals[k + 2];
    const ny1 = ny0 * cA - nz0 * sA;
    const nz1 = ny0 * sA + nz0 * cA;
    const nx2 = nx0 * cB + nz1 * sB;
    const nz2 = -nx0 * sB + nz1 * cB;
    const lum = Math.max(0, nx2 * LIGHT.x + ny1 * LIGHT.y + nz2 * LIGHT.z);
    cells[idx] = Math.floor(lum * maxRamp) + 1;
    segment[idx] = g.segment[i];
  }
  return { cells, segment, segments: g.segments };
}

/** Plain-text rendering: KNOT_H lines of KNOT_W characters joined by "\n". */
export function frameToText(f: KnotFrame): string {
  const lines: string[] = [];
  for (let y = 0; y < KNOT_H; y++) {
    let line = "";
    for (let x = 0; x < KNOT_W; x++) {
      const c = f.cells[x + y * KNOT_W];
      line += c === 0 ? " " : KNOT_RAMP[c - 1];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

const SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]+$/;

/** Only CSS colour literals survive into the markup (palette entries come from code, never users). */
export function safeColor(c: string): string {
  return SAFE_COLOR.test(c) ? c : "inherit";
}

/**
 * Coloured rendering as HTML: consecutive cells of one tube segment become a single
 * `<span style="color:…">` run, so a frame is ~1 000 short runs instead of 3 200 spans.
 * Characters are restricted to the ramp and spaces, so no escaping beyond the colour is needed.
 */
export function frameToHtml(f: KnotFrame, palette: readonly string[]): string {
  if (palette.length === 0) return frameToText(f);
  const colours = palette.map(safeColor);
  const lines: string[] = [];
  for (let y = 0; y < KNOT_H; y++) {
    let line = "";
    let run = "";
    let runColour = -1;
    const flush = () => {
      if (run.length === 0) return;
      line += runColour < 0 ? run : `<span style="color:${colours[runColour]}">${run}</span>`;
      run = "";
    };
    for (let x = 0; x < KNOT_W; x++) {
      const idx = x + y * KNOT_W;
      const c = f.cells[idx];
      const colour = c === 0 ? -1 : f.segment[idx] % colours.length;
      if (colour !== runColour) {
        flush();
        runColour = colour;
      }
      run += c === 0 ? " " : KNOT_RAMP[c - 1];
    }
    flush();
    lines.push(line);
  }
  return lines.join("\n");
}
