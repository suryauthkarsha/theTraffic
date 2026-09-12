import { describe, expect, it } from "vitest";

import { cameraTypeOf, categoryOf, cleanText, compassLabel, kindOf, normalizeCamera, parseDirections, sanitizeTags, summarise, zoneOf, type RawCameraRecord } from "./normalize";

const rec = (tags: Record<string, string>, extra: Partial<RawCameraRecord> = {}): RawCameraRecord => ({ id: 6568418174, lat: 13.066439, lon: 77.5999524, v: 1, t: "2019-06-24T19:02:16Z", tags, ...extra });

describe("surveillance record normalizer (shared by the sync script and the page)", () => {
  it("reads the OSM tags as typed and never invents a missing one", () => {
    const c = normalizeCamera(rec({ "camera:type": "fixed", man_made: "surveillance", surveillance: "public", "surveillance:type": "camera" }));
    expect(c).toMatchObject({ kind: "camera", category: "public", zone: "none", cameraType: "fixed", operator: null, name: null, mount: null, directions: [], directionRaw: null, surveyDate: null });
    expect(c.updatedAt).toBe("2019-06-24T19:02:16Z");
    expect(c.version).toBe(1);
  });

  it("keeps the raw value for the detail panel while filters see a facet: 'indoor/outdoor' is shown as typed and filed under other", () => {
    const c = normalizeCamera(rec({ surveillance: "indoor/outdoor", "surveillance:zone": "public_transport_platform", "camera:type": "panorama", "surveillance:type": "ALPR", "camera:mount": "grantry" }));
    expect(c.surveillance).toBe("indoor/outdoor");
    expect(c.category).toBe("other");
    expect(c.zone).toBe("other");
    expect(c.cameraType).toBe("other");
    expect(c.kind).toBe("alpr");
    expect(c.mount).toBe("grantry"); // a typo in OSM stays a typo here — we show, we do not repair
  });

  it("facets: the values seen in Bengaluru map to their own bucket, everything else to other, nothing to none", () => {
    expect(["public", "outdoor", "indoor", "private", "traffic"].map(categoryOf)).toEqual(["public", "outdoor", "indoor", "private", "traffic"]);
    expect(categoryOf("camera")).toBe("other");
    expect(categoryOf(null)).toBe("none");
    expect(zoneOf("traffic")).toBe("traffic");
    expect(zoneOf("shop")).toBe("other");
    expect(zoneOf(null)).toBe("none");
    expect(cameraTypeOf("Dome")).toBe("dome");
    expect(cameraTypeOf(null)).toBe("none");
    expect(kindOf("guard")).toBe("guard");
    expect(kindOf("viewpoint")).toBe("viewpoint");
    expect(kindOf("traffic")).toBe("other");
    expect(kindOf(null)).toBe("none");
  });

  it("parses camera:direction strictly: degrees, compass points and ';' lists; ranges, negatives and stray characters give no heading", () => {
    expect(parseDirections("90")).toEqual([90]);
    expect(parseDirections("360")).toEqual([0]);
    expect(parseDirections("22.5")).toEqual([22.5]);
    expect(parseDirections("north")).toEqual([0]);
    expect(parseDirections("W")).toEqual([270]);
    expect(parseDirections("NE")).toEqual([45]);
    expect(parseDirections("80;200;320")).toEqual([80, 200, 320]);
    expect(parseDirections("0;180;270;90")).toEqual([0, 180, 270, 90]);
    expect(parseDirections("-75")).toEqual([]);
    expect(parseDirections("190\\")).toEqual([]);
    expect(parseDirections("90-180")).toEqual([]);
    expect(parseDirections("400")).toEqual([]);
    expect(parseDirections("")).toEqual([]);
    expect(parseDirections(null)).toEqual([]);
  });

  it("falls back to the plain `direction` key when camera:direction is absent, and keeps the raw text either way", () => {
    expect(normalizeCamera(rec({ direction: "314" }))).toMatchObject({ directions: [314], directionRaw: "314" });
    expect(normalizeCamera(rec({ "camera:direction": "-75" }))).toMatchObject({ directions: [], directionRaw: "-75" });
    expect(normalizeCamera(rec({ "camera:direction": "90", direction: "270" })).directions).toEqual([90]);
  });

  it("labels headings with 16 compass points", () => {
    expect(compassLabel(0)).toBe("N");
    expect(compassLabel(90)).toBe("E");
    expect(compassLabel(180)).toBe("S");
    expect(compassLabel(270)).toBe("W");
    expect(compassLabel(45)).toBe("NE");
    expect(compassLabel(292.5)).toBe("WNW");
    expect(compassLabel(359)).toBe("N");
  });

  it("sanitizes contributor text: control and bidi characters out, whitespace collapsed, length capped, empties dropped", () => {
    expect(cleanText(" CCTV\u0000  at\u200b gate \n")).toBe("CCTV at gate");
    expect(cleanText("\u202eevil")).toBe("evil");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(42)).toBeNull();
    expect(cleanText("x".repeat(300))?.length).toBe(256);
    expect(sanitizeTags({ b: "2", a: "1", "": "nope", c: "", d: 7 as unknown as string })).toEqual({ a: "1", b: "2" });
    expect(sanitizeTags(null)).toEqual({});
  });

  it("survey date prefers survey:date over check_date", () => {
    expect(normalizeCamera(rec({ "survey:date": "2022-06-11", check_date: "2024-01-01" })).surveyDate).toBe("2022-06-11");
    expect(normalizeCamera(rec({ check_date: "2024-01-01" })).surveyDate).toBe("2024-01-01");
  });

  it("summarises a set the same way for the snapshot, the registry and the page", () => {
    const s = summarise([
      normalizeCamera(rec({ surveillance: "public", "surveillance:type": "camera", "camera:type": "fixed", "camera:direction": "90", operator: "BTP", name: "Gate 1" }, { t: "2023-01-01T00:00:00Z" })),
      normalizeCamera(rec({ surveillance: "private", "surveillance:type": "guard" }, { id: 2, t: "2019-01-01T00:00:00Z" })),
      normalizeCamera(rec({}, { id: 3, t: "2026-08-18T00:29:22Z" })),
    ]);
    expect(s.total).toBe(3);
    expect(s.kinds).toMatchObject({ camera: 1, guard: 1, none: 1 });
    expect(s.categories).toMatchObject({ public: 1, private: 1, none: 1 });
    expect(s.camera_types).toMatchObject({ fixed: 1, none: 2 });
    expect(s.operator_mapped).toBe(1);
    expect(s.direction_mapped).toBe(1);
    expect(s.named).toBe(1);
    expect(s.osm_updated).toEqual({ oldest: "2019-01-01T00:00:00Z", newest: "2026-08-18T00:29:22Z" });
  });
});
