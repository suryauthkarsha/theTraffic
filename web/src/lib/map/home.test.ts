import { describe, expect, it } from "vitest";

import { BENGALURU_CENTER } from "@/lib/geo";

import intersectionSource from "../../pages/IntersectionPage.tsx?raw";
import signalsSource from "../../pages/SignalMapPage.tsx?raw";
import surveillanceSource from "../../pages/SurveillancePage.tsx?raw";
import signalMemorySource from "./viewMemory.ts?raw";
import surveillanceMemorySource from "../surveillance/viewMemory.ts?raw";
import { CITY_HOME, RESTORE_VIEW_STATE, sheetPadding, shouldRestoreView } from "./home";
import { parseSignalMapView } from "./viewMemory";

describe("the city home view (user decision 2026-09-09: every map starts from the centre of the city)", () => {
  it("is the centre of Bengaluru, zoomed to the core, inside the maps' zoom range", () => {
    expect(CITY_HOME.center).toEqual(BENGALURU_CENTER);
    expect(CITY_HOME.zoom).toBe(13);
    expect(parseSignalMapView({ center: CITY_HOME.center, zoom: CITY_HOME.zoom })).not.toBeNull();
  });

  it("restores a remembered view only on Back / Forward, or when a screen asks with the restore state", () => {
    expect(shouldRestoreView("POP", null)).toBe(true);
    expect(shouldRestoreView("POP", undefined)).toBe(true);
    expect(shouldRestoreView("PUSH", null)).toBe(false); // a tab, a console card
    expect(shouldRestoreView("REPLACE", null)).toBe(false);
    expect(shouldRestoreView("PUSH", RESTORE_VIEW_STATE)).toBe(true); // the junction page's breadcrumb / Show on map
    expect(shouldRestoreView("PUSH", { restoreView: "yes" })).toBe(false);
    expect(shouldRestoreView("PUSH", "restoreView")).toBe(false);
  });

  it("moves the centre into the half of the map a phone's sheet leaves open, and nowhere on a desk", () => {
    expect(sheetPadding(700, true)).toEqual({ top: 0, bottom: 350, left: 0, right: 0 });
    expect(sheetPadding(701, true).bottom).toBe(351);
    expect(sheetPadding(700, false)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("is what both maps open on; the memories live only for the session and the junction page's return links ask for the restore", () => {
    for (const src of [signalsSource, surveillanceSource]) {
      expect(src).toContain("shouldRestoreView(navigationType, location.state)");
      expect(src).toContain("center={remembered?.center ?? CITY_HOME.center}");
      expect(src).toContain("zoom={remembered?.zoom ?? CITY_HOME.zoom}");
      expect(src).toContain("m.setPadding(sheetPadding(m.getContainer().clientHeight, true))");
      expect(src).not.toMatch(/DEFAULT_ZOOM|BENGALURU_CENTER/);
    }
    for (const src of [signalMemorySource, surveillanceMemorySource]) expect(src).not.toMatch(/sessionStorage|localStorage|Storage\b/);
    expect(intersectionSource).toContain('parent={{ to: "/signals", label: "Signal Map", state: RESTORE_VIEW_STATE }}');
    expect(intersectionSource).toContain('<Link to="/signals" state={RESTORE_VIEW_STATE} onClick={showOnMap}');
  });
});
