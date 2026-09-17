// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applyRouteMeta, DEFAULT_SITE_URL, HOME_TITLE, routeMeta, SITE_DESCRIPTION, SITE_KEYWORDS, siteUrl } from "./seo";
import { STATIC_ROUTES } from "./routeMeta";

const SCREENS = ["/", "/console", "/signals", "/surveillance", "/research", "/methodology", "/support", "/grievances", "/grievance", "/helmet"];

describe("search metadata (user requests 2026-09-11 and 2026-09-13: enhance / improve the SEO)", () => {
  it("gives every screen a title of its own — its name, what it is with the city in it, the wordmark — within 70 characters, and a description of 100–160", () => {
    expect(routeMeta("/", null).title).toBe(HOME_TITLE);
    expect(HOME_TITLE).toBe("theTraffic. · Bengaluru traffic signals, junction by junction");
    expect(routeMeta("/signals", null).title).toBe("Signal Map · Bengaluru traffic signals & timing · theTraffic.");
    expect(routeMeta("/grievances", null).title).toBe("Grievances · Bengaluru road problems, public board · theTraffic.");
    for (const p of SCREENS) {
      const m = routeMeta(p, null);
      expect(m.index).toBe(true);
      expect(m.title.length, `${p} title: ${m.title}`).toBeLessThanOrEqual(70);
      expect(m.title.length).toBeGreaterThanOrEqual(40);
      expect(m.title).toMatch(/theTraffic\.$|^theTraffic\./);
      expect(m.title + m.description).toMatch(/Bengaluru/); // the city is in the title wherever it belongs there, and always in the description
      expect(m.description).toMatch(/Bengaluru/);
      expect(m.description.length, `${p} description: ${m.description}`).toBeGreaterThanOrEqual(100);
      expect(m.description.length).toBeLessThanOrEqual(170);
      expect(m.description).not.toMatch(/anonymous|verified by/); // release wording: account-free, accepted by review
    }
    expect(new Set(SCREENS.map((p) => routeMeta(p, null).title)).size).toBe(SCREENS.length); // no two screens share a title
    expect(new Set(SCREENS.map((p) => routeMeta(p, null).description)).size).toBe(SCREENS.length);
  });

  it("gives a junction page the junction's name, and keeps a junction that is not on file out of the index", () => {
    const m = routeMeta("/intersection/gw-0123456789ab", "Silk Board Junction");
    expect(m.title).toBe("Silk Board Junction · signal timing, Bengaluru · theTraffic.");
    expect(m.description).toContain("Silk Board Junction in Bengaluru");
    expect(m.canonicalPath).toBe("/intersection/gw-0123456789ab");
    expect(m.index).toBe(true);
    expect(m.trail).toEqual([
      { name: "theTraffic.", path: "/" },
      { name: "Signal Map", path: "/signals" },
      { name: "Silk Board Junction", path: "/intersection/gw-0123456789ab" },
    ]);
    const missing = routeMeta("/intersection/gw-ffffffffffff", null);
    expect(missing.index).toBe(false);
    expect(missing.title).toBe("Junction not found · theTraffic.");
  });

  it("strips query strings, hashes and trailing slashes from the canonical path", () => {
    expect(routeMeta("/signals?layer=coverage", null).canonicalPath).toBe("/signals");
    expect(routeMeta("/grievances#g-abc", null).canonicalPath).toBe("/grievances");
    expect(routeMeta("/grievances/", null).canonicalPath).toBe("/grievances");
    expect(routeMeta("//", null).canonicalPath).toBe("/");
  });

  it("gives every screen a breadcrumb trail that starts at the home page and ends at the screen", () => {
    expect(routeMeta("/", null).trail).toEqual([{ name: "theTraffic.", path: "/" }]);
    expect(routeMeta("/signals", null).trail).toEqual([
      { name: "theTraffic.", path: "/" },
      { name: "Signal Map", path: "/signals" },
    ]);
    expect(routeMeta("/grievance", null).trail.map((c) => c.path)).toEqual(["/", "/console", "/grievances", "/grievance"]);
    expect(routeMeta("/helmet", null).trail.map((c) => c.name)).toEqual(["theTraffic.", "Console", "Helmet campaign"]);
    for (const p of SCREENS) {
      const trail = routeMeta(p, null).trail;
      expect(trail[0]).toEqual({ name: "theTraffic.", path: "/" });
      expect(trail[trail.length - 1].path).toBe(p);
    }
  });

  it("lists every screen in the sitemap table exactly once, and every sitemap screen has metadata", () => {
    expect(STATIC_ROUTES.map((r) => r.path).sort()).toEqual([...SCREENS].sort());
    for (const r of STATIC_ROUTES) expect(routeMeta(r.path, null).index).toBe(true);
  });

  it("keeps unknown paths out of the index", () => {
    const m = routeMeta("/nowhere", "Not found");
    expect(m.index).toBe(false);
    expect(m.title).toBe("Not found · theTraffic.");
    expect(m.trail).toEqual([{ name: "theTraffic.", path: "/" }]);
  });

  it("carries both spellings of the city and every kind of road problem the board takes", () => {
    const all = SITE_KEYWORDS.join(" ");
    expect(all).toMatch(/Bengaluru/);
    expect(all).toMatch(/Bangalore/);
    for (const word of ["pothole", "footpath", "water logging", "pedestrian crossing", "street light", "traffic signal", "CCTV", "grievance", "helmet"]) expect(all.toLowerCase()).toContain(word.toLowerCase());
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

  it("writes title, description, robots, canonical and the share cards into the head — updating tags in place, never duplicating them", () => {
    document.head.innerHTML = '<meta name="description" content="old" /><link rel="canonical" href="https://old.example/" /><meta property="og:title" content="old" />';
    applyRouteMeta(document, routeMeta("/grievances?kind=pothole", null), "https://thetraffic.example");
    expect(document.title).toBe("Grievances · Bengaluru road problems, public board · theTraffic.");
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toMatch(/account-free public board of Bengaluru road problems/);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://thetraffic.example/grievances");
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Grievances · Bengaluru road problems, public board · theTraffic.");
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe("https://thetraffic.example/grievances");
    expect(document.head.querySelector('meta[name="twitter:title"]')?.getAttribute("content")).toBe("Grievances · Bengaluru road problems, public board · theTraffic.");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow, max-image-preview:large");
    applyRouteMeta(document, routeMeta("/nowhere", "Not found"), "https://thetraffic.example");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });
});
