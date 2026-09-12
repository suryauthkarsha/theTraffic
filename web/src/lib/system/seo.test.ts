// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applyRouteMeta, DEFAULT_SITE_URL, routeMeta, SITE_DESCRIPTION, SITE_KEYWORDS, siteUrl } from "./seo";

describe("search metadata (user request 2026-09-11: enhance the SEO)", () => {
  it("gives every screen a title of its own with the city and the subject in it, and a canonical path without query or hash", () => {
    expect(routeMeta("/", null).title).toBe("theTraffic. · Bengaluru traffic signals, junction by junction");
    expect(routeMeta("/signals?layer=coverage", null).canonicalPath).toBe("/signals");
    expect(routeMeta("/grievances#g-abc", null).canonicalPath).toBe("/grievances");
    expect(routeMeta("/grievances/", null).canonicalPath).toBe("/grievances");
    expect(routeMeta("/intersection/gw-0123456789ab", "Silk Board Junction").title).toBe("Silk Board Junction · traffic signal timing, Bengaluru — theTraffic.");
    expect(routeMeta("/intersection/gw-0123456789ab", "Silk Board Junction").description).toContain("Silk Board Junction in Bengaluru");
    expect(routeMeta("/intersection/gw-0123456789ab", "Silk Board Junction").canonicalPath).toBe("/intersection/gw-0123456789ab");
    for (const p of ["/", "/console", "/signals", "/surveillance", "/research", "/methodology", "/support", "/grievances", "/grievance"]) {
      const m = routeMeta(p, null);
      expect(m.index).toBe(true);
      expect(m.title.length).toBeGreaterThanOrEqual(40);
      expect(m.title.length).toBeLessThanOrEqual(90);
      expect(m.description.length).toBeGreaterThanOrEqual(100);
      expect(m.description.length).toBeLessThanOrEqual(260);
      expect(m.title + m.description).toMatch(/Bengaluru/);
    }
  });

  it("keeps unknown paths out of the index", () => {
    const m = routeMeta("/nowhere", "Not found");
    expect(m.index).toBe(false);
    expect(m.title).toBe("Not found · theTraffic.");
  });

  it("carries both spellings of the city and every kind of road problem the board takes", () => {
    const all = SITE_KEYWORDS.join(" ");
    expect(all).toMatch(/Bengaluru/);
    expect(all).toMatch(/Bangalore/);
    for (const word of ["pothole", "footpath", "water logging", "pedestrian crossing", "street light", "traffic signal", "CCTV", "grievance"]) expect(all.toLowerCase()).toContain(word.toLowerCase());
    expect(SITE_KEYWORDS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SITE_KEYWORDS).size).toBe(SITE_KEYWORDS.length);
    expect(SITE_DESCRIPTION).toMatch(/account-free public board/);
  });

  it("uses VITE_SITE_URL only when it is an https origin", () => {
    expect(siteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(siteUrl("https://thetraffic.in/")).toBe("https://thetraffic.in");
    expect(siteUrl("https://thetraffic.in/some/path")).toBe("https://thetraffic.in");
    expect(siteUrl("http://thetraffic.in")).toBe(DEFAULT_SITE_URL);
    expect(siteUrl("nonsense")).toBe(DEFAULT_SITE_URL);
  });

  it("writes description, robots, canonical and the share cards into the head — updating tags in place, never duplicating them", () => {
    document.head.innerHTML = '<meta name="description" content="old" /><link rel="canonical" href="https://old.example/" /><meta property="og:title" content="old" />';
    applyRouteMeta(document, routeMeta("/grievances?kind=pothole", null), "https://thetraffic.example");
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toMatch(/account-free public board of Bengaluru road problems/);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://thetraffic.example/grievances");
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Bengaluru road grievances · potholes, footpaths, water, crossings");
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe("https://thetraffic.example/grievances");
    expect(document.head.querySelector('meta[name="twitter:title"]')?.getAttribute("content")).toBe("Bengaluru road grievances · potholes, footpaths, water, crossings");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow, max-image-preview:large");
    applyRouteMeta(document, routeMeta("/nowhere", "Not found"), "https://thetraffic.example");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    expect(document.head.querySelectorAll("meta[name=\"robots\"]")).toHaveLength(1);
  });
});
