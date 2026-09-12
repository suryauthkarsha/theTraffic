/**
 * Google Analytics 4 (user request 2026-09-09) — the one thing the site measures: its own audience.
 *
 * The Google tag loads only when a measurement id is configured at build time
 * (`VITE_GA_MEASUREMENT_ID`) and the visitor's browser does not send Global Privacy Control. Without
 * an id nothing is loaded and nothing is sent — and `vite.config.ts` adds the Google hosts to the
 * Content Security Policy only when the id is present, so the policy never names a host the build
 * does not use. There is no inline snippet: this module inserts the tag as a script element, so the
 * policy needs neither a nonce nor a hash.
 *
 * Page views are sent by `usePageTitle` once a screen has set its title — one per path, with the
 * automatic page view switched off (`send_page_view: false`) so the two can never double count. The
 * address sent is the page's path without its query string: filters, support topics and references
 * stay out of Google's logs. Nothing a visitor types is ever sent.
 *
 * Honesty: docs/PRIVACY.md and Support FAQ 4 say all of this in plain words.
 */

/** GA4 measurement ids: `G-` followed by upper-case letters and digits. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{6,14}$/;

/** The Google tag loader; the id is appended as `?id=`. */
export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

/** Why analytics is or is not running. */
export type AnalyticsState = "off" | "invalid_id" | "gpc" | "on";

type GtagFn = (...args: unknown[]) => void;

/** The globals the Google tag reads. `globalPrivacyControl` is not in the DOM typings yet. */
interface AnalyticsWindow {
  dataLayer?: unknown[];
  gtag?: GtagFn;
  navigator: { globalPrivacyControl?: boolean };
  document: { title: string; head: HTMLHeadElement; createElement(tagName: "script"): HTMLScriptElement };
  location: { origin: string; pathname: string };
}

/** Pure: normalises the id and decides. */
export function analyticsDecision(id: string | undefined, gpc: boolean): { state: AnalyticsState; id: string | null } {
  const wanted = id?.trim().toUpperCase() ?? "";
  if (!wanted) return { state: "off", id: null };
  if (!MEASUREMENT_ID.test(wanted)) return { state: "invalid_id", id: null };
  if (gpc) return { state: "gpc", id: null };
  return { state: "on", id: wanted };
}

let state: AnalyticsState = "off";
let lastPath: string | null = null;
let host: AnalyticsWindow | null = null;

/**
 * Installs the Google tag when configured; call once before the first render. Returns the state so
 * the caller (and tests) can tell why nothing happened.
 */
export function installAnalytics(id: string | undefined = import.meta.env.VITE_GA_MEASUREMENT_ID, win: AnalyticsWindow = window as unknown as AnalyticsWindow): AnalyticsState {
  const decision = analyticsDecision(id, win.navigator.globalPrivacyControl === true);
  state = decision.state;
  lastPath = null;
  host = null;
  if (state === "invalid_id") console.warn(`[thetraffic] the analytics measurement id "${id?.trim()}" is not a GA4 id (G-XXXXXXXXXX); analytics stays off.`);
  if (state !== "on" || decision.id === null) return state;

  host = win;
  win.dataLayer = win.dataLayer ?? [];
  const queue = win.dataLayer;
  // gtag.js consumes `arguments` objects from the dataLayer — a plain array (what rest parameters
  // would give) is silently ignored — so this is a classic function, as in Google's own snippet.
  win.gtag =
    win.gtag ??
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      queue.push(arguments);
    };
  win.gtag("js", new Date());
  win.gtag("config", decision.id, { send_page_view: false });

  const script = win.document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(decision.id)}`;
  win.document.head.appendChild(script);
  return state;
}

/** The address reported for a page: this origin and the path, never the query string. */
export function pageLocation(loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}`;
}

/**
 * One page view for the screen now showing — a no-op unless analytics is on, and at most one per
 * path in a row (a title that changes on the same page is not a second visit).
 */
export function pageView(): boolean {
  if (state !== "on" || host === null || host.gtag === undefined) return false;
  const path = host.location.pathname;
  if (path === lastPath) return false;
  lastPath = path;
  host.gtag("event", "page_view", { page_title: host.document.title, page_location: pageLocation(host.location) });
  return true;
}

/** Current state, for the tests. */
export function analyticsState(): AnalyticsState {
  return state;
}
