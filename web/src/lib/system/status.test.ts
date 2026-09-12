import { describe, expect, it } from "vitest";

import { basemapItem, camerasItem, istClock, railItems, type StatusInputs } from "./status";

const BASE: StatusInputs = {
  nowMs: Date.UTC(2026, 8, 7, 9, 2, 7), // 14:32:07 IST
  dataset: { version: "v1", osmBase: "2026-09-05", intersections: 579, nodes: 1392 },
  basemap: { mode: "dark", health: "ok" },
  build: "2026-09-07 16:32Z",
};

describe("system status rail model", () => {
  it("prints the IST clock and the dataset line from real meta only — no build stamp, no version noise", () => {
    expect(istClock(BASE.nowMs)).toBe("14:32:07");
    const items = railItems(BASE);
    expect(items.map((i) => i.id)).toEqual(["clock", "dataset", "basemap"]);
    expect(items[1].value).toBe("579 junctions · osm 2026-09-05");
    expect(items[1].detail).toContain("v1"); // the version survives in the tooltip
    expect(railItems({ ...BASE, dataset: null })[1]).toMatchObject({ value: "loading", tone: "grey" });
  });

  it("drops the basemap item on screens without a map", () => {
    expect(railItems({ ...BASE, basemap: { mode: "dark", health: "none" } }).map((i) => i.id)).toEqual(["clock", "dataset"]);
  });

  it("carries a cameras item only while the Surveillance page reports its snapshot, and calls an old snapshot stale instead of hiding its age", () => {
    expect(railItems(BASE).map((i) => i.id)).not.toContain("cameras"); // no other screen loads the snapshot
    const fresh = { state: "ok" as const, count: 2818, osmBase: "2026-09-09T03:50:33Z", syncedAt: "2026-09-09T04:05:41Z" };
    const now = Date.UTC(2026, 8, 9, 6, 0, 0);
    expect(railItems({ ...BASE, nowMs: now, cameras: fresh }).map((i) => i.id)).toEqual(["clock", "dataset", "cameras", "basemap"]);
    expect(camerasItem(fresh, now)).toMatchObject({ value: "2,818 records · osm 2026-09-09", tone: "orange" });
    expect(camerasItem(fresh, now).detail).toMatch(/never queries Overpass/);
    expect(camerasItem(fresh, now).detail).toMatch(/coverage may be incomplete/i);
    expect(camerasItem(fresh, now + 40 * 86_400_000)).toMatchObject({ value: "2,818 records · osm 2026-09-09 · stale", tone: "ember" });
    expect(camerasItem({ state: "loading", count: null, osmBase: null, syncedAt: null }, now)).toMatchObject({ value: "loading", tone: "grey" });
    expect(camerasItem({ state: "error", count: null, osmBase: null, syncedAt: null }, now)).toMatchObject({ value: "unavailable", tone: "red" });
  });

  it("has no store, reviewer or gateway item: the site signs in to nothing, syncs nothing and routes nothing", () => {
    const ids = railItems(BASE).map((i) => i.id);
    expect(ids).not.toContain("store");
    expect(ids).not.toContain("reviewer");
    expect(ids).not.toContain("gateway"); // the planner and its routing gateway are gone (2026-09-08)
    for (const it of railItems(BASE)) expect(it.detail).not.toMatch(/reviewer|sign-in|routing|route/i);
  });

  it("never says ok for a state it cannot confirm; tones are the palette's orange / ember / red / grey", () => {
    expect(basemapItem("satellite", "none")).toMatchObject({ value: "—", tone: "grey" });
    expect(basemapItem("satellite", "ok")).toMatchObject({ value: "satellite · ok", tone: "orange" });
    expect(basemapItem("dark", "tiles_pending").tone).toBe("ember");
    expect(basemapItem("dark", "style_failed").tone).toBe("red");
    expect(basemapItem("dark", "loading")).toMatchObject({ value: "dark · loading", tone: "grey" });
    for (const it of railItems(BASE)) expect(["orange", "ember", "red", "grey"]).toContain(it.tone); // never green
  });
});
