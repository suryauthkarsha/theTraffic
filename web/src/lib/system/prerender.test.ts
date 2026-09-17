import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSitemap, datasetNodes, junctionsFrom, pageFileName, pageGraph, prerenderPages, renderPage } from "./prerender";
import { DEFAULT_SITE_URL, routeMeta, STATIC_ROUTES } from "./routeMeta";

const WEB = path.resolve(__dirname, "../../..");
const template = readFileSync(path.join(WEB, "index.html"), "utf8");
const intersections = readFileSync(path.join(WEB, "public/data/intersections.v1.json"), "utf8");
const cameras = readFileSync(path.join(WEB, "public/data/surveillance_cameras.v1.json"), "utf8");
const texts = { intersections, cameras };

const ldBlocks = (html: string): Record<string, unknown>[][] => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => (JSON.parse(m[1]) as { "@graph": Record<string, unknown>[] })["@graph"]);
const scriptTags = (html: string): string[] => html.match(/<script\b[^>]*>/g) ?? [];
const attr = (html: string, selector: RegExp): string | undefined => selector.exec(html)?.[1];

describe("search pages (user request 2026-09-13: improve SEO) — one HTML file per screen from the finished index.html", () => {
  it("reads every junction of the shipped dataset with its name, position and OSM nodes, and the dataset's OSM base date", () => {
    const { junctions, osmBase } = junctionsFrom(intersections);
    expect(junctions.length).toBeGreaterThan(500);
    expect(osmBase).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const j of junctions) {
      expect(j.id).toMatch(/^gw-[0-9a-f]{12}$/);
      expect(j.name.length).toBeGreaterThan(0);
      expect(j.lat).toBeGreaterThan(12.7);
      expect(j.lat).toBeLessThan(13.2);
      expect(j.lon).toBeGreaterThan(77.3);
      expect(j.lon).toBeLessThan(77.9);
    }
    expect(junctions.some((j) => j.osmNodeIds.length > 0)).toBe(true);
    // a missing or malformed dataset is not a failed build: the screens alone
    expect(junctionsFrom("")).toEqual({ junctions: [], osmBase: null });
    expect(junctionsFrom("[]")).toEqual({ junctions: [], osmBase: null });
    expect(junctionsFrom(JSON.stringify({ intersections: [{ id: "gw-zzz", lat: 1, lon: 2 }, { id: "gw-0123456789ab", lat: "12", lon: 77 }] })).junctions).toEqual([]);
  });

  it("rewrites exactly the head tags a screen owns and leaves every other byte of the template alone", () => {
    const html = renderPage(template, routeMeta("/signals", null), DEFAULT_SITE_URL);
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe("Signal Map · Bengaluru traffic signals &amp; timing · theTraffic.");
    expect(attr(html, /<meta name="description" content="([^"]*)"/)).toMatch(/^Mapped traffic signals in the shipped Bengaluru dataset/);
    expect(attr(html, /<meta name="robots" content="([^"]*)"/)).toBe("index, follow, max-image-preview:large");
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe("https://www.thetraffic.in/signals");
    expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe("https://www.thetraffic.in/signals");
    expect(attr(html, /<meta property="og:title" content="([^"]*)"/)).toBe("Signal Map · Bengaluru traffic signals &amp; timing · theTraffic.");
    expect(attr(html, /<meta name="twitter:title" content="([^"]*)"/)).toBe("Signal Map · Bengaluru traffic signals &amp; timing · theTraffic.");
    for (const key of ["description", "robots", "twitter:title", "twitter:description"]) expect(html.match(new RegExp(`<meta name="${key}"`, "g"))).toHaveLength(1);
    for (const key of ["og:title", "og:description", "og:url"]) expect(html.match(new RegExp(`<meta property="${key}"`, "g"))).toHaveLength(1);
    expect(html.match(/<link rel="canonical"/g)).toHaveLength(1);
    // the same page is the template outside those tags: strip both down and compare
    const strip = (s: string): string => s.replace(/<title>[^<]*<\/title>/, "").replace(/<meta (?:name|property)="(?:description|robots|og:title|og:description|og:url|twitter:title|twitter:description)" content="[^"]*" ?\/?>/g, "").replace(/<link rel="canonical" href="[^"]*" ?\/?>/, "").replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, "");
    expect(strip(html)).toBe(strip(template));
  });

  it("adds one JSON-LD data block and no executable script: the same script tags as the template plus the page's graph", () => {
    const html = renderPage(template, routeMeta("/grievances", null), DEFAULT_SITE_URL);
    const tally = (tags: string[]): Map<string, number> => tags.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>());
    const before = tally(scriptTags(template));
    const after = tally(scriptTags(html));
    const added = [...after].filter(([tag, n]) => n !== (before.get(tag) ?? 0)).map(([tag, n]) => `${tag} ×${n - (before.get(tag) ?? 0)}`);
    expect(added).toEqual(['<script type="application/ld+json"> ×1']);
    expect(scriptTags(html)).toHaveLength(scriptTags(template).length + 1);
    expect(html.match(/<script[^>]+src=/g)).toEqual(template.match(/<script[^>]+src=/g));
    const graphs = ldBlocks(html);
    expect(graphs).toHaveLength(2); // the site-wide graph, then the page's
    expect(graphs[1].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"]);
  });

  it("describes a junction page as a Place with its coordinates, OpenStreetMap nodes and a Signal Map breadcrumb", () => {
    const junction = { id: "gw-0123456789ab", name: "Silk Board Junction", lat: 12.9172, lon: 77.6227, osmNodeIds: [1, 2, 3] };
    const meta = routeMeta(`/intersection/${junction.id}`, junction.name);
    const html = renderPage(template, meta, DEFAULT_SITE_URL, { place: junction });
    expect(attr(html, /<title>([^<]*)<\/title>/)).toBe("Silk Board Junction · signal timing, Bengaluru · theTraffic.");
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe("https://www.thetraffic.in/intersection/gw-0123456789ab");
    const graph = ldBlocks(html)[1];
    expect(graph.map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList", "Place"]);
    const page = graph[0];
    expect(page.url).toBe("https://www.thetraffic.in/intersection/gw-0123456789ab");
    expect(page.isPartOf).toEqual({ "@id": "https://www.thetraffic.in/#website" });
    expect(page.about).toEqual({ "@id": "https://www.thetraffic.in/intersection/gw-0123456789ab#place" });
    expect(graph[1].itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "theTraffic.", item: "https://www.thetraffic.in/" },
      { "@type": "ListItem", position: 2, name: "Signal Map", item: "https://www.thetraffic.in/signals" },
      { "@type": "ListItem", position: 3, name: "Silk Board Junction", item: "https://www.thetraffic.in/intersection/gw-0123456789ab" },
    ]);
    const place = graph[2];
    expect(place.geo).toEqual({ "@type": "GeoCoordinates", latitude: 12.9172, longitude: 77.6227 });
    expect(place.sameAs).toEqual(["https://www.openstreetmap.org/node/1", "https://www.openstreetmap.org/node/2", "https://www.openstreetmap.org/node/3"]);
    expect((place.address as { addressLocality: string }).addressLocality).toBe("Bengaluru");
    // at most eight node links, and none when a junction has no nodes on record
    expect((pageGraph(meta, DEFAULT_SITE_URL, { place: { ...junction, osmNodeIds: Array.from({ length: 20 }, (_, i) => i + 1) } })[2].sameAs as string[]).length).toBe(8);
    expect(pageGraph(meta, DEFAULT_SITE_URL, { place: { ...junction, osmNodeIds: [] } })[2]).not.toHaveProperty("sameAs");
  });

  it("escapes a hostile junction name everywhere it is written — title, attributes and the JSON-LD block", () => {
    const name = `Evil "Road" & <b>Co</b> </script><script>alert(1)</script>`;
    const junction = { id: "gw-0123456789ab", name, lat: 12.9, lon: 77.6, osmNodeIds: [] };
    const html = renderPage(template, routeMeta(`/intersection/${junction.id}`, name), DEFAULT_SITE_URL, { place: junction });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toMatch(/<b>Co<\/b>/);
    expect(scriptTags(html)).toHaveLength(scriptTags(template).length + 1); // the injected </script> never closed anything
    expect(attr(html, /<title>([^<]*)<\/title>/)).toContain("Evil &quot;Road&quot; &amp; &lt;b&gt;Co&lt;/b&gt;".replace(/&quot;/g, '"'));
    expect(attr(html, /<meta property="og:title" content="([^"]*)"/)).toContain("Evil &quot;Road&quot; &amp; &lt;b&gt;");
    const graph = ldBlocks(html)[1];
    expect(graph[2].name).toBe(name); // intact as data once parsed…
    expect(html).toMatch(/\\u003c\/script>/); // …because every "<" in the block is escaped
  });

  it("describes the two OpenStreetMap datasets from their own meta — licence, base date, counts, download — and only where the meta names ODbL", () => {
    const nodes = datasetNodes(DEFAULT_SITE_URL, texts);
    expect(nodes.map((n) => n["@type"])).toEqual(["Dataset", "Dataset"]);
    const [signals, surveillance] = nodes;
    expect(signals["@id"]).toBe("https://www.thetraffic.in/data/intersections.v1.json#dataset");
    expect(signals.license).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
    expect(signals.creditText).toBe("© OpenStreetMap contributors, ODbL 1.0");
    expect(signals.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(signals.description).toMatch(/^\d{3,4} junctions built from \d{3,5} OpenStreetMap traffic-signal nodes inside Bengaluru/);
    expect((signals.spatialCoverage as { geo: { box: string } }).geo.box).toMatch(/^12\.\d+ 77\.\d+ 13\.\d+ 77\.\d+$/); // south west north east
    expect(signals.distribution).toEqual([{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://www.thetraffic.in/data/intersections.v1.json" }]);
    expect(signals.url).toBe("https://www.thetraffic.in/signals");
    expect(surveillance.license).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
    expect(surveillance.description).toMatch(/^\d{3,5} man_made=surveillance records inside the Bengaluru boundary \(OpenStreetMap relation 7902476\)/);
    expect(surveillance.description).toContain("After Thejesh GN's Surveillance in Bengaluru."); // the credit the dataset carries
    expect((surveillance.spatialCoverage as { sameAs: string }).sameAs).toBe("https://www.openstreetmap.org/relation/7902476");
    expect(surveillance.url).toBe("https://www.thetraffic.in/surveillance");
    // no licence is claimed that the file does not state, and a missing file describes nothing
    const unlicensed = datasetNodes(DEFAULT_SITE_URL, { intersections: JSON.stringify({ meta: { source: {} }, intersections: [] }), cameras: "" });
    expect(unlicensed).toHaveLength(1);
    expect(unlicensed[0]).not.toHaveProperty("license");
    expect(unlicensed[0]).not.toHaveProperty("dateModified");
    expect(datasetNodes(DEFAULT_SITE_URL, { intersections: "", cameras: "not json" })).toEqual([]);
  });

  it("writes one page per screen but the home page, plus one per junction, at the path a static host serves for the address", () => {
    expect(pageFileName("/signals")).toBe("signals/index.html");
    expect(pageFileName("/intersection/gw-0123456789ab")).toBe("intersection/gw-0123456789ab/index.html");
    const pages = prerenderPages(template, DEFAULT_SITE_URL, texts);
    const { junctions } = junctionsFrom(intersections);
    expect(pages).toHaveLength(STATIC_ROUTES.length - 1 + junctions.length);
    expect(new Set(pages.map((p) => p.fileName)).size).toBe(pages.length);
    expect(pages.map((p) => p.fileName)).not.toContain("index.html");
    for (const route of STATIC_ROUTES) if (route.path !== "/") expect(pages.map((p) => p.fileName)).toContain(pageFileName(route.path));
    const research = pages.find((p) => p.fileName === "research/index.html")?.source ?? "";
    expect(ldBlocks(research)[1].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList", "Dataset", "Dataset"]);
    expect(ldBlocks(pages.find((p) => p.fileName === "signals/index.html")?.source ?? "")[1].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList", "Dataset"]);
    expect(ldBlocks(pages.find((p) => p.fileName === "surveillance/index.html")?.source ?? "")[1].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList", "Dataset"]);
    expect(ldBlocks(pages.find((p) => p.fileName === "support/index.html")?.source ?? "")[1].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"]);
    const first = junctions[0];
    const page = pages.find((p) => p.fileName === `intersection/${first.id}/index.html`)?.source ?? "";
    expect(attr(page, /<link rel="canonical" href="([^"]*)"/)).toBe(`https://www.thetraffic.in/intersection/${first.id}`);
    expect(attr(page, /<meta name="robots" content="([^"]*)"/)).toBe("index, follow, max-image-preview:large");
  });

  it("points every page at a further domain when one is configured — canonical, share tags, JSON-LD, and the template's own mentions", () => {
    const html = renderPage(template, routeMeta("/helmet", null), "https://thetraffic.example");
    expect(html).not.toContain("https://www.thetraffic.in");
    expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe("https://thetraffic.example/helmet");
    expect(attr(html, /<meta property="og:image" content="([^"]*)"/)).toBe("https://thetraffic.example/og-image.jpg");
    expect(ldBlocks(html)[1][0].isPartOf).toEqual({ "@id": "https://thetraffic.example/#website" });
  });

  it("builds a sitemap of the same pages, with a last-modified date only where one is true", () => {
    const xml = buildSitemap(DEFAULT_SITE_URL, intersections);
    const { junctions, osmBase } = junctionsFrom(intersections);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(STATIC_ROUTES.length + junctions.length);
    expect(locs.slice(0, STATIC_ROUTES.length)).toEqual(STATIC_ROUTES.map((r) => DEFAULT_SITE_URL + r.path));
    expect(locs).toContain(`https://www.thetraffic.in/intersection/${junctions[0].id}`);
    expect(xml.match(/<lastmod>/g)).toHaveLength(junctions.length); // junction pages: the dataset's OSM base date; the screens: none (never the build's date)
    expect(xml).toContain(`<lastmod>${osmBase}</lastmod>`);
    expect(xml.split("\n")[1]).toBe('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    // every sitemap address is a page the build writes (the home page is index.html itself)
    const files = new Set(prerenderPages(template, DEFAULT_SITE_URL, texts).map((p) => p.fileName));
    for (const loc of locs) {
      const p = loc.slice(DEFAULT_SITE_URL.length);
      if (p !== "/") expect(files.has(pageFileName(p)), loc).toBe(true);
    }
    expect(buildSitemap("https://thetraffic.example", "")).toMatch(/<loc>https:\/\/thetraffic\.example\/signals<\/loc>/);
    expect(buildSitemap("https://thetraffic.example", "")).not.toMatch(/<lastmod>/);
  });
});
