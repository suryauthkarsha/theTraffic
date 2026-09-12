import { BRAND_CITY, BRAND_NAME } from "@/lib/system/brand";

/**
 * Search and share metadata for every screen (user request 2026-09-11: "enhance the SEO").
 *
 * The built `index.html` carries the site-wide defaults (title, description, keywords, Open Graph and
 * Twitter cards, JSON-LD) for crawlers that do not run scripts. Once a screen mounts, `usePageTitle`
 * calls `applyRouteMeta` so a script-running crawler — and the browser tab — sees that screen's own
 * title, description and canonical address. Every function here is pure and tested; the DOM write is
 * the one small function at the end.
 */
export const DEFAULT_SITE_URL = "https://greenwave-bengaluru.rork.app";

/** The public origin, from `VITE_SITE_URL` when it names an https origin; otherwise the project default. */
export function siteUrl(configured: string | undefined = import.meta.env.VITE_SITE_URL): string {
  const v = configured?.trim();
  if (!v) return DEFAULT_SITE_URL;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.origin : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const SITE_URL = siteUrl();

/** Both spellings of the city, every road problem the board takes, the signal and camera vocabulary — the words people search. */
export const SITE_KEYWORDS: readonly string[] = [
  "Bengaluru traffic signals",
  "Bangalore traffic signals",
  "Bengaluru traffic lights",
  "Bangalore traffic lights",
  "traffic signal timing Bengaluru",
  "signal timing plan",
  "Bengaluru junctions",
  "Bangalore junction map",
  "Silk Board signal",
  "Bengaluru Traffic Police signal timing",
  "CCTV cameras Bengaluru",
  "surveillance cameras Bangalore map",
  "Bengaluru road problems",
  "potholes Bengaluru",
  "potholes Bangalore",
  "footpath Bengaluru",
  "water logging Bengaluru",
  "pedestrian crossing Bengaluru",
  "street light complaint Bengaluru",
  "road grievance Bengaluru",
  "civic issues Bangalore",
  "account-free grievance board",
  "OpenStreetMap Bengaluru",
];

export const SITE_DESCRIPTION = "Bengaluru's mapped traffic signals and published timing records, a dated OpenStreetMap surveillance snapshot, and an account-free public board of road problems.";

export interface RouteMeta {
  /** The full document title, 50–60 characters where the route allows. */
  title: string;
  description: string;
  /** Path the canonical link points at (query strings and hashes never count as pages). */
  canonicalPath: string;
  /** False for screens search engines should not list (404). */
  index: boolean;
}

const HOME_TITLE = `${BRAND_NAME} · ${BRAND_CITY} traffic signals, junction by junction`;

/** Per-route descriptions; `{title}` is the screen's own title (a junction's name). */
const ROUTES: { match: (p: string) => boolean; canonical: (p: string) => string; title: (t: string | null) => string; description: (t: string | null) => string; index?: boolean }[] = [
  { match: (p) => p === "/", canonical: () => "/", title: () => HOME_TITLE, description: () => SITE_DESCRIPTION },
  { match: (p) => p === "/console", canonical: () => "/console", title: () => `Console · ${BRAND_NAME} — Bengaluru's roads, junction by junction`, description: () => `The console: the Signal Map of Bengaluru, the Surveillance camera map, the research behind the timing data, the methodology, and the grievance board.` },
  { match: (p) => p === "/signals", canonical: () => "/signals", title: () => `Signal Map · Bengaluru traffic signals & junction timing`, description: () => `Mapped traffic signals in the shipped Bengaluru dataset, grouped into junctions and coloured by what is known about their timing records.` },
  { match: (p) => p.startsWith("/intersection/"), canonical: (p) => p, title: (t) => `${t ?? "Junction"} · traffic signal timing, Bengaluru — ${BRAND_NAME}`, description: (t) => `${t ?? "This junction"} in Bengaluru: the traffic signal timing plan on record, the approaches, and the expected wait and stop probability by day and time.` },
  { match: (p) => p === "/surveillance", canonical: () => "/surveillance", title: () => `Surveillance cameras in Bengaluru · every CCTV mapped in OpenStreetMap`, description: () => `A map of every surveillance camera mapped in OpenStreetMap inside Bengaluru — type, zone, operator and viewing direction as recorded, with clusters and a density view.` },
  { match: (p) => p === "/research", canonical: () => "/research", title: () => `Research · how much signal timing data Bengaluru has — ${BRAND_NAME}`, description: () => `The figures behind the map: how many Bengaluru junctions carry an accepted timing-plan link, where the plans come from, and what feeds each prediction.` },
  { match: (p) => p === "/methodology", canonical: () => "/methodology", title: () => `Methodology · how ${BRAND_NAME} reads Bengaluru's signals`, description: () => `How junctions are built from OpenStreetMap signals, how Bengaluru Traffic Police timing plans are parsed and linked by explicit review decisions, and how a plan becomes an expected wait and a stop probability.` },
  { match: (p) => p === "/support", canonical: () => "/support", title: () => `Support · ${BRAND_NAME} — FAQ, status, report a problem`, description: () => `Questions about ${BRAND_NAME} answered, live system status, and a way to report a problem with the Bengaluru map or a record — plus the grievance board for the road itself.` },
  { match: (p) => p === "/grievances", canonical: () => "/grievances", title: () => `Bengaluru road grievances · potholes, footpaths, water, crossings`, description: () => `An account-free public board of Bengaluru road problems, with user-submitted words, photos and precise places shown newest first.` },
  { match: (p) => p === "/grievance", canonical: () => "/grievance", title: () => `File a Bengaluru road grievance without an account · ${BRAND_NAME}`, description: () => `Post a Bengaluru road problem with a photo or place and no account. Words, visible pixels, coordinates and filing time may identify someone.` },
];

/** The metadata for a pathname (query and hash stripped) and the screen's own title, when it has one. Pure. */
export function routeMeta(pathname: string, title: string | null): RouteMeta {
  const path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  const route = ROUTES.find((r) => r.match(path));
  if (!route) return { title: `${title ?? "Not found"} · ${BRAND_NAME}`, description: SITE_DESCRIPTION, canonicalPath: path, index: false };
  return { title: route.title(title), description: route.description(title), canonicalPath: route.canonical(path), index: route.index ?? true };
}

/** The DOM the metadata is written into — the subset of Document the tests fake. */
export interface MetaDocument {
  title: string;
  head: { appendChild(node: Node): unknown; querySelector(selectors: string): Element | null };
  createElement(tagName: string): HTMLElement;
}

function setTag(doc: MetaDocument, selector: string, create: () => HTMLElement, attr: string, value: string): void {
  let el = doc.head.querySelector(selector);
  if (!el) {
    el = create();
    doc.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const meta = (doc: MetaDocument, keyAttr: "name" | "property", key: string, content: string): void =>
  setTag(
    doc,
    `meta[${keyAttr}="${key}"]`,
    () => {
      const el = doc.createElement("meta");
      el.setAttribute(keyAttr, key);
      return el;
    },
    "content",
    content,
  );

/** Write a route's metadata into the document head: description, canonical, robots, Open Graph and Twitter cards. */
export function applyRouteMeta(doc: MetaDocument, m: RouteMeta, origin: string = SITE_URL): void {
  const url = `${origin}${m.canonicalPath}`;
  meta(doc, "name", "description", m.description);
  meta(doc, "name", "robots", m.index ? "index, follow, max-image-preview:large" : "noindex, follow");
  setTag(
    doc,
    'link[rel="canonical"]',
    () => {
      const el = doc.createElement("link");
      el.setAttribute("rel", "canonical");
      return el;
    },
    "href",
    url,
  );
  meta(doc, "property", "og:title", m.title);
  meta(doc, "property", "og:description", m.description);
  meta(doc, "property", "og:url", url);
  meta(doc, "name", "twitter:title", m.title);
  meta(doc, "name", "twitter:description", m.description);
}
