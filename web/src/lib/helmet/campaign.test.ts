import { describe, expect, it } from "vitest";

import { AMOUNT_MAX, AMOUNTS, appPayLink, FIGURES, fmtRupees, isUpiId, LAW, payPlatform, qrMatrix, qrPath, shareText, STEPS, UPI_APPS, UPI_ID, upiPayLink, upiQuery, validAmount } from "./campaign";

describe("the helmet campaign (user request 2026-09-12: a /helmet page with the campaign and its payment link)", () => {
  it("pays to the one UPI id the owner gave, a well-formed virtual payment address", () => {
    expect(UPI_ID).toBe("7338425455@fam"); // the owner's campaign address — change it here and nowhere else
    expect(isUpiId(UPI_ID)).toBe(true);
    for (const bad of ["", "fam", "@fam", "7338425455@", "7338425455 @fam", "a@b c", "x@fam@fam", "name@-bank"]) expect(isUpiId(bad), bad).toBe(false);
  });

  it("builds a upi://pay link per the NPCI linking spec — payee, name and currency always, the amount only when one was chosen, the id left unencoded", () => {
    const any = upiPayLink(null);
    expect(any).toBe("upi://pay?pa=7338425455@fam&pn=theTraffic&cu=INR&tn=Helmet%20campaign");
    expect(any).not.toMatch(/%40/); // a percent-encoded @ in `pa` trips some apps
    expect(any).not.toMatch(/[?&]am=/);
    const fixed = upiPayLink(500);
    expect(fixed).toContain("&am=500&");
    expect(fixed.startsWith("upi://pay?pa=7338425455@fam&")).toBe(true);
    const params = new URLSearchParams(fixed.slice(fixed.indexOf("?") + 1));
    expect(params.get("pa")).toBe(UPI_ID);
    expect(params.get("pn")).toBe("theTraffic");
    expect(params.get("cu")).toBe("INR");
    expect(params.get("am")).toBe("500");
    expect(params.get("tn")).toBe("Helmet campaign");
    expect(upiPayLink(200, "someone@bank")).toContain("pa=someone@bank&");
  });

  it("names the apps an iPhone can be sent to, each on the scheme documented for iOS, carrying the very query the generic link carries (user report 2026-09-17: iOS handed upi://pay to WhatsApp)", () => {
    expect(UPI_APPS.map((a) => a.name)).toEqual(["PhonePe", "Google Pay", "Paytm", "CRED", "BHIM"]); // by UPI volume
    expect(new Set(UPI_APPS.map((a) => a.id)).size).toBe(UPI_APPS.length);
    for (const app of UPI_APPS) {
      expect(app.iosPrefix, app.id).toMatch(/^[a-z]+:\/\/(upi\/)?pay$/);
      expect(app.iosPrefix.startsWith("upi://"), app.id).toBe(false); // the generic scheme is the one iOS cannot route
      const l = appPayLink(app, 500);
      expect(l).toBe(`${app.iosPrefix}?${upiQuery(500)}`);
      expect(l.slice(l.indexOf("?"))).toBe(upiPayLink(500).slice("upi://pay".length)); // same query as the QR code and the Android link
      expect(appPayLink(app, null)).not.toMatch(/[?&]am=/);
    }
    expect(appPayLink(UPI_APPS[0], null)).toBe("phonepe://pay?pa=7338425455@fam&pn=theTraffic&cu=INR&tn=Helmet%20campaign");
    expect(appPayLink(UPI_APPS[1], 200)).toBe("gpay://upi/pay?pa=7338425455@fam&pn=theTraffic&cu=INR&am=200&tn=Helmet%20campaign"); // Google's documented iOS form
    expect(appPayLink(UPI_APPS[2], null)).toMatch(/^paytmmp:\/\/pay\?pa=/);
    expect(appPayLink(UPI_APPS[3], null)).toMatch(/^credpay:\/\/upi\/pay\?pa=/);
    expect(appPayLink(UPI_APPS[4], null)).toMatch(/^bhim:\/\/pay\?pa=/);
    expect(upiPayLink(500)).toBe(`upi://pay?${upiQuery(500)}`);
  });

  it("tells an iPhone from an Android phone from anything else by the browser's own description — iPadOS's Mac disguise included", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const ipad = "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(payPlatform(iphone, 5)).toBe("ios");
    expect(payPlatform(ipad, 5)).toBe("ios");
    expect(payPlatform(mac, 5)).toBe("ios"); // an iPad asking for the desktop site says Mac, but has a touch screen
    expect(payPlatform(mac, 0)).toBe("other"); // a Mac
    expect(payPlatform(android, 5)).toBe("android");
    expect(payPlatform(windows, 0)).toBe("other");
    expect(payPlatform(windows, 10)).toBe("other"); // a touch laptop has no UPI apps
    expect(payPlatform("Node.js/22", 0)).toBe("other"); // the test runner
    expect(payPlatform("", 0)).toBe("other");
  });

  it("encodes only a whole number of rupees within UPI's ceiling; anything else leaves the amount to the payer's app", () => {
    expect(validAmount(200)).toBe(200);
    expect(validAmount(AMOUNT_MAX)).toBe(AMOUNT_MAX);
    for (const v of [0, -1, 1.5, AMOUNT_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) expect(validAmount(v), String(v)).toBeNull();
    for (const v of [0, -5, 2.5, 10_00_000]) expect(upiPayLink(v)).not.toMatch(/[?&]am=/);
  });

  it("offers a few plain amounts, ascending, each printable and within the ceiling", () => {
    expect(AMOUNTS.length).toBeGreaterThanOrEqual(3);
    expect(AMOUNTS.length).toBeLessThanOrEqual(5);
    expect([...AMOUNTS]).toEqual([...AMOUNTS].sort((a, b) => a - b));
    expect(new Set(AMOUNTS).size).toBe(AMOUNTS.length);
    for (const a of AMOUNTS) expect(validAmount(a)).toBe(a);
    expect(fmtRupees(1000)).toBe("₹1,000");
    expect(fmtRupees(100_000)).toBe("₹1,00,000"); // Indian grouping
  });

  it("draws the QR code itself: a square matrix with a two-module quiet zone, one unit square per dark module", () => {
    const m = qrMatrix(upiPayLink(null));
    expect(m.length).toBeGreaterThanOrEqual(25 + 4); // version 2 or above, plus the border
    expect(m.length).toBeLessThanOrEqual(45 + 4); // and no finer than version 7, so a 216 px tile scans from a screen
    for (const row of m) expect(row.length).toBe(m.length);
    // quiet zone: the outer two rings carry no dark module
    for (const i of [0, 1, m.length - 2, m.length - 1]) {
      expect(m[i].some(Boolean)).toBe(false);
      expect(m.map((r) => r[i]).some(Boolean)).toBe(false);
    }
    // finder pattern: the top-left corner inside the border starts with a 7-module dark run
    expect(m[2].slice(2, 9)).toEqual([true, true, true, true, true, true, true]);
    const dark = m.flat().filter(Boolean).length;
    const path = qrPath(m);
    expect(path.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
    expect(path).toMatch(/^M2 2h1v1h-1z/); // the first dark module is the finder's corner
    expect(qrMatrix(upiPayLink(500))).not.toEqual(m); // a chosen amount changes the code
    expect(qrPath([[false, true], [true, false]])).toBe("M1 0h1v1h-1zM0 1h1v1h-1z");
  });

  it("states four dated figures and two rules, each with a public https source, and three one-sentence steps", () => {
    expect(FIGURES).toHaveLength(4);
    for (const f of FIGURES) {
      expect(f.source.href).toMatch(/^https:\/\//);
      expect(f.source.name.length).toBeGreaterThan(8);
      expect(f.label.length).toBeLessThanOrEqual(140);
    }
    expect(FIGURES.map((f) => f.value)).toEqual(["54,568", "15,408", "909", "25–30 %"]);
    expect(FIGURES[0].source.href).toContain("morth.gov.in"); // the national figures come from the ministry's own report
    expect(FIGURES[0].label).toContain("2023"); // years named, nothing projected
    expect(FIGURES[2].label).toContain("2023");
    expect(FIGURES[3].source.name).toMatch(/2024/);
    for (const rule of Object.values(LAW)) expect(rule.href).toMatch(/^https:\/\//);
    expect(LAW.bis2021.href).toContain("bis.gov.in");
    expect(STEPS.map((s) => s.index)).toEqual(["01", "02", "03"]);
    for (const s of STEPS) expect(s.body.split(/(?<=[.!?])\s+/).length).toBe(1);
  });

  it("shares the campaign with the id and the link, nothing more", () => {
    const t = shareText("https://www.thetraffic.in/helmet");
    expect(t).toContain(UPI_ID);
    expect(t.endsWith("\nhttps://www.thetraffic.in/helmet")).toBe(true);
    expect(t).not.toMatch(/\+91|@gmail/);
  });
});
