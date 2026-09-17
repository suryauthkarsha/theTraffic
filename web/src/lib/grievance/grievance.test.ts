import { describe, expect, it } from "vitest";

import type { Intersection } from "@/lib/data/types";

import { grievanceApiBase, DEFAULT_GRIEVANCE_API } from "./api";
import { boardLink, containsContactDetails, fmtBoardTime, formatBoardGrievance, GRIEVANCE_KINDS, insideBengaluru, isGrievanceKind, junctionPlace, kindLabel, kindShort, NEAREST_JUNCTION_M, osmLink, PHOTO_REQUIRED, placeAt, toSubmission, validateGrievance, type BoardGrievance, type GrievanceDraft } from "./grievance";
import { fitScale, qualityLadder } from "./photo";

const junction = (id: string, name: string, lon: number, lat: number): Intersection => ({ id, canonical_name: name, lat, lon, intersection_type: "junction", control_type: "unknown", control_type_source: "none", osm_node_ids: [], node_count: 1, spread_m: 0, cluster_confidence: 1, score_components: {}, review_needed: false, verified: false, road_names: [], osm_tags: {}, approaches: [] });

const SILK_BOARD = junction("gw-silk", "Silk Board Junction", 77.6227, 12.9177);
const FAR = junction("gw-far", "Hebbal Flyover", 77.5946, 13.0358);
const ALL = [SILK_BOARD, FAR];

const draft = (over: Partial<GrievanceDraft> = {}): GrievanceDraft => ({ kind: "pothole", message: "", website: "", ...over });
const FILED = Date.UTC(2026, 8, 11, 8, 35); // 14:05 IST

describe("a grievance's place", () => {
  it("names the nearest junction on file within 300 m of a marked or device point, and none beyond", () => {
    const near = placeAt([77.6235, 12.918], "map", ALL);
    expect(near.source).toBe("map");
    expect(near.junction?.id).toBe("gw-silk");
    expect(near.junction?.distanceM).toBeGreaterThan(0);
    expect(near.junction?.distanceM).toBeLessThan(NEAREST_JUNCTION_M);
    expect(near.accuracyM).toBeNull();

    const alone = placeAt([77.7, 12.85], "device", ALL, 18.4);
    expect(alone.junction).toBeNull();
    expect(alone.accuracyM).toBe(18.4);
  });

  it("a picked junction is the place itself — distance 0, no accuracy radius", () => {
    expect(junctionPlace(SILK_BOARD)).toEqual({ point: [77.6227, 12.9177], source: "junction", accuracyM: null, junction: { id: "gw-silk", name: "Silk Board Junction", distanceM: 0 } });
  });

  it("only a device position inside Bengaluru's box is accepted", () => {
    expect(insideBengaluru([77.5946, 12.9716])).toBe(true);
    expect(insideBengaluru([72.8777, 19.076])).toBe(false); // Mumbai
    expect(insideBengaluru([77.5946, 12.5])).toBe(false);
  });

  it("links the point on openstreetmap.org at five decimals, latitude first in the marker", () => {
    expect(osmLink([77.62271, 12.91769])).toBe("https://www.openstreetmap.org/?mlat=12.91769&mlon=77.62271#map=18/12.91769/77.62271");
  });
});

describe("validating a grievance (the browser's copy of the board's rules)", () => {
  it("needs a photo — always (user decision 2026-09-13); neither the place nor the words stand in for it", () => {
    expect(validateGrievance(draft(), false)).toBe(PHOTO_REQUIRED);
    expect(PHOTO_REQUIRED).toBe("Add a photo — every grievance needs one.");
    expect(validateGrievance(draft({ message: "Deep pothole at the stop line, two-wheelers swerve into the bus lane." }), false)).toBe(PHOTO_REQUIRED); // words alone are not enough
    expect(validateGrievance(draft({ kind: "crossing" }), true)).toBeNull(); // "No safe way to cross" with its picture IS the report
    expect(validateGrievance(draft(), true)).toBeNull(); // a photo alone: the place and the words are optional
  });

  it("the photo rule comes before every other sentence except the honeypot's, so the form asks for the photo first", () => {
    expect(validateGrievance(draft({ message: "x".repeat(2001) }), false)).toBe(PHOTO_REQUIRED);
    expect(validateGrievance(draft({ message: "ring 9876543210" }), false)).toBe(PHOTO_REQUIRED);
    expect(validateGrievance(draft({ website: "http://spam" }), false)).toBe("Please leave the hidden field empty.");
  });

  it("'Something else' is complete with its photo alone — no minimum words any more", () => {
    expect(validateGrievance(draft({ kind: "other" }), true)).toBeNull();
    expect(validateGrievance(draft({ kind: "other", message: "Hawkers on the carriageway" }), true)).toBeNull();
    expect(validateGrievance(draft({ kind: "other", message: "Hawkers on the carriageway" }), false)).toBe(PHOTO_REQUIRED);
  });

  it("caps the words and refuses a filled honeypot", () => {
    expect(validateGrievance(draft({ message: "x".repeat(2001) }), true)).toMatch(/Keep it under 2,000 characters/);
    expect(validateGrievance(draft({ website: "http://spam" }), true)).toBe("Please leave the hidden field empty.");
  });

  it("refuses words that carry a phone number or an e-mail address because the board is public", () => {
    expect(containsContactDetails("call 98765 43210")).toBe(true);
    expect(containsContactDetails("+91-98765-43210")).toBe(true);
    expect(containsContactDetails("me@example.org")).toBe(true);
    expect(containsContactDetails("Bus 500D stops 20 m past the line at 8:45 am")).toBe(false);
    expect(validateGrievance(draft({ message: "Water every rain, ring 9876543210" }), true)).toBe("Leave out phone numbers and e-mail addresses — the board is public.");
  });
});

describe("what is posted", () => {
  it("is the kind, the words and the place — the draft has no field for a name, a number or an address", () => {
    const d = draft({ kind: "water", message: "  Ankle-deep after ten minutes of rain; the drain is silted.  " });
    expect(Object.keys(d).sort()).toEqual(["kind", "message", "website"]);
    const s = toSubmission(d, placeAt([77.6235, 12.918], "device", ALL, 12.6));
    expect(Object.keys(s).sort()).toEqual(["kind", "place", "website", "words"]);
    expect(s.words).toBe("Ankle-deep after ten minutes of rain; the drain is silted.");
    expect(s.website).toBe("");
    expect(s.place).toMatchObject({ lng: 77.6235, lat: 12.918, source: "device", accuracyM: 13 });
    expect(s.place?.junction).toMatchObject({ id: "gw-silk", name: "Silk Board Junction" });
    expect(typeof s.place?.junction?.distanceM).toBe("number");
    expect(Number.isInteger(s.place?.junction?.distanceM)).toBe(true);
    expect(toSubmission(draft(), null).place).toBeNull();
    // every key, at every level: nothing that could name a person (the junction's `name` is a road's)
    const keys = (v: unknown, out: string[] = []): string[] => {
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          out.push(k);
          keys(x, out);
        }
      }
      return out;
    };
    expect(keys(s).filter((k) => /contact|phone|email|user|device_?id|ip|agent/i.test(k))).toEqual([]);
  });

  it("rounds coordinates to six decimals (about 10 cm) so a fix is never more exact than the map", () => {
    const s = toSubmission(draft(), placeAt([77.62345678901, 12.91812345678], "map", ALL));
    expect(s.place).toMatchObject({ lng: 77.623457, lat: 12.918123 });
  });
});

describe("the board", () => {
  const g: BoardGrievance = { id: "69ceb813-28d5-4909-8029-dc1c735da6cf", kind: "pothole", words: "Deep pothole at the stop line.", place: { lng: 77.6235, lat: 12.918, source: "map", accuracyM: null, junction: { id: "gw-silk", name: "Silk Board Junction", distanceM: 96 } }, photo: { width: 1280, height: 960, bytes: 300_000 }, filedAt: FILED };

  it("formats one grievance for the share sheet or clipboard: kind, place with the junction, the time in IST, the words, the link", () => {
    const text = formatBoardGrievance(g, boardLink("https://thetraffic.example", g.id));
    expect(text.split("\n")[0]).toBe("theTraffic. — grievance · Pothole or broken road");
    expect(text).toContain("Place: 12.91800, 77.62350 · near Silk Board Junction · https://www.openstreetmap.org/");
    expect(text).toContain("Filed: 11 Sept 2026, 2:05 pm IST");
    expect(text).toContain("\n\nDeep pothole at the stop line.\n\nhttps://thetraffic.example/grievances#g-69ceb813-28d5-4909-8029-dc1c735da6cf");
    expect(text).not.toMatch(/exif|gps|contact/i);
    const bare = formatBoardGrievance({ ...g, words: "", place: null }, boardLink("", g.id));
    expect(bare).not.toContain("Place:");
    expect(bare.trim().endsWith("/grievances#g-69ceb813-28d5-4909-8029-dc1c735da6cf")).toBe(true);
  });

  it("stamps the board in IST, dropping the year inside the current one", () => {
    expect(fmtBoardTime(FILED, FILED)).toBe("11 Sept, 2:05 pm");
    expect(fmtBoardTime(FILED, Date.UTC(2027, 0, 1))).toBe("11 Sept 2026, 2:05 pm");
  });

  it("offers eight plain kinds about the road itself, none promising a fix or naming an authority", () => {
    expect(GRIEVANCE_KINDS.map((k) => k.id)).toEqual(["pothole", "footpath", "water", "crossing", "signal", "light", "parking", "other"]);
    for (const k of GRIEVANCE_KINDS) {
      expect(k.label).not.toMatch(/police|BTP|BBMP|fix|resolve|will be|app|bug/i);
      expect(k.short.length).toBeLessThanOrEqual(9);
    }
    expect(kindLabel("crossing")).toBe("No safe way to cross");
    expect(kindShort("water")).toBe("Water");
    expect(isGrievanceKind("footpath")).toBe(true);
    expect(isGrievanceKind("signal_down")).toBe(false); // the old signal-only kinds are gone
    expect(isGrievanceKind(null)).toBe(false);
  });
});

describe("the photo pipeline's pure parts", () => {
  it("never enlarges and fits the long edge to 1280 px", () => {
    expect(fitScale(4000, 3000)).toBeCloseTo(0.32);
    expect(fitScale(800, 600)).toBe(1);
    expect(fitScale(1000, 3000, 1500)).toBe(0.5);
  });

  it("steps the JPEG quality from 0.82 down to 0.5 until the file fits the board's cap", () => {
    const ladder = qualityLadder();
    expect(ladder[0]).toBe(0.82);
    expect(ladder[ladder.length - 1]).toBe(0.5);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]);
  });
});

describe("the board's address", () => {
  it("is the project's Worker unless VITE_GRIEVANCE_API_URL names an https origin; anything else falls back", () => {
    expect(grievanceApiBase(undefined)).toBe(DEFAULT_GRIEVANCE_API);
    expect(grievanceApiBase("")).toBe(DEFAULT_GRIEVANCE_API);
    expect(grievanceApiBase("https://board.example.org/")).toBe("https://board.example.org");
    expect(grievanceApiBase("https://board.example.org/some/path")).toBe("https://board.example.org");
    expect(grievanceApiBase("http://board.example.org")).toBe(DEFAULT_GRIEVANCE_API); // plain http on the web
    expect(grievanceApiBase("http://localhost:8787")).toBe("http://localhost:8787");
    expect(grievanceApiBase("not a url")).toBe(DEFAULT_GRIEVANCE_API);
    expect(DEFAULT_GRIEVANCE_API.startsWith("https://")).toBe(true);
  });
});
