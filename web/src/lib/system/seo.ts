/**
 * Search and share metadata for every screen (user request 2026-09-11: "enhance the SEO"; 2026-09-13:
 * "improve SEO").
 *
 * The metadata itself — titles, descriptions, canonical paths, breadcrumb trails — is the pure table in
 * `routeMeta.ts`, which the build also reads to write one HTML file per screen (`prerender.ts`), so a
 * crawler that runs no script downloads that screen's own head. Once a screen mounts, `usePageTitle`
 * calls `applyRouteMeta` so the browser tab and a script-running crawler see the same title,
 * description and canonical address. The DOM write is the one small function at the end.
 */
import { DEFAULT_SITE_URL, ROBOTS_INDEX, ROBOTS_NOINDEX, type RouteMeta } from "./routeMeta";

export { DEFAULT_SITE_URL, HOME_TITLE, routeMeta, SITE_DESCRIPTION, SITE_KEYWORDS, type Crumb, type RouteMeta } from "./routeMeta";

/** The public origin, from `VITE_SITE_URL` when it names an https origin (a further domain); otherwise the site's own. */
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

/** Write a route's metadata into the document head: title, description, canonical, robots, Open Graph and Twitter cards. */
export function applyRouteMeta(doc: MetaDocument, m: RouteMeta, origin: string = SITE_URL): void {
  const url = `${origin}${m.canonicalPath}`;
  doc.title = m.title;
  meta(doc, "name", "description", m.description);
  meta(doc, "name", "robots", m.index ? ROBOTS_INDEX : ROBOTS_NOINDEX);
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
