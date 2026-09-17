/**
 * Search metadata for every screen — pure: no DOM, no environment, no alias imports. Shared by the app
 * (`seo.ts` writes a screen's metadata into <head> the moment it mounts) and by the build
 * (`prerender.ts` turns the same table into one HTML file per screen and the sitemap; `vite.config.ts`
 * imports both, so only relative imports of other pure modules belong here).
 *
 * A title is the screen's name, what it is with the city in it, then the wordmark — "Signal Map ·
 * Bengaluru traffic signals & timing · theTraffic." — 70 characters at most where the route allows (a
 * junction's name may run longer). The tab shows the same title the crawler downloads, so the HTML at
 * an address and the page it renders agree (user request 2026-09-13: "improve SEO"). Descriptions say
 * what the screen holds in exact nouns, 160 characters or so.
 */
import { BRAND_CITY, BRAND_NAME } from "./brand";

/** The site's own domain (Vercel, since 2026-09-12; the apex redirects to `www`). Every copy of the site — the Rork host, a preview — points its canonical links here. */
export const DEFAULT_SITE_URL = "https://www.thetraffic.in";

export const SITE_DESCRIPTION = "Bengaluru's mapped traffic signals and published timing records, a dated OpenStreetMap surveillance snapshot, and an account-free public board of road problems.";

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
  "ISI helmet campaign Bengaluru",
  "bike taxi pillion helmet",
  "OpenStreetMap Bengaluru",
];

/** The robots directive for a screen search engines may list, and for one they may not. */
export const ROBOTS_INDEX = "index, follow, max-image-preview:large";
export const ROBOTS_NOINDEX = "noindex, follow";

/** One step of a breadcrumb trail: the screen's name and its canonical path. */
export interface Crumb {
  name: string;
  path: string;
}

export interface RouteMeta {
  /** The document title: the screen's name, what it is with the city, the wordmark. */
  title: string;
  description: string;
  /** Path the canonical link points at (query strings and hashes never count as pages). */
  canonicalPath: string;
  /** False for screens search engines should not list (404, a junction that is not on file). */
  index: boolean;
  /** The trail from the home page down to this screen, the screen itself last. */
  trail: Crumb[];
}

const brand = (subject: string): string => `${subject} · ${BRAND_NAME}`;

export const HOME_TITLE = `${BRAND_NAME} · ${BRAND_CITY} traffic signals, junction by junction`;

const HOME: Crumb = { name: BRAND_NAME, path: "/" };
const CONSOLE: Crumb = { name: "Console", path: "/console" };
const SIGNALS: Crumb = { name: "Signal Map", path: "/signals" };
const GRIEVANCES: Crumb = { name: "Grievances", path: "/grievances" };

interface RouteDef {
  match: (path: string) => boolean;
  canonical: (path: string) => string;
  /** The screen's name in a breadcrumb trail; `t` is the screen's own title (a junction's name). */
  name: (t: string | null) => string;
  title: (t: string | null) => string;
  description: (t: string | null) => string;
  /** The screens between the home page and this one. */
  parents: Crumb[];
  index: (t: string | null) => boolean;
}

const always = (): boolean => true;

const ROUTES: RouteDef[] = [
  { match: (p) => p === "/", canonical: () => "/", name: () => BRAND_NAME, title: () => HOME_TITLE, description: () => SITE_DESCRIPTION, parents: [], index: always },
  {
    match: (p) => p === "/console",
    canonical: () => "/console",
    name: () => "Console",
    title: () => brand(`Console · ${BRAND_CITY}'s roads, junction by junction`),
    description: () => `The console: the Signal Map of ${BRAND_CITY}, the Surveillance camera map, the research behind the timing data, the methodology, and the grievance board.`,
    parents: [],
    index: always,
  },
  {
    match: (p) => p === "/signals",
    canonical: () => "/signals",
    name: () => "Signal Map",
    title: () => brand(`Signal Map · ${BRAND_CITY} traffic signals & timing`),
    description: () => `Mapped traffic signals in the shipped ${BRAND_CITY} dataset, grouped into junctions and coloured by what is known about their timing records.`,
    parents: [],
    index: always,
  },
  {
    match: (p) => p.startsWith("/intersection/"),
    canonical: (p) => p,
    name: (t) => t ?? "Junction not found",
    title: (t) => (t === null ? brand("Junction not found") : brand(`${t} · signal timing, ${BRAND_CITY}`)),
    description: (t) => (t === null ? `No junction on file has this id. Every junction in the ${BRAND_CITY} dataset is on the Signal Map.` : `${t} in ${BRAND_CITY}: the traffic signal timing plan on record, the approaches, and the expected wait and stop probability by day and time.`),
    parents: [SIGNALS],
    index: (t) => t !== null,
  },
  {
    match: (p) => p === "/surveillance",
    canonical: () => "/surveillance",
    name: () => "Surveillance",
    title: () => brand(`Surveillance · CCTV cameras mapped in ${BRAND_CITY}`),
    description: () => `Every surveillance camera mapped in OpenStreetMap inside ${BRAND_CITY} — type, zone, operator and viewing direction as recorded — with clusters and a density view.`,
    parents: [],
    index: always,
  },
  {
    match: (p) => p === "/research",
    canonical: () => "/research",
    name: () => "Research",
    title: () => brand(`Research · ${BRAND_CITY} signal timing coverage`),
    description: () => `The figures behind the map: how many ${BRAND_CITY} junctions carry an accepted timing-plan link, where the plans come from, and what feeds each prediction.`,
    parents: [],
    index: always,
  },
  {
    match: (p) => p === "/methodology",
    canonical: () => "/methodology",
    name: () => "Methodology",
    title: () => brand(`Methodology · how we read ${BRAND_CITY}'s signals`),
    description: () => `How we build ${BRAND_CITY}'s junctions from OpenStreetMap signals, parse Traffic Police timing plans, accept them by explicit review, and turn a plan into a prediction.`,
    parents: [],
    index: always,
  },
  {
    match: (p) => p === "/support",
    canonical: () => "/support",
    name: () => "Support",
    title: () => brand("Support · FAQ, system status, report a problem"),
    description: () => `FAQ, live system status, and a way to report a problem with the ${BRAND_CITY} map or a record — plus the grievance board for the road itself.`,
    parents: [CONSOLE],
    index: always,
  },
  {
    match: (p) => p === "/grievances",
    canonical: () => "/grievances",
    name: () => "Grievances",
    title: () => brand(`Grievances · ${BRAND_CITY} road problems, public board`),
    description: () => `An account-free public board of ${BRAND_CITY} road problems — potholes, footpaths, water logging, crossings, signals and lights — with photos and places, newest first.`,
    parents: [CONSOLE],
    index: always,
  },
  {
    match: (p) => p === "/grievance",
    canonical: () => "/grievance",
    name: () => "File a grievance",
    title: () => brand(`File a grievance · ${BRAND_CITY} road problems, no account`),
    description: () => `Post a photo of a ${BRAND_CITY} road problem, with the place, and no account. Words, visible pixels, coordinates and filing time may identify someone.`,
    parents: [CONSOLE, GRIEVANCES],
    index: always,
  },
  {
    match: (p) => p === "/helmet",
    canonical: () => "/helmet",
    name: () => "Helmet campaign",
    title: () => brand(`Helmet campaign · ISI helmets for ${BRAND_CITY} pillions`),
    description: () => `ISI-certified helmets for every bike-taxi passenger in ${BRAND_CITY}: bought in bulk, handed to Uber Moto and Rapido drivers as the pillion's helmet. Give by UPI.`,
    parents: [CONSOLE],
    index: always,
  },
];

/** The metadata for a pathname (query and hash stripped) and the screen's own title, when it has one. Pure. */
export function routeMeta(pathname: string, title: string | null): RouteMeta {
  const path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  const route = ROUTES.find((r) => r.match(path));
  if (!route) return { title: brand(title ?? "Not found"), description: SITE_DESCRIPTION, canonicalPath: path, index: false, trail: [HOME] };
  const canonicalPath = route.canonical(path);
  const self: Crumb = { name: route.name(title), path: canonicalPath };
  return {
    title: route.title(title),
    description: route.description(title),
    canonicalPath,
    index: route.index(title),
    trail: canonicalPath === "/" ? [HOME] : [HOME, ...route.parents, self],
  };
}

/** The screens a search engine should list, with how often each changes. Junction pages are added from the dataset (`prerender.ts`). */
export const STATIC_ROUTES: readonly { path: string; changefreq: "daily" | "weekly" | "monthly"; priority: string }[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/signals", changefreq: "weekly", priority: "0.9" },
  { path: "/grievances", changefreq: "daily", priority: "0.9" },
  { path: "/grievance", changefreq: "monthly", priority: "0.7" },
  { path: "/helmet", changefreq: "monthly", priority: "0.8" },
  { path: "/surveillance", changefreq: "weekly", priority: "0.8" },
  { path: "/research", changefreq: "weekly", priority: "0.6" },
  { path: "/methodology", changefreq: "monthly", priority: "0.5" },
  { path: "/support", changefreq: "monthly", priority: "0.4" },
  { path: "/console", changefreq: "monthly", priority: "0.4" },
];
