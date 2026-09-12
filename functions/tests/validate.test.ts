/**
 * bun test functions/tests
 * The server's rules for what a grievance may contain — pure functions, no Cloudflare runtime needed.
 */
import { describe, expect, test } from "bun:test";

import { cleanText, containsContactDetails, insideBengaluru, KINDS, kindFilter, pageCursor, pageLimit, parseSubmission, PHOTO_MAX_BYTES, WORDS_MAX } from "../_lib/validate";

const place = { lng: 77.6227, lat: 12.9177, source: "junction", accuracyM: null, junction: { id: "gw-0123456789ab", name: "Silk Board Junction", distanceM: 0 } };

describe("the submission schema", () => {
  test("asks for no account, identity or contact field", () => {
    const r = parseSubmission({ kind: "pothole", words: "Deep pothole at the stop line, two-wheelers swerve into the bus lane.", place, name: "Surya", phone: "9876543210", contact: "me@example.org" }, false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual(["kind", "place", "words"]);
      expect(JSON.stringify(r.value)).not.toMatch(/Surya|9876543210|example\.org/);
    }
  });

  test("accepts every kind and refuses an unknown one", () => {
    for (const kind of KINDS) expect(parseSubmission({ kind, words: "Ten characters at least here.", place }, false).ok).toBe(true);
    const bad = parseSubmission({ kind: "complaint", words: "x", place }, false);
    expect(bad).toMatchObject({ ok: false, status: 400, error: "Pick what the grievance is about." });
  });

  test("needs a photo or a place; 'other' needs a photo or ten characters", () => {
    expect(parseSubmission({ kind: "pothole", words: "" }, false)).toMatchObject({ ok: false, error: "Add a photo, or mark the place on the map." });
    expect(parseSubmission({ kind: "pothole", words: "" }, true).ok).toBe(true); // a photo alone
    expect(parseSubmission({ kind: "pothole", words: "", place }, false).ok).toBe(true); // a kind plus the place is complete
    expect(parseSubmission({ kind: "other", words: "short", place }, false)).toMatchObject({ ok: false, error: "Say what it is in at least 10 characters, or add a photo." });
    expect(parseSubmission({ kind: "other", words: "", place }, true).ok).toBe(true);
  });

  test("refuses phone numbers and e-mail addresses in public words", () => {
    expect(containsContactDetails("call me on 98765 43210")).toBe(true);
    expect(containsContactDetails("+91-98765-43210 anytime")).toBe(true);
    expect(containsContactDetails("write to me at some.one+tag@example.co.in")).toBe(true);
    expect(containsContactDetails("Bus 500D stops 20 m past the line at 8:45 am, 3 days a week")).toBe(false);
    expect(containsContactDetails("The 2010-03 plan gives 120 s cycles")).toBe(false);
    const r = parseSubmission({ kind: "water", words: "Water logging every rain, ring 9876543210 to see it", place }, false);
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toMatch(/phone numbers and e-mail addresses/);
  });

  test("caps the words, refuses a filled honeypot and cleans control characters", () => {
    expect(parseSubmission({ kind: "pothole", words: "x".repeat(WORDS_MAX + 1), place }, false)).toMatchObject({ ok: false, error: "Keep it under 2,000 characters." });
    expect(parseSubmission({ kind: "pothole", words: "fine", place, website: "http://spam" }, false)).toMatchObject({ ok: false, error: "Please leave the hidden field empty." });
    expect(cleanText("  a\u0000b\u200B\r\nc\n\n\n\nd  ", 100)).toBe("ab\nc\n\nd");
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText("é".normalize("NFD"), 10)).toBe("é");
  });

  test("a place must be inside Bengaluru with a known source; a junction must carry a real id", () => {
    expect(insideBengaluru(77.5946, 12.9716)).toBe(true);
    expect(insideBengaluru(72.8777, 19.076)).toBe(false);
    const outside = parseSubmission({ kind: "pothole", words: "", place: { ...place, lng: 72.87, lat: 19.07 } }, false);
    expect(outside).toMatchObject({ ok: false, error: "The place could not be read — mark it on the map again." });
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, source: "guess" } }, false).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { id: "gw-x", name: "n", distanceM: 0 } } }, false).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, distanceM: 5000 } } }, false).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, accuracyM: 12 } }, false).ok).toBe(false); // accuracy only for a device fix
    const device = parseSubmission({ kind: "pothole", words: "", place: { lng: 77.59461234567, lat: 12.97164321, source: "device", accuracyM: 18.4, junction: null } }, false);
    expect(device.ok).toBe(true);
    if (device.ok) expect(device.value.place).toEqual({ lng: 77.594612, lat: 12.971643, source: "device", accuracyM: 18, junction: null });
  });

  test("junction names are cleaned, capped and screened for contact details", () => {
    const r = parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: " <b>Silk</b>\nBoard\u0000 " } } }, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.place?.junction?.name).toBe("<b>Silk</b> Board"); // stored as text; the page renders text
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: "Call 98765 43210" } } }, false).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: "me@example.org" } } }, false).ok).toBe(false);
  });

  test("paging parameters stay inside their caps", () => {
    expect(pageLimit(null)).toBe(30);
    expect(pageLimit("10")).toBe(10);
    expect(pageLimit("999")).toBe(60);
    expect(pageLimit("-1")).toBe(30);
    expect(pageLimit("abc")).toBe(30);
    expect(pageCursor(null)).toBeNull();
    expect(pageCursor("42")).toBe(42);
    expect(pageCursor("0")).toBeNull();
    expect(pageCursor("1e400")).toBeNull();
    expect(kindFilter("pothole")).toBe("pothole");
    expect(kindFilter("everything")).toBeNull();
    expect(kindFilter(null)).toBeNull();
  });

  test("the photo cap matches what the browser aims for", () => {
    expect(PHOTO_MAX_BYTES).toBe(400 * 1024);
  });
});
