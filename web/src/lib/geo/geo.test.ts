import { describe, expect, it } from "vitest";

import { angularDifference, bearing, cumulativeDistances, decodePolyline, destination, GridIndex, haversine, projectOntoPolyline } from "@/lib/geo";

describe("geo primitives", () => {
  it("haversine and destination are consistent", () => {
    const a: [number, number] = [77.5946, 12.9716];
    const b = destination(a, 45, 1000);
    expect(haversine(a, b)).toBeCloseTo(1000, 0);
    expect(bearing(a, b)).toBeCloseTo(45, 0);
  });

  it("circular angular difference wraps around 360", () => {
    expect(angularDifference(350, 10)).toBe(20);
    expect(angularDifference(10, 350)).toBe(20);
    expect(angularDifference(90, 270)).toBe(180);
  });

  it("projects a point onto a polyline with along-track distance", () => {
    const start: [number, number] = [77.6, 12.9];
    const line = [start, destination(start, 0, 500), destination(start, 0, 1000)];
    const cum = cumulativeDistances(line);
    const p = destination(destination(start, 0, 700), 90, 10);
    const proj = projectOntoPolyline(line, cum, p);
    expect(proj.along_m).toBeCloseTo(700, -1);
    expect(proj.distance_m).toBeCloseTo(10, 0);
    expect(proj.segment).toBe(1);
  });

  it("grid index returns items within radius sorted by distance", () => {
    const items = [
      { id: 1, lat: 12.9, lon: 77.6 },
      { id: 2, lat: 12.905, lon: 77.6 },
      { id: 3, lat: 13.0, lon: 77.7 },
    ];
    const idx = new GridIndex(items, 400);
    const hits = idx.within(12.9, 77.6, 1000);
    expect(hits.map((h) => h.item.id)).toEqual([1, 2]);
  });

  it("decodes an encoded polyline", () => {
    const coords = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(coords).toHaveLength(3);
    expect(coords[0][1]).toBeCloseTo(38.5, 3);
    expect(coords[0][0]).toBeCloseTo(-120.2, 3);
  });
});
