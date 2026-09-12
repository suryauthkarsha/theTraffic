import { describe, expect, it } from "vitest";

import type { Map as MlMap } from "maplibre-gl";

import { CASING, COLORS, delayColor, intersectionsToGeoJSON, SIGNAL_DOT, upsertLine, upsertSignalLayer } from "./layers";
import layersSource from "./layers.ts?raw";

interface Layer {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/** Minimal MapLibre stand-in that records the layers a helper adds. */
function fakeMap(): { map: MlMap; layers: Layer[]; layer: (id: string) => Layer } {
  const layers: Layer[] = [];
  const sources = new Set<string>();
  const map = {
    getSource: (id: string) => (sources.has(id) ? { setData: () => undefined } : undefined),
    addSource: (id: string) => sources.add(id),
    addLayer: (l: Layer) => layers.push(l),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    setPaintProperty: (id: string, k: string, v: unknown) => {
      const l = layers.find((x) => x.id === id);
      if (l) (l.paint ??= {})[k] = v;
    },
    setLayoutProperty: (id: string, k: string, v: unknown) => {
      const l = layers.find((x) => x.id === id);
      if (l) (l.layout ??= {})[k] = v;
    },
  } as unknown as MlMap;
  return {
    map,
    layers,
    layer: (id) => {
      const l = layers.find((x) => x.id === id);
      if (!l) throw new Error(`layer ${id} missing`);
      return l;
    },
  };
}

/** Every green the product ever used — none may come back anywhere on the map. */
const GREENS = ["#32d583", "#7ed9a8", "rgba(50,213,131", "#1f7a57", "#cdf8e2", "rgba(18,54,48"];

/** Every grey the map's markers ever used — no marker on the map is grey (user decision 2026-09-08). */
const MARKER_GREYS = ["#67605a", "#8c8378", "#332f2c", "#9a928a"];

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** HSL lightness of an #rrggbb colour, 0–1. */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return (Math.max(...c) + Math.min(...c)) / 2;
}

/** Hue of an #rrggbb colour in degrees. */
function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe("flat signal dots (user decision 2026-09-08: 'instead of the glow, just add orange dots')", () => {
  it("draws every signal as ONE solid disc in its own colour with a hairline black casing — no bloom layer, no blur", () => {
    const { map, layers, layer } = fakeMap();
    upsertSignalLayer(map, "signals", EMPTY);
    expect(layers.map((l) => l.id)).toEqual(["signals-dot"]); // one layer: the glow's `-halo` bloom is gone
    const dot = layer("signals-dot");
    expect(dot.type).toBe("circle");
    expect(dot.paint?.["circle-color"]).toEqual(["get", "color"]); // the dot IS the semantic colour, not a lifted core
    expect(dot.paint?.["circle-opacity"]).toBe(1); // solid
    expect(dot.paint).not.toHaveProperty("circle-blur"); // flat: no soft edge anywhere
    expect(dot.paint?.["circle-stroke-color"]).toBe(CASING);
    expect(dot.paint?.["circle-stroke-width"]).toBe(SIGNAL_DOT.strokeWidth);
    expect(SIGNAL_DOT.strokeWidth).toBeLessThanOrEqual(1); // a hairline, never a ring
    expect(dot.paint?.["circle-radius"]).toEqual(["interpolate", ["linear"], ["zoom"], 10, SIGNAL_DOT.minRadius, 14, ["get", "radius"], 17, ["*", ["get", "radius"], SIGNAL_DOT.scale17]]);
  });

  it("lets a screen pick the overview radius (the junction page's nodes)", () => {
    const { map, layer } = fakeMap();
    upsertSignalLayer(map, "nodes", EMPTY, { minRadius: 4 });
    expect(layer("nodes-dot").paint?.["circle-radius"]).toEqual(["interpolate", ["linear"], ["zoom"], 10, 4, 14, ["get", "radius"], 17, ["*", ["get", "radius"], SIGNAL_DOT.scale17]]);
  });

  it("puts only the semantic colour into each GeoJSON feature — no core colour, no heat weight", () => {
    const inter = { id: "gw-1", canonical_name: "X", lat: 12.9, lon: 77.6 } as never;
    const fc = intersectionsToGeoJSON([inter], () => ({ color: COLORS.dim, value: null }));
    expect(fc.features[0].properties.color).toBe(COLORS.dim);
    expect(fc.features[0].properties).not.toHaveProperty("core");
    expect(fc.features[0].properties).not.toHaveProperty("weight");
    expect(fc.features[0].properties.radius).toBe(3.5);
  });

  it("nothing blurred is left in the map module: no heat surface, no blur, no glow (user decision 2026-09-08: 'kindly remove the glow')", () => {
    expect(layersSource).not.toMatch(/type: "heatmap"|heatmap-|circle-blur|line-blur|HEAT_|HeatRamp|Heatmap/); // code tokens, not the prose that records why they left
  });

  it("has no grey marker colour: 'nothing known' is a dark orange that still reads as a flat 3 px dot on black", () => {
    expect(COLORS).not.toHaveProperty("grey");
    for (const c of Object.values(COLORS)) for (const g of MARKER_GREYS) expect(c.toLowerCase()).not.toBe(g);
    expect(hue(COLORS.dim)).toBeGreaterThan(15);
    expect(hue(COLORS.dim)).toBeLessThan(40); // orange hue
    expect(lightness(COLORS.dim)).toBeGreaterThan(0.28); // visible without a glow to lift it
    expect(lightness(COLORS.dim)).toBeLessThan(lightness(COLORS.ember)); // dimmer than "partial"
    expect(delayColor(null, "E")).toBe(COLORS.dim);
  });

  it("keeps a line's casing crisp and canvas-dark — nothing on the map blurs", () => {
    const { map, layer } = fakeMap();
    upsertLine(map, "appr-0", [[77.5, 12.9], [77.6, 12.95]], { color: COLORS.orange, width: 4, halo: true });
    const casing = layer("appr-0-halo");
    expect(casing.paint?.["line-color"]).toBe(CASING);
    expect(casing.paint).not.toHaveProperty("line-blur");
  });

  it("the map palette is black & orange: no green anywhere, ember for the middle, red for trouble", () => {
    expect(COLORS).not.toHaveProperty("green");
    expect(COLORS).not.toHaveProperty("amber");
    expect(COLORS).not.toHaveProperty("alt"); // the alternative-route grey left with the planner (2026-09-08)
    for (const c of Object.values(COLORS)) for (const g of GREENS) expect(c.toLowerCase()).not.toContain(g);
    expect(delayColor(10, "C")).toBe(COLORS.orange);
    expect(delayColor(40, "C")).toBe(COLORS.ember);
    expect(delayColor(90, "C")).toBe(COLORS.red);
    expect(delayColor(null, "E")).toBe(COLORS.dim);
    expect(CASING).toBe("#000000");
  });

});
