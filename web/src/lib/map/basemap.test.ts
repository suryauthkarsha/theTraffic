// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { __resetBasemapForTests, applyBasemapMode, getBasemapMode, IMAGERY_TONE, isBasemapMode, isBasemapLine, isGroundFill, SATELLITE_LAYER_ID, setBasemapMode, subscribeBasemapMode } from "./basemap";
import { __resetBasemapHealthForTests, getBasemapReport, reportBasemapHealth } from "./basemapStatus";

/** Minimal MapLibre stand-in recording the style surgery `applyBasemapMode` performs. */
function fakeMap(layers: { id: string; type: string; source?: string }[]) {
  const sources = new Set<string>();
  const added: { id: string; before?: string }[] = [];
  const paint: Record<string, Record<string, unknown>> = {};
  const layout: Record<string, Record<string, unknown>> = {};
  const all = [...layers];
  return {
    added,
    paint,
    layout,
    getStyle: () => ({ layers: all }),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => sources.add(id),
    getLayer: (id: string) => all.find((l) => l.id === id),
    addLayer: (l: { id: string; type: string; source: string }, before?: string) => {
      added.push({ id: l.id, before });
      const i = before ? all.findIndex((x) => x.id === before) : -1;
      if (i >= 0) all.splice(i, 0, l);
      else all.push(l);
    },
    setPaintProperty: (id: string, k: string, v: unknown) => {
      (paint[id] ??= {})[k] = v;
    },
    setLayoutProperty: (id: string, k: string, v: unknown) => {
      (layout[id] ??= {})[k] = v;
    },
  };
}

const STYLE = [
  { id: "background", type: "background" },
  { id: "water", type: "fill", source: "openmaptiles" },
  { id: "landuse_park", type: "fill", source: "openmaptiles" },
  { id: "building", type: "fill", source: "openmaptiles" },
  { id: "highway_minor", type: "line", source: "openmaptiles" },
  { id: "highway_major_casing", type: "line", source: "openmaptiles" },
  { id: "highway_major_inner", type: "line", source: "openmaptiles" },
  { id: "place_city", type: "symbol", source: "openmaptiles" },
  { id: "signals-dot", type: "circle", source: "signals" },
  { id: "route-0-line", type: "line", source: "route-0" },
  { id: "route-signals-label", type: "symbol", source: "route-signals" },
];

describe("basemap mode store", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetBasemapForTests();
  });

  it("defaults to dark, persists satellite, notifies subscribers and rejects junk", () => {
    expect(getBasemapMode()).toBe("dark");
    let notified = 0;
    const off = subscribeBasemapMode(() => notified++);
    setBasemapMode("satellite");
    expect(getBasemapMode()).toBe("satellite");
    expect(localStorage.getItem("gw.basemap")).toBe("satellite");
    expect(notified).toBe(1);
    setBasemapMode("satellite"); // no-op, no extra notification
    expect(notified).toBe(1);
    setBasemapMode("plasma" as never);
    expect(getBasemapMode()).toBe("satellite");
    off();
    expect(isBasemapMode("dark")).toBe(true);
    expect(isBasemapMode("")).toBe(false);
  });
});

describe("applyBasemapMode", () => {
  it("classifies basemap layers and never touches the site's own layers", () => {
    expect(isGroundFill({ id: "water", type: "fill" })).toBe(true);
    expect(isGroundFill({ id: "building", type: "fill" })).toBe(true);
    expect(isGroundFill({ id: "highway_minor", type: "line" })).toBe(false);
    expect(isBasemapLine({ id: "highway_minor", type: "line", source: "openmaptiles" })).toBe(true);
    expect(isBasemapLine({ id: "route-0-line", type: "line", source: "route-0" })).toBe(false);
    expect(isBasemapLine({ id: "appr-x-line", type: "line", source: "appr-x" })).toBe(false);
  });

  it("satellite: inserts imagery right above the background, hides ground fills and casings, lightens roads and labels", () => {
    const map = fakeMap(STYLE);
    applyBasemapMode(map as never, "satellite");
    expect(map.added).toEqual([{ id: SATELLITE_LAYER_ID, before: "water" }]);
    expect(map.paint[SATELLITE_LAYER_ID]["raster-opacity"]).toBe(1);
    // the city map's imagery is held well under white so the faintest 3 px dots still read on it (user, 2026-09-09)
    expect(map.paint[SATELLITE_LAYER_ID]["raster-brightness-max"]).toBe(IMAGERY_TONE.standard.brightnessMax);
    expect(IMAGERY_TONE.standard.brightnessMax).toBeLessThanOrEqual(0.65);
    expect(IMAGERY_TONE.standard.saturation).toBeLessThanOrEqual(-0.3);
    expect(map.layout.water.visibility).toBe("none");
    expect(map.layout.building.visibility).toBe("none");
    expect(map.layout.highway_major_casing.visibility).toBe("none");
    expect(map.paint.highway_major_inner["line-opacity"]).toBeLessThan(0.5);
    expect(map.paint.place_city["text-color"]).toBe("#F7F3EE");
    // our own layers are untouched
    expect(map.paint["signals-dot"]).toBeUndefined();
    expect(map.paint["route-0-line"]).toBeUndefined();
    expect(map.paint["route-signals-label"]).toBeUndefined();
  });

  it("dark: restores fills, casings and the night tint without re-adding the imagery layer", () => {
    const map = fakeMap(STYLE);
    applyBasemapMode(map as never, "satellite");
    applyBasemapMode(map as never, "dark");
    expect(map.added).toHaveLength(1);
    expect(map.paint[SATELLITE_LAYER_ID]["raster-opacity"]).toBe(0);
    expect(map.layout[SATELLITE_LAYER_ID].visibility).toBe("none");
    expect(map.layout.water.visibility).toBe("visible");
    expect(map.paint.water["fill-color"]).toBe("#020202");
    expect(map.layout.highway_major_casing.visibility).toBe("visible");
    expect(map.paint.highway_major_inner["line-opacity"]).toBe(1);
    expect(map.paint.highway_major_inner["line-color"]).toBe("#33302B"); // warm near-black tint, no blue cast (black & orange, 2026-09-08)
    expect(map.paint.place_city["text-color"]).toBe("#6B6560");
  });

  it("works on the plain fallback style (background only)", () => {
    const map = fakeMap([{ id: "background", type: "background" }]);
    applyBasemapMode(map as never, "satellite");
    expect(map.added).toEqual([{ id: SATELLITE_LAYER_ID, before: undefined }]);
  });

  it("dim imagery (the junction page): the brightest pixel is held at half and most colour drained, so an orange dot is the warmest thing in the frame; standard restores the city-map exposure", () => {
    const map = fakeMap(STYLE);
    applyBasemapMode(map as never, "satellite", { imagery: "dim" });
    const paint = map.paint[SATELLITE_LAYER_ID];
    expect(paint["raster-opacity"]).toBe(1);
    expect(paint["raster-brightness-max"]).toBe(IMAGERY_TONE.dim.brightnessMax);
    expect(IMAGERY_TONE.dim.brightnessMax).toBeLessThanOrEqual(0.5);
    expect(IMAGERY_TONE.dim.brightnessMax).toBeLessThan(IMAGERY_TONE.standard.brightnessMax); // the junction page stays the darker of the two
    expect(IMAGERY_TONE.dim.saturation).toBeLessThan(IMAGERY_TONE.standard.saturation);
    expect(paint["raster-saturation"]).toBe(IMAGERY_TONE.dim.saturation);
    // roads and labels keep the satellite tint: the imagery is dimmed, not the vector layers
    expect(map.paint.highway_major_inner["line-opacity"]).toBeLessThan(0.5);
    expect(map.paint.place_city["text-color"]).toBe("#F7F3EE");
    applyBasemapMode(map as never, "satellite");
    expect(map.paint[SATELLITE_LAYER_ID]["raster-brightness-max"]).toBe(IMAGERY_TONE.standard.brightnessMax);
    expect(map.added).toHaveLength(1); // the tone is a paint change, never a second imagery layer
  });
});

describe("basemap report (the rail's BASEMAP item)", () => {
  beforeEach(() => __resetBasemapHealthForTests());

  it("carries the mode the mounted map actually shows, so a map pinned to satellite reports satellite whatever the shared toggle says", () => {
    expect(getBasemapReport()).toEqual({ health: "none", mode: null });
    reportBasemapHealth("loading", "satellite");
    expect(getBasemapReport()).toEqual({ health: "loading", mode: "satellite" });
    reportBasemapHealth("ok"); // no mode given: the mode already reported stays
    expect(getBasemapReport()).toEqual({ health: "ok", mode: "satellite" });
    reportBasemapHealth("ok", "dark"); // the shared toggle flipped on a map that follows it
    expect(getBasemapReport()).toEqual({ health: "ok", mode: "dark" });
    reportBasemapHealth("none", "dark"); // unmount: no map, no mode
    expect(getBasemapReport()).toEqual({ health: "none", mode: null });
  });
});
