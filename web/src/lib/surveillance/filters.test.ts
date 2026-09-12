import { describe, expect, it } from "vitest";

import { activeFilterCount, applyFilters, DEFAULT_FILTERS, facetCounts, facetValue, FILTER_GROUPS, parseFilters, parseFiltersString, serializeFilters, type CameraFilters } from "./filters";
import { normalizeCamera, type RawCameraRecord } from "./normalize";

let seq = 1;
const cam = (tags: Record<string, string>) => normalizeCamera({ id: seq++, lat: 12.97, lon: 77.59, v: 1, t: "2023-01-01T00:00:00Z", tags } as RawCameraRecord);

const SET = [
  cam({ surveillance: "public", "surveillance:type": "camera", "camera:type": "fixed", "surveillance:zone": "traffic", "camera:direction": "90", operator: "BTP" }),
  cam({ surveillance: "public", "surveillance:type": "camera", "camera:type": "dome", "surveillance:zone": "town" }),
  cam({ surveillance: "private", "surveillance:type": "camera", "camera:type": "panning", "camera:direction": "north" }),
  cam({ surveillance: "outdoor", "surveillance:type": "guard" }),
  cam({}),
];

describe("surveillance filters", () => {
  it("exposes the six groups the page offers, each reading one OSM key, with 'Not mapped' as the last option", () => {
    expect(FILTER_GROUPS.map((g) => g.id)).toEqual(["category", "zone", "cameraType", "kind", "operator", "direction"]);
    expect(FILTER_GROUPS.map((g) => g.key)).toEqual(["surveillance", "surveillance:zone", "camera:type", "surveillance:type", "operator", "camera:direction"]);
    for (const g of FILTER_GROUPS) expect(g.options[g.options.length - 1]).toEqual({ id: "none", label: "Not mapped" });
    expect(FILTER_GROUPS.find((g) => g.id === "kind")?.options.map((o) => o.label)).toEqual(["Camera", "Number-plate reader (ALPR)", "Guard post", "Viewpoint", "Other", "Not mapped"]);
  });

  it("filters by the tag values as typed; 'all' restricts nothing", () => {
    expect(applyFilters(SET, DEFAULT_FILTERS)).toHaveLength(5);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, category: "public" })).toHaveLength(2);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, category: "none" })).toHaveLength(1);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, zone: "traffic" })).toHaveLength(1);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, cameraType: "dome" })).toHaveLength(1);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, kind: "guard" })).toHaveLength(1);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, operator: "mapped" })).toHaveLength(1);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, operator: "none" })).toHaveLength(4);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, direction: "mapped" })).toHaveLength(2);
    expect(applyFilters(SET, { ...DEFAULT_FILTERS, category: "public", cameraType: "fixed" })).toHaveLength(1);
    expect(facetValue(SET[0], "operator")).toBe("mapped");
    expect(facetValue(SET[4], "direction")).toBe("none");
  });

  it("faceted counts: each select counts what picking it would leave, given every other group", () => {
    const f: CameraFilters = { ...DEFAULT_FILTERS, category: "public" };
    const c = facetCounts(SET, f);
    expect(c.cameraType).toMatchObject({ fixed: 1, dome: 1, panning: 0, none: 0 }); // within public only
    expect(c.category).toMatchObject({ public: 2, private: 1, outdoor: 1, none: 1 }); // its own group ignores its own choice
    expect(Object.values(c.operator).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("counts active groups and round-trips through the view memory; unknown values fall back to all", () => {
    const f: CameraFilters = { ...DEFAULT_FILTERS, zone: "traffic", direction: "mapped" };
    expect(activeFilterCount(f)).toBe(2);
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(parseFiltersString(serializeFilters(f))).toEqual(f);
    expect(parseFilters({ zone: "moon", kind: "guard", operator: 42 })).toEqual({ ...DEFAULT_FILTERS, kind: "guard" });
    expect(parseFiltersString("not json")).toEqual(DEFAULT_FILTERS);
    expect(parseFiltersString(null)).toEqual(DEFAULT_FILTERS);
  });
});
