/**
 * bun test functions/tests
 * The server's rules for what a grievance may contain — pure functions, no Cloudflare runtime needed.
 */
import { describe, expect, test } from "bun:test";

import { cleanText, containsContactDetails, insideBengaluru, KINDS, kindFilter, pageCursor, pageLimit, parseSubmission, PHOTO_MAX_BYTES, PHOTO_REQUIRED, WORDS_MAX } from "../_lib/validate";

const place = { lng: 77.6227, lat: 12.9177, source: "junction", accuracyM: null, junction: { id: "gw-0123456789ab", name: "Silk Board Junction", distanceM: 0 } };

describe("the submission schema", () => {
  test("asks for no account, identity or contact field", () => {
    const r = parseSubmission({ kind: "pothole", words: "Deep pothole at the stop line, two-wheelers swerve into the bus lane.", place, name: "Surya", phone: "9876543210", contact: "me@example.org" }, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual(["kind", "place", "words"]);
      expect(JSON.stringify(r.value)).not.toMatch(/Surya|9876543210|example\.org/);
    }
  });

  test("accepts every kind and refuses an unknown one", () => {
    for (const kind of KINDS) expect(parseSubmission({ kind, words: "Ten characters at least here.", place }, true).ok).toBe(true);
    const bad = parseSubmission({ kind: "complaint", words: "x", place }, true);
    expect(bad).toMatchObject({ ok: false, status: 400, error: "Pick what the grievance is about." });
  });

  test("needs a photo — always (user decision 2026-09-13); the place and the words are optional and never stand in for it", () => {
    expect(PHOTO_REQUIRED).toBe("Add a photo — every grievance needs one.");
    expect(parseSubmission({ kind: "pothole", words: "" }, false)).toMatchObject({ ok: false, status: 400, error: PHOTO_REQUIRED });
    expect(parseSubmission({ kind: "pothole", words: "", place }, false)).toMatchObject({ ok: false, status: 400, error: PHOTO_REQUIRED }); // the place alone is not enough any more
    expect(parseSubmission({ kind: "other", words: "Hawkers on the carriageway, every evening", place }, false)).toMatchObject({ ok: false, error: PHOTO_REQUIRED }); // nor are the words
    expect(parseSubmission({ kind: "pothole", words: "" }, true).ok).toBe(true); // a photo alone
    expect(parseSubmission({ kind: "pothole", words: "", place }, true).ok).toBe(true);
    expect(parseSubmission({ kind: "other", words: "", place }, true).ok).toBe(true); // 'other' with its photo, no minimum words
    // the photo rule is answered before the words or the place are judged, so a photo-less post costs no place parse
    expect(parseSubmission({ kind: "pothole", words: "x".repeat(WORDS_MAX + 1), place: { lng: 1, lat: 2 } }, false)).toMatchObject({ ok: false, error: PHOTO_REQUIRED });
  });

  test("refuses phone numbers and e-mail addresses in public words", () => {
    expect(containsContactDetails("call me on 98765 43210")).toBe(true);
    expect(containsContactDetails("+91-98765-43210 anytime")).toBe(true);
    expect(containsContactDetails("write to me at some.one+tag@example.co.in")).toBe(true);
    expect(containsContactDetails("Bus 500D stops 20 m past the line at 8:45 am, 3 days a week")).toBe(false);
    expect(containsContactDetails("The 2010-03 plan gives 120 s cycles")).toBe(false);
    const r = parseSubmission({ kind: "water", words: "Water logging every rain, ring 9876543210 to see it", place }, true);
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toMatch(/phone numbers and e-mail addresses/);
  });

  test("caps the words, refuses a filled honeypot and cleans control characters", () => {
    expect(parseSubmission({ kind: "pothole", words: "x".repeat(WORDS_MAX + 1), place }, true)).toMatchObject({ ok: false, error: "Keep it under 2,000 characters." });
    expect(parseSubmission({ kind: "pothole", words: "fine", place, website: "http://spam" }, true)).toMatchObject({ ok: false, error: "Please leave the hidden field empty." });
    expect(parseSubmission({ kind: "pothole", words: "fine", place, website: "http://spam" }, false)).toMatchObject({ ok: false, error: "Please leave the hidden field empty." }); // the honeypot is judged even before the photo
    expect(cleanText("  a\u0000b\u200B\r\nc\n\n\n\nd  ", 100)).toBe("ab\nc\n\nd");
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText("é".normalize("NFD"), 10)).toBe("é");
  });

  test("a place must be inside Bengaluru with a known source; a junction must carry a real id", () => {
    expect(insideBengaluru(77.5946, 12.9716)).toBe(true);
    expect(insideBengaluru(72.8777, 19.076)).toBe(false);
    const outside = parseSubmission({ kind: "pothole", words: "", place: { ...place, lng: 72.87, lat: 19.07 } }, true);
    expect(outside).toMatchObject({ ok: false, error: "The place could not be read — mark it on the map again." });
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, source: "guess" } }, true).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { id: "gw-x", name: "n", distanceM: 0 } } }, true).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, distanceM: 5000 } } }, true).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, accuracyM: 12 } }, true).ok).toBe(false); // accuracy only for a device fix
    const device = parseSubmission({ kind: "pothole", words: "", place: { lng: 77.59461234567, lat: 12.97164321, source: "device", accuracyM: 18.4, junction: null } }, true);
    expect(device.ok).toBe(true);
    if (device.ok) expect(device.value.place).toEqual({ lng: 77.594612, lat: 12.971643, source: "device", accuracyM: 18, junction: null });
  });

  test("junction names are cleaned, capped and screened for contact details", () => {
    const r = parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: " <b>Silk</b>\nBoard\u0000 " } } }, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.place?.junction?.name).toBe("<b>Silk</b> Board"); // stored as text; the page renders text
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: "Call 98765 43210" } } }, true).ok).toBe(false);
    expect(parseSubmission({ kind: "pothole", words: "", place: { ...place, junction: { ...place.junction, name: "me@example.org" } } }, true).ok).toBe(false);
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
