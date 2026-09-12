import { beforeEach, describe, expect, it } from "vitest";

import { __resetSignalMapViewForTests, parseSignalMapView, recallSignalMapView, rememberSignalMapView } from "./viewMemory";

describe("Signal Map view memory (Back from a junction page lands where you left; a fresh open starts on the city home)", () => {
  beforeEach(() => __resetSignalMapViewForTests());

  it("keeps centre, zoom, layer and filter for the session only — a reload forgets them", () => {
    expect(recallSignalMapView()).toBeNull(); // fresh visit
    rememberSignalMapView({ center: [77.62, 12.93], zoom: 14.2, layer: "median_delay", filter: "verified_published" });
    expect(recallSignalMapView()).toEqual({ center: [77.62, 12.93], zoom: 14.2, layer: "median_delay", filter: "verified_published" });
    rememberSignalMapView({ center: [77.6, 12.97], zoom: 12, layer: null, filter: null });
    expect(recallSignalMapView()?.zoom).toBe(12); // the latest view wins
    __resetSignalMapViewForTests(); // a reload: nothing survives, the map opens on the city home
    expect(recallSignalMapView()).toBeNull();
  });

  it("discards anything malformed, out of range or away from the city — a bad record can never break the map", () => {
    expect(parseSignalMapView(null)).toBeNull();
    expect(parseSignalMapView("garbage")).toBeNull();
    expect(parseSignalMapView({ center: [77.6], zoom: 12 })).toBeNull();
    expect(parseSignalMapView({ center: ["77.6", 12.9], zoom: 12 })).toBeNull();
    expect(parseSignalMapView({ center: [77.6, 12.9], zoom: 3 })).toBeNull(); // below the map's minZoom
    expect(parseSignalMapView({ center: [77.6, 12.9], zoom: 25 })).toBeNull();
    expect(parseSignalMapView({ center: [77.6, 12.9], zoom: NaN })).toBeNull();
    expect(parseSignalMapView({ center: [0, 0], zoom: 12 })).toBeNull(); // Null Island is not Bengaluru
    expect(parseSignalMapView({ center: [77.6, 12.9], zoom: 12, layer: 7, filter: "" })).toEqual({ center: [77.6, 12.9], zoom: 12, layer: null, filter: null });
    rememberSignalMapView({ center: [77.62, 12.93], zoom: 14.2, layer: null, filter: null });
    rememberSignalMapView({ center: [0, 0], zoom: 12, layer: null, filter: null });
    expect(recallSignalMapView()?.center).toEqual([77.62, 12.93]); // the invalid view was ignored, the good one kept
  });
});
