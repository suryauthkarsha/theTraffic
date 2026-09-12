import { describe, expect, it } from "vitest";

import { haversine } from "@/lib/geo";

import { CONE_RADIUS_M, DENSITY_RAMP, densityColor, densityGrid, directionCones, gridCellDegrees } from "./geometry";
import { normalizeCamera, type RawCameraRecord } from "./normalize";

const cam = (id: number, lon: number, lat: number, tags: Record<string, string> = {}) => normalizeCamera({ id, lat, lon, v: 1, t: "2023-01-01T00:00:00Z", tags } as RawCameraRecord);

describe("density grid (the flat alternative to a heatmap)", () => {
  it("cells are about 500 m square at Bengaluru's latitude", () => {
    const { dLon, dLat } = gridCellDegrees();
    expect(haversine([77.59, 12.97], [77.59 + dLon, 12.97])).toBeCloseTo(500, -1);
    expect(haversine([77.59, 12.97], [77.59, 12.97 + dLat])).toBeCloseTo(500, -1);
  });

  it("counts records per cell, emits no empty cells, and keeps cells fixed to the same anchor whatever the filter", () => {
    const a = densityGrid([cam(1, 77.5901, 12.9701), cam(2, 77.5902, 12.9702), cam(3, 77.7, 13.05)]);
    expect(a.features).toHaveLength(2);
    expect(a.features.map((f) => f.properties.count).sort()).toEqual([1, 2]);
    const b = densityGrid([cam(1, 77.5901, 12.9701)]);
    const keyA = a.features.find((f) => f.properties.count === 2)?.properties.key;
    expect(b.features[0].properties.key).toBe(keyA);
    expect(b.features[0].geometry.coordinates[0]).toHaveLength(5); // closed ring
    expect(densityGrid([]).features).toEqual([]);
  });

  it("colours are one hue from dark to the accent, stepping up with the count — never green, never grey", () => {
    expect(densityColor(1)).toBe(DENSITY_RAMP[0].color);
    expect(densityColor(2)).toBe(DENSITY_RAMP[0].color);
    expect(densityColor(3)).toBe(DENSITY_RAMP[1].color);
    expect(densityColor(999)).toBe("#FF8A2B");
    for (const s of DENSITY_RAMP) {
      const n = parseInt(s.color.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
  });
});

describe("direction cones", () => {
  it("draws one wedge per parsable heading, about CONE_RADIUS_M long, and none for records without a direction", () => {
    const fc = directionCones([cam(1, 77.59, 12.97, { "camera:direction": "90" }), cam(2, 77.59, 12.97, { "camera:direction": "0;180" }), cam(3, 77.59, 12.97, { "camera:direction": "-75" }), cam(4, 77.59, 12.97)]);
    expect(fc.features.map((f) => f.properties.id)).toEqual(["1", "2", "2"]);
    expect(fc.features.map((f) => f.properties.heading)).toEqual([90, 0, 180]);
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual([77.59, 12.97]);
    expect(ring[ring.length - 1]).toEqual([77.59, 12.97]);
    const tip = ring[Math.floor(ring.length / 2)];
    expect(haversine([77.59, 12.97], tip as [number, number])).toBeCloseTo(CONE_RADIUS_M, 0);
    expect(tip[0]).toBeGreaterThan(77.59); // heading 90 points east
  });
});
