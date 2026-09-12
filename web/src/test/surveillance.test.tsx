import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CameraDetail, cameraTitle, directionText } from "@/components/surveillance/CameraDetail";
import { normalizeCamera, type RawCameraRecord } from "@/lib/surveillance/normalize";
import SurveillancePage, { parseCameraParam } from "@/pages/SurveillancePage";

import detailSource from "../components/surveillance/CameraDetail.tsx?raw";
import layersSource from "../components/map/cameraLayers.ts?raw";
import pageSource from "../pages/SurveillancePage.tsx?raw";
import signalsSource from "../pages/SignalMapPage.tsx?raw";

const render = (el: React.ReactElement, route = "/surveillance"): string => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{el}</MemoryRouter></QueryClientProvider>);

const rec = (tags: Record<string, string>, extra: Partial<RawCameraRecord> = {}): RawCameraRecord => ({ id: 6568418174, lat: 13.066439, lon: 77.5999524, v: 2, t: "2023-05-04T10:00:00Z", tags, ...extra });

describe("the Surveillance page", () => {
  it("is a separate map screen with the console index 02, the filters, the legend's one honesty line and the required attribution + credit", () => {
    const html = render(<SurveillancePage />);
    expect(html).toContain("<b>02</b>");
    expect(html).toContain("surveillance");
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain('aria-label="View"');
    expect(html).toContain("Direction cones");
    expect(html.match(/>Not mapped · /g)?.length).toBe(6); // every select ends in a "Not mapped" option
    expect(html).toContain("A mark means someone mapped a camera here — never that it is on, recording, or who watches it.");
    expect(html).toContain("© OpenStreetMap contributors, ODbL 1.0");
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain("Thejesh GN&#x27;s Surveillance in Bengaluru");
    expect(html).toContain('href="https://thejeshgn.com/projects/surveillance-in-bengaluru/"');
    expect(html).toContain("panel-hud"); // the control panel is this screen's one HUD panel
    expect(html).toContain('aria-label="Surveillance map controls"');
  });

  it("never claims what the data cannot know: no active / recording / police-owned / face-recognition / safer wording, and 'records', not 'cameras', for the whole set", () => {
    // Doc comments may name the claims they rule out; only code and copy the screen can render are checked.
    const rendered = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const src of [pageSource, detailSource, layersSource].map(rendered)) {
      expect(src).not.toMatch(/is active|currently recording|police-owned|police camera|facial recognition|face recognition|safer|crime/i);
      expect(src).not.toMatch(/heatmap|Heatmap|blur/); // the density view is a flat grid
      expect(src).not.toMatch(/gw-(green|amber)|#32D583|#F4B740/);
    }
    expect(pageSource).toContain("records`"); // the eyebrow counts records
    expect(pageSource).toContain("?camera="); // the chosen record lives in the URL
    expect(pageSource).toContain('useSearchParams()');
    expect(pageSource).toContain("<BottomSheet"); // phones get the sheet, like the Signal Map
    expect(pageSource).toContain("mobileControls={isMobile}");
    expect(pageSource).toContain("max-h-[calc(100dvh-7.5rem)]");
  });

  it("leaves the signal screens alone: the Signal Map imports nothing from the surveillance library", () => {
    expect(signalsSource).not.toMatch(/surveillance|camera/i);
  });

  it("parses ?camera= strictly", () => {
    expect(parseCameraParam("6568418174")).toBe(6568418174);
    expect(parseCameraParam("abc")).toBeNull();
    expect(parseCameraParam("-1")).toBeNull();
    expect(parseCameraParam(null)).toBeNull();
  });
});

describe("the camera panel", () => {
  it("shows every field as mapped or 'Not mapped', labels the record community-mapped, links to view and improve it on OpenStreetMap and to Support", () => {
    const sparse = normalizeCamera(rec({ man_made: "surveillance", surveillance: "public", "surveillance:type": "camera" }));
    const html = render(<CameraDetail camera={sparse} onClose={() => undefined} />);
    expect(html).toContain("<b>node</b> · 6568418174");
    expect(html).toContain(">Camera<"); // no OSM name → the device word, never an invented name
    expect(html).toContain("Community-mapped record");
    expect(html.match(/Not mapped/g)?.length).toBe(6); // camera type, zone, device? no — device is mapped: type, zone, direction, mount, operator, reference
    expect(html).toContain('href="https://www.openstreetmap.org/node/6568418174"');
    expect(html).toContain('href="https://www.openstreetmap.org/edit?node=6568418174"');
    expect(html).toContain("View on OpenStreetMap");
    expect(html).toContain("Improve this record");
    expect(html).toContain("free OpenStreetMap account");
    expect(html).toContain("/support?topic=camera&amp;ref=node%2F6568418174");
    expect(html).toContain("v2 · ");
    expect(html).toContain("13.06644, 77.59995");
    expect(html).toContain("All tags · 3");
    expect(html).not.toMatch(/owned by|active|recording/);
  });

  it("prints directions as headings with compass points, shows unreadable raw text as such, and uses the OSM name when there is one", () => {
    const named = normalizeCamera(rec({ name: "Shalom Apt Gate Camera 1", "surveillance:type": "camera", "camera:direction": "80;200;320", operator: "Apartment", "camera:type": "dome", "survey:date": "2022-06-11" }));
    expect(cameraTitle(named)).toBe("Shalom Apt Gate Camera 1");
    expect(directionText(named)).toEqual({ text: "80° E · 200° SSW · 320° NW", mapped: true });
    const html = render(<CameraDetail camera={named} onClose={() => undefined} />);
    expect(html).toContain("surveyed 2022-06-11");
    expect(html).toContain(">Apartment<");
    expect(html).toContain(">dome<");
    const odd = normalizeCamera(rec({ "camera:direction": "-75", "surveillance:type": "guard" }));
    expect(cameraTitle(odd)).toBe("Guard post");
    expect(directionText(odd)).toEqual({ text: "-75 (not readable as a heading)", mapped: false });
    expect(directionText(normalizeCamera(rec({})))).toBeNull();
    expect(cameraTitle(normalizeCamera(rec({})))).toBe("Surveillance point");
    expect(cameraTitle(normalizeCamera(rec({ "surveillance:type": "ALPR" })))).toBe("Number-plate reader");
  });
});
