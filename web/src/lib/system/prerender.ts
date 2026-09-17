/**
 * One HTML file per screen at build (user request 2026-09-13: "improve SEO").
 *
 * A single-page app answers every address with the same index.html, so a crawler that does not run
 * scripts saw the home page's title, description and canonical link on /signals, on the board and on
 * every one of the junction pages — each screen a duplicate of the home page to it. The build now
 * writes `signals/index.html`, `intersection/<id>/index.html` and so on from the finished index.html —
 * the same hashed chunks, the same Content Security Policy — with that screen's own <title>,
 * description, canonical link, share tags and a JSON-LD graph: the WebPage, its BreadcrumbList, a
 * junction as a Place with its coordinates and OpenStreetMap nodes, and on the data screens the two
 * OpenStreetMap-derived datasets as Dataset records (licence, download, coverage, base date — read
 * from each dataset's own `meta`, never written in). Vercel — the public host — serves `foo/index.html`
 * for /foo before any rewrite runs (the Rork preview's route map answers an extensionless path with the
 * root file first, so there the per-page head still arrives once the script runs); the root index.html
 * stays the home page and the fallback for unknown paths. No executable script is added — JSON-LD data
 * blocks only.
 *
 * Pure given the template text and the dataset texts; `vite.config.ts` calls it. Imported by the build
 * config, so only relative imports here.
 */
import { DEFAULT_SITE_URL, ROBOTS_INDEX, ROBOTS_NOINDEX, routeMeta, STATIC_ROUTES, type RouteMeta } from "./routeMeta";

/** A junction of the signal dataset, as much of it as a page's metadata needs. */
export interface Junction {
  id: string;
  name: string;
  lat: number;
  lon: number;
  osmNodeIds: number[];
}

/** The texts of the shipped datasets a page may describe; empty when a file is missing. */
export interface DatasetTexts {
  intersections: string;
  cameras: string;
}

const JUNCTION_ID = /^gw-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;
const ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
const OSM_URL = "https://www.openstreetmap.org/";

const day = (v: unknown): string | null => (typeof v === "string" && DAY.test(v) ? v.slice(0, 10) : null);
const parse = (json: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** The junctions of the signal dataset and its OSM base date (`YYYY-MM-DD`). Tolerates a missing or malformed dataset: no junctions. */
export function junctionsFrom(datasetJson: string): { junctions: Junction[]; osmBase: string | null } {
  const data = parse(datasetJson);
  if (!data) return { junctions: [], osmBase: null };
  const junctions: Junction[] = [];
  for (const raw of Array.isArray(data.intersections) ? (data.intersections as unknown[]) : []) {
    const i = record(raw);
    if (typeof i.id !== "string" || !JUNCTION_ID.test(i.id) || typeof i.lat !== "number" || typeof i.lon !== "number" || !Number.isFinite(i.lat) || !Number.isFinite(i.lon)) continue;
    const name = typeof i.canonical_name === "string" && i.canonical_name.trim() ? i.canonical_name.trim() : "Junction";
    const osmNodeIds = Array.isArray(i.osm_node_ids) ? i.osm_node_ids.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
    junctions.push({ id: i.id, name, lat: i.lat, lon: i.lon, osmNodeIds });
  }
  return { junctions, osmBase: day(record(record(data.meta).source).osm_timestamp_base) };
}

/**
 * The two OpenStreetMap-derived datasets as schema.org Dataset records, each built from its file's own
 * `meta` — counts, base date, bounding box or boundary relation, licence, attribution. A dataset whose
 * meta does not name ODbL gets no `license` (the timing plans, which say "No License Provided", are
 * described by nothing here). Missing or malformed file: no record.
 */
export function datasetNodes(origin: string, texts: DatasetTexts): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const creator = { "@id": `${origin}/#organization` };
  const download = (file: string): Record<string, unknown>[] => [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${origin}/data/${file}` }];
  const odbl = (license: unknown): Record<string, unknown> => (typeof license === "string" && /ODbL/i.test(license) ? { license: ODBL_URL } : {});

  const signals = parse(texts.intersections);
  if (signals) {
    const meta = record(signals.meta);
    const source = record(meta.source);
    const counts = record(meta.counts);
    const junctions = count(counts.logical_intersections) ?? (Array.isArray(signals.intersections) ? signals.intersections.length : 0);
    const nodesN = count(counts.source_signal_nodes);
    const base = day(source.osm_timestamp_base);
    const bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 && meta.bbox.every((n) => typeof n === "number") ? (meta.bbox as number[]) : null;
    nodes.push({
      "@type": "Dataset",
      "@id": `${origin}/data/intersections.v1.json#dataset`,
      name: "theTraffic. · Bengaluru traffic signal junctions (intersections.v1)",
      description: `${junctions} junctions built from ${nodesN ?? "the"} OpenStreetMap traffic-signal nodes inside Bengaluru, with their approaches and what is known about each one's timing records.${base ? ` OpenStreetMap base ${base}.` : ""}`,
      url: `${origin}/signals`,
      ...odbl(source.license),
      creditText: "© OpenStreetMap contributors, ODbL 1.0",
      isBasedOn: OSM_URL,
      creator,
      ...(base ? { dateModified: base } : {}),
      keywords: ["Bengaluru", "Bangalore", "traffic signals", "junctions", "signal timing", "OpenStreetMap"],
      spatialCoverage: { "@type": "Place", name: "Bengaluru", ...(bbox ? { geo: { "@type": "GeoShape", box: `${bbox[1]} ${bbox[0]} ${bbox[3]} ${bbox[2]}` } } : {}) },
      distribution: download("intersections.v1.json"),
    });
  }

  const cameras = parse(texts.cameras);
  if (cameras) {
    const meta = record(cameras.meta);
    const area = record(meta.area);
    const credit = record(meta.credit);
    const n = count(meta.count);
    const base = day(meta.osm_base);
    nodes.push({
      "@type": "Dataset",
      "@id": `${origin}/data/surveillance_cameras.v1.json#dataset`,
      name: "theTraffic. · Bengaluru surveillance records mapped in OpenStreetMap (surveillance_cameras.v1)",
      description: `${n ?? "Every"} man_made=surveillance record${n === 1 ? "" : "s"} inside the Bengaluru boundary${typeof area.id === "number" ? ` (OpenStreetMap relation ${area.id})` : ""} — surveillance type, zone, camera type, operator and viewing direction as mapped.${base ? ` OpenStreetMap base ${base}.` : ""}${typeof credit.name === "string" ? ` After ${credit.name}.` : ""}`,
      url: `${origin}/surveillance`,
      ...odbl(meta.license),
      creditText: typeof meta.attribution === "string" ? meta.attribution : "© OpenStreetMap contributors, ODbL 1.0",
      isBasedOn: OSM_URL,
      creator,
      ...(base ? { dateModified: base } : {}),
      keywords: ["Bengaluru", "Bangalore", "CCTV", "surveillance cameras", "OpenStreetMap"],
      spatialCoverage: { "@type": "Place", name: "Bengaluru", ...(typeof area.url === "string" ? { sameAs: area.url } : {}) },
      distribution: download("surveillance_cameras.v1.json"),
    });
  }
  return nodes;
}

/** Which dataset records a screen carries: the data pages describe their own dataset, Research both. */
const DATASETS_ON: Record<string, (nodes: Record<string, unknown>[]) => Record<string, unknown>[]> = {
  "/signals": (nodes) => nodes.filter((n) => String(n["@id"]).includes("intersections")),
  "/surveillance": (nodes) => nodes.filter((n) => String(n["@id"]).includes("surveillance")),
  "/research": (nodes) => nodes,
};

const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeXml = (s: string): string => escapeAttr(s).replace(/'/g, "&apos;");
/** JSON for a `<script type="application/ld+json">` block: every `<` escaped, so no name in the data can close the element. */
const jsonForHtml = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

/** Replaces the one tag `re` matches; the build fails if the template has grown a second one or lost it. */
function setOnce(html: string, re: RegExp, replacement: string, what: string): string {
  const n = (html.match(re) ?? []).length;
  if (n !== 1) throw new Error(`[thetraffic] index.html carries ${n} ${what} tags; the pre-render expects exactly one`);
  return html.replace(re, () => replacement);
}

const metaTag = (attr: "name" | "property", key: string): RegExp => new RegExp(`<meta ${attr}="${key}" content="[^"]*" ?/?>`, "g");

/** What a page is about beyond its route: a junction, or dataset records. */
export interface PageSubject {
  place?: Junction;
  datasets?: Record<string, unknown>[];
}

/** The JSON-LD graph of one page: the WebPage, its breadcrumb trail, and what the page is about. */
export function pageGraph(meta: RouteMeta, origin: string, subject: PageSubject = {}): Record<string, unknown>[] {
  const url = `${origin}${meta.canonicalPath}`;
  const datasets = subject.datasets ?? [];
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: meta.title,
      description: meta.description,
      inLanguage: "en-IN",
      isPartOf: { "@id": `${origin}/#website` },
      breadcrumb: { "@id": `${url}#breadcrumb` },
      ...(subject.place ? { about: { "@id": `${url}#place` } } : {}),
      ...(datasets.length ? { mainEntity: datasets.map((d) => ({ "@id": d["@id"] })) } : {}),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: meta.trail.map((crumb, i) => ({ "@type": "ListItem", position: i + 1, name: crumb.name, item: `${origin}${crumb.path}` })),
    },
  ];
  if (subject.place) {
    const place = subject.place;
    graph.push({
      "@type": "Place",
      "@id": `${url}#place`,
      name: place.name,
      url,
      geo: { "@type": "GeoCoordinates", latitude: place.lat, longitude: place.lon },
      address: { "@type": "PostalAddress", addressLocality: "Bengaluru", addressRegion: "Karnataka", addressCountry: "IN" },
      ...(place.osmNodeIds.length ? { sameAs: place.osmNodeIds.slice(0, 8).map((n) => `https://www.openstreetmap.org/node/${n}`) } : {}),
    });
  }
  graph.push(...datasets);
  return graph;
}

/**
 * The finished index.html rewritten for one screen: title, description, robots, canonical link, Open
 * Graph and Twitter tags, plus the page's JSON-LD graph before `</head>`. Everything else — the module
 * script, the policy, the icons, the site-wide JSON-LD — is the template's, byte for byte. A further
 * domain (`origin`) replaces the site's own wherever the template names it.
 */
export function renderPage(template: string, meta: RouteMeta, origin: string, subject: PageSubject = {}): string {
  const url = `${origin}${meta.canonicalPath}`;
  let html = origin === DEFAULT_SITE_URL ? template : template.split(DEFAULT_SITE_URL).join(origin);
  html = setOnce(html, /<title>[^<]*<\/title>/g, `<title>${escapeText(meta.title)}</title>`, "<title>");
  const set = (attr: "name" | "property", key: string, value: string): void => {
    html = setOnce(html, metaTag(attr, key), `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`, `<meta ${attr}="${key}">`);
  };
  set("name", "description", meta.description);
  set("name", "robots", meta.index ? ROBOTS_INDEX : ROBOTS_NOINDEX);
  set("property", "og:title", meta.title);
  set("property", "og:description", meta.description);
  set("property", "og:url", url);
  set("name", "twitter:title", meta.title);
  set("name", "twitter:description", meta.description);
  html = setOnce(html, /<link rel="canonical" href="[^"]*" ?\/?>/g, `<link rel="canonical" href="${escapeAttr(url)}" />`, "canonical link");
  const script = `<script type="application/ld+json">${jsonForHtml({ "@context": "https://schema.org", "@graph": pageGraph(meta, origin, subject) })}</script>`;
  html = setOnce(html, /<\/head>/g, `  ${script}\n  </head>`, "</head>");
  return html;
}

/** Where a static host looks for the address: `/signals` → `signals/index.html`. */
export function pageFileName(canonicalPath: string): string {
  return `${canonicalPath.replace(/^\/+/, "")}/index.html`;
}

/** Every screen but the home page (which index.html already is), then one page per junction in the dataset. */
export function prerenderPages(template: string, origin: string, texts: DatasetTexts): { fileName: string; source: string }[] {
  const pages: { fileName: string; source: string }[] = [];
  const datasets = datasetNodes(origin, texts);
  for (const route of STATIC_ROUTES) {
    if (route.path === "/") continue;
    const meta = routeMeta(route.path, null);
    const pick = DATASETS_ON[route.path];
    pages.push({ fileName: pageFileName(meta.canonicalPath), source: renderPage(template, meta, origin, pick ? { datasets: pick(datasets) } : {}) });
  }
  for (const junction of junctionsFrom(texts.intersections).junctions) {
    const meta = routeMeta(`/intersection/${junction.id}`, junction.name);
    pages.push({ fileName: pageFileName(meta.canonicalPath), source: renderPage(template, meta, origin, { place: junction }) });
  }
  return pages;
}

/**
 * `sitemap.xml`: the screens above plus one entry per junction, so the sitemap never drifts from the
 * pages the site has. `lastmod` appears only where it is true — a junction page changes when the
 * dataset does, so it carries the dataset's OSM base date; the screens carry none rather than the
 * build's date, which would call every page changed on every deploy.
 */
export function buildSitemap(origin: string, datasetJson: string): string {
  const { junctions, osmBase } = junctionsFrom(datasetJson);
  const lastmod = osmBase ? `<lastmod>${osmBase}</lastmod>` : "";
  const rows = [
    ...STATIC_ROUTES.map((r) => `  <url><loc>${escapeXml(origin + r.path)}</loc><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`),
    ...junctions.map((j) => `  <url><loc>${escapeXml(`${origin}/intersection/${j.id}`)}</loc>${lastmod}<changefreq>monthly</changefreq><priority>0.5</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}
