import { describe, expect, it } from "vitest";

import type { Map as MlMap } from "maplibre-gl";

import { HIT_TOLERANCE_PX, hitTolerance, pickNearest, pointerTypeOf, signalAt } from "./hit";

describe("signal dot hit-testing (a tap opens the nearest junction, not only a pixel-perfect one)", () => {
  it("gives fingers and pens about half a fingertip of slack and mice a little", () => {
    expect(hitTolerance("touch", false)).toBe(HIT_TOLERANCE_PX.coarse);
    expect(hitTolerance("pen", false)).toBe(HIT_TOLERANCE_PX.coarse);
    expect(hitTolerance("mouse", true)).toBe(HIT_TOLERANCE_PX.fine);
    expect(hitTolerance(undefined, true)).toBe(HIT_TOLERANCE_PX.coarse); // unknown event type: the device decides
    expect(hitTolerance(undefined, false)).toBe(HIT_TOLERANCE_PX.fine);
    expect(HIT_TOLERANCE_PX.coarse).toBeGreaterThanOrEqual(20); // WCAG-sized target around a 3 px dot
    expect(HIT_TOLERANCE_PX.fine).toBeGreaterThanOrEqual(6);
  });

  it("picks the nearest candidate inside the tolerance and nothing outside it", () => {
    const hits = [
      { id: "far", x: 40, y: 0 },
      { id: "near", x: 6, y: 8 }, // 10 px away
      { id: "nearer", x: 3, y: 4 }, // 5 px away
    ];
    expect(pickNearest({ x: 0, y: 0 }, hits, 10)).toBe("nearer");
    expect(pickNearest({ x: 0, y: 0 }, hits, 4)).toBeNull(); // nothing close enough
    expect(pickNearest({ x: 0, y: 0 }, [], 22)).toBeNull();
    // the corner of the query square is trimmed: 15,15 is 21 px away, outside a 20 px tolerance
    expect(pickNearest({ x: 0, y: 0 }, [{ id: "corner", x: 15, y: 15 }], 20)).toBeNull();
  });

  it("reads the pointer type only when the browser provides one", () => {
    expect(pointerTypeOf({ pointerType: "touch" })).toBe("touch");
    expect(pointerTypeOf({})).toBeUndefined();
    expect(pointerTypeOf(null)).toBeUndefined();
    expect(pointerTypeOf({ pointerType: 3 })).toBeUndefined();
  });

  it("queries the map in a square around the point and projects every candidate to screen space", () => {
    const calls: unknown[] = [];
    const map = {
      getLayer: (id: string) => (id === "signals-dot" ? { id } : undefined),
      queryRenderedFeatures: (box: unknown) => {
        calls.push(box);
        return [
          { geometry: { type: "Point", coordinates: [77.6, 12.9] }, properties: { id: "gw-a" } },
          { geometry: { type: "Point", coordinates: [77.61, 12.9] }, properties: { id: "gw-b" } },
          { geometry: { type: "Point", coordinates: [77.61, 12.9] }, properties: { id: "gw-b" } }, // tile-boundary duplicate
          { geometry: { type: "LineString", coordinates: [] }, properties: { id: "not-a-dot" } },
          { geometry: { type: "Point", coordinates: [77.62, 12.9] }, properties: {} }, // no id
        ];
      },
      project: (c: [number, number]) => ({ x: c[0] === 77.6 ? 104 : 118, y: 100 }),
    } as unknown as MlMap;
    expect(signalAt(map, "signals-dot", { x: 100, y: 100 }, 10)).toBe("gw-a"); // 4 px away beats 18 px
    expect(calls[0]).toEqual([
      [90, 90],
      [110, 110],
    ]);
    expect(signalAt(map, "signals-dot", { x: 100, y: 100 }, 3)).toBeNull();
    expect(signalAt(map, "missing-layer", { x: 100, y: 100 }, 10)).toBeNull(); // before the layer exists
  });

  it("never throws when the map cannot be queried", () => {
    const map = {
      getLayer: () => ({ id: "signals-dot" }),
      queryRenderedFeatures: () => {
        throw new Error("style not loaded");
      },
    } as unknown as MlMap;
    expect(signalAt(map, "signals-dot", { x: 0, y: 0 }, 10)).toBeNull();
  });
});
