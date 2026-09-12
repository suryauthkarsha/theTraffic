import { describe, expect, it } from "vitest";

import { normalizeCamera, type RawCameraRecord } from "@/lib/surveillance/normalize";

import { CAMERA_COLORS, CAMERA_LAYER, camerasToGeoJSON, CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, clusterRadiusExpression, CONE_LAYER, CONE_MIN_ZOOM, DENSITY_ICON_MIN_ZOOM, densityColorExpression, drawCameraGlyph, GRID_LAYER } from "./cameraLayers";
import { COLORS } from "./layers";

describe("surveillance map layers", () => {
  it("a camera never looks like a signal: warm-white glyphs and discs against orange dots, and every layer id is left alone by the basemap re-tint", () => {
    expect(CAMERA_COLORS.mark).toBe("#F3EFE9");
    expect(CAMERA_COLORS.mark).not.toBe(COLORS.orange);
    expect(CAMERA_COLORS.mark).not.toBe(COLORS.dim);
    for (const id of [...Object.values(CAMERA_LAYER), ...Object.values(GRID_LAYER), CONE_LAYER]) expect(id.startsWith("gw-")).toBe(true);
  });

  it("clusters at city zoom, single glyphs close up; the density view holds glyphs back until cells would be bigger than the screen", () => {
    expect(CLUSTER_MAX_ZOOM).toBe(14);
    expect(DENSITY_ICON_MIN_ZOOM).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    expect(CONE_MIN_ZOOM).toBeGreaterThanOrEqual(DENSITY_ICON_MIN_ZOOM);
    expect(clusterRadiusExpression()).toEqual(["step", ["get", "point_count"], 12, 10, 16, 50, 21, 200, 27]);
    expect(CLUSTER_RADIUS.map((s) => s.radius)).toEqual([12, 16, 21, 27]);
    expect(densityColorExpression()).toEqual(["step", ["get", "count"], "#5E3614", 3, "#8A4A18", 6, "#A0561F", 11, "#C0651C", 21, "#FF8A2B"]);
  });

  it("feature properties carry only the OSM id — tags stay in the record, not in the tile", () => {
    const fc = camerasToGeoJSON([normalizeCamera({ id: 42, lat: 12.9, lon: 77.6, v: 1, t: "2023-01-01T00:00:00Z", tags: { operator: "BTP" } } as RawCameraRecord)]);
    expect(fc.features[0]).toEqual({ type: "Feature", geometry: { type: "Point", coordinates: [77.6, 12.9] }, properties: { id: "42" } });
  });

  it("the glyph is drawn flat: fills and casing strokes only, no shadow or gradient", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop: string) => {
        if (prop === "shadowBlur" || prop === "createRadialGradient") throw new Error(`glow primitive ${prop} used`);
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.map(String).join(",")})`);
        };
      },
      set: (_t, prop: string, value: unknown) => {
        if (prop === "shadowBlur" || prop === "shadowColor") throw new Error(`glow primitive ${prop} set`);
        calls.push(`${prop}=${String(value)}`);
        return true;
      },
    });
    drawCameraGlyph(ctx, 48);
    expect(calls.filter((c) => c.startsWith("fill("))).toHaveLength(4);
    expect(calls.filter((c) => c.startsWith("stroke("))).toHaveLength(2);
    expect(calls).toContain("strokeStyle=#000000");
    expect(calls).toContain(`fillStyle=${CAMERA_COLORS.mark}`);
  });
});
