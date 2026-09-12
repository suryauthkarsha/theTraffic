import { describe, expect, it } from "vitest";

import type { Intersection } from "@/lib/data/types";

import { moveActive, nearestJunctions, searchJunctions, SIGNAL_SEARCH_LIMIT } from "./search";

function inter(id: string, name: string, roads: string[], lon: number, lat: number): Intersection {
  return { id, canonical_name: name, road_names: roads, lon, lat, approaches: [] } as unknown as Intersection;
}

const DATA: Intersection[] = [
  inter("a", "Silk Board Junction", ["Hosur Road", "Outer Ring Road"], 77.6229, 12.9172),
  inter("b", "Sony World Signal", ["Koramangala 80 Feet Road"], 77.6262, 12.9345),
  inter("c", "Hosur Road × Bommanahalli", ["Hosur Road"], 77.6262, 12.9077),
  inter("d", "Indiranagar Double Road × 100 Feet Road", ["100 Feet Road"], 77.6408, 12.9745),
  ...Array.from({ length: 12 }, (_, i) => inter(`h${i}`, `Hosur Road signal ${i}`, ["Hosur Road"], 77.62, 12.9 - i * 0.01)),
];

describe("accessible signal search (audit finding 7)", () => {
  it("returns null matches below the minimum length and an explicit empty list for no results", () => {
    expect(searchJunctions("s", DATA).matches).toBeNull();
    const none = searchJunctions("Whitefield", DATA);
    expect(none.matches).toEqual([]);
    expect(none.total).toBe(0);
  });

  it("ranks exact name, then prefix, then contains, then road-name matches", () => {
    const r = searchJunctions("silk board junction", DATA);
    expect(r.matches?.[0].intersection.id).toBe("a");
    expect(r.matches?.[0].rank).toBe(0);
    const hosur = searchJunctions("Hosur", DATA);
    // prefix matches ("Hosur Road …") come before the road-name-only match (Silk Board via Hosur Road)
    expect(hosur.matches?.[0].rank).toBe(1);
    expect(hosur.matches?.some((m) => m.intersection.id === "a" && m.rank === 3)).toBe(false); // capped out by the limit
    expect(hosur.total).toBe(14);
  });

  it("caps the visible list and reports the total so the UI can say “showing N of M”", () => {
    const r = searchJunctions("Hosur", DATA);
    expect(r.matches).toHaveLength(SIGNAL_SEARCH_LIMIT);
    expect(r.total).toBeGreaterThan(SIGNAL_SEARCH_LIMIT);
  });

  it("keyboard navigation wraps and honours Home/End", () => {
    expect(moveActive(0, "ArrowDown", 3)).toBe(1);
    expect(moveActive(2, "ArrowDown", 3)).toBe(0);
    expect(moveActive(0, "ArrowUp", 3)).toBe(2);
    expect(moveActive(1, "Home", 3)).toBe(0);
    expect(moveActive(1, "End", 3)).toBe(2);
    expect(moveActive(0, "ArrowDown", 0)).toBe(-1);
  });

  it("offers the nearest junctions to the map centre as a non-map path", () => {
    const near = nearestJunctions([77.6229, 12.9172], DATA, 2);
    expect(near[0].intersection.id).toBe("a");
    expect(near[0].distance_m).toBeLessThan(5);
    expect(near).toHaveLength(2);
  });
});
