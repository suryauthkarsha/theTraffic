/**
 * Live signal-timing provider contract.
 *
 * Mappls (MapmyIndia) publicly states that its app shows live timers for "125+ smart signals across
 * Bengaluru" (press release, 25 Sep 2025, with Bengaluru Traffic Police and Arcadis). theTraffic.
 * treats this strictly as a partnership / data-access opportunity: we do not scrape the app, do
 * not call private APIs, and do not claim coverage. This module defines what an AUTHORISED feed
 * would have to deliver so the rest of the app (coverage categories, claims, popovers) is ready
 * the day an agreement and licence exist. Until then `configuredLiveProvider()` is null and the
 * app reports 0 intersections with live timing.
 */
export type LiveSignalLamp = "green" | "amber" | "red" | "flashing" | "off" | "unknown";

export interface LiveSignalState {
  /** Provider's own junction identifier. */
  junction_id: string;
  /** Master-map intersection the feed junction was linked to by a reviewer (null until linked). */
  intersection_id: string | null;
  /** Approach / direction the state refers to, in the provider's vocabulary (null when junction-wide). */
  approach: string | null;
  state: LiveSignalLamp;
  /** Seconds until the next change, when the feed publishes one. */
  countdown_s: number | null;
  /** Epoch ms when the provider observed the state. */
  observed_at: number;
  /** Epoch ms when the site received it. */
  received_at: number;
  /** Seconds between observation and receipt; samples older than FRESHNESS_MAX_S are not shown as current. */
  freshness_s: number;
  source: string;
  license: string;
}

export const FRESHNESS_MAX_S = 30;

export type LiveProviderStatus = "not_authorized" | "not_configured" | "configured" | "error";

export interface LiveTimingProvider {
  id: string;
  name: string;
  status: LiveProviderStatus;
  license: string | null;
  /** Master-map intersection ids the authorised feed covers (reviewer-linked). */
  coverage(): Promise<Set<string>>;
  /** Current states for the requested intersections. */
  snapshot(intersectionIds: string[]): Promise<LiveSignalState[]>;
}

/** Registry entry for the opportunity — descriptive only; it is not a provider. */
export const MAPPLS_OPPORTUNITY = {
  id: "mappls",
  name: "Mappls (MapmyIndia) — AI-powered Live Traffic Signal Timers",
  status: "not_authorized" as LiveProviderStatus,
  public_claim: "125+ smart signals across Bengaluru, live status up to 500 m in advance with green/amber/red countdowns (press release, New Delhi, 25 September 2025; in partnership with Bengaluru Traffic Police and Arcadis)",
  claim_url: "https://nsearchives.nseindia.com/corporate/MAPMYINDIA_25092025094753_Press_Release_25_Sept_2025.pdf",
  about_url: "https://about.mappls.com/app/",
  note: "No authorised feed, no licence — the site reports 0 intersections with live timing and never names Mappls as coverage. The adapter contract above (state, countdown, timestamp, junction id, approach, freshness, source, licence) is what an agreement would have to deliver.",
} as const;

/**
 * The configured live provider, or null. There is no authorised adapter today, so any value of
 * VITE_LIVE_TIMING_PROVIDER yields null (with a console warning) rather than a fake provider. The
 * key is read on its own — never through the whole env object, which would inline every VITE_ value.
 */
export function configuredLiveProvider(requested: string | undefined = import.meta.env.VITE_LIVE_TIMING_PROVIDER): LiveTimingProvider | null {
  const wanted = (requested ?? "").trim().toLowerCase();
  if (!wanted) return null;
  console.warn(`[thetraffic] VITE_LIVE_TIMING_PROVIDER="${wanted}" — no authorised live-timing adapter exists; not claiming live coverage.`);
  return null;
}

export const EMPTY_LIVE = { provider: null as LiveTimingProvider | null, coverage: new Set<string>(), states: new Map<string, LiveSignalState>() };

/** Freshness gate: only samples observed within FRESHNESS_MAX_S count as current. */
export function isFresh(s: LiveSignalState, now: number = Date.now()): boolean {
  return (now - s.observed_at) / 1000 <= FRESHNESS_MAX_S;
}
