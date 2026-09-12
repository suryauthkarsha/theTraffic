import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_FILTERS } from "./filters";
import { __resetSurveillanceViewForTests, parseSurveillanceView, recallSurveillanceView, rememberSurveillanceView } from "./viewMemory";

describe("surveillance view memory (session only; a fresh open starts on the city home)", () => {
  beforeEach(() => __resetSurveillanceViewForTests());

  it("remembers centre, zoom, view mode and filters for the session, and forgets them on a reload", () => {
    expect(recallSurveillanceView()).toBeNull();
    rememberSurveillanceView({ center: [77.6, 12.97], zoom: 13.5, view: "density", filters: { ...DEFAULT_FILTERS, kind: "guard" } });
    expect(recallSurveillanceView()).toEqual({ center: [77.6, 12.97], zoom: 13.5, view: "density", filters: { ...DEFAULT_FILTERS, kind: "guard" } });
    __resetSurveillanceViewForTests();
    expect(recallSurveillanceView()).toBeNull();
  });

  it("discards a view away from the city or with a bad zoom, and falls back to clusters / no filters for odd values", () => {
    expect(parseSurveillanceView({ center: [0, 0], zoom: 12, layer: "density", filter: null })).toBeNull();
    expect(parseSurveillanceView({ center: [77.6, 12.97], zoom: 40, layer: "density", filter: null })).toBeNull();
    expect(parseSurveillanceView({ center: [77.6, 12.97], zoom: 12, layer: "heat", filter: "{bad" })).toEqual({ center: [77.6, 12.97], zoom: 12, view: "clusters", filters: DEFAULT_FILTERS });
    rememberSurveillanceView({ center: [0, 0], zoom: 12, view: "clusters", filters: DEFAULT_FILTERS });
    expect(recallSurveillanceView()).toBeNull(); // the invalid view was ignored
  });
});
