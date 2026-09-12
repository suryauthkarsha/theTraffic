// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { analyticsDecision, analyticsState, GTAG_SRC, installAnalytics, pageLocation, pageView } from "./analytics";

type Win = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
const win = window as Win;

// An empty id is "off" whatever web/.env holds; `undefined` would fall back to the build's configured
// VITE_GA_MEASUREMENT_ID and make these tests depend on the deployment.
function reset(): void {
  delete win.dataLayer;
  delete win.gtag;
  document.querySelectorAll("script").forEach((s) => s.remove());
  window.history.replaceState(null, "", "/");
  installAnalytics("");
}

afterEach(() => {
  reset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Google Analytics (user request 2026-09-09)", () => {
  it("runs only with a well-formed GA4 id and no Global Privacy Control signal", () => {
    expect(analyticsDecision(undefined, false)).toEqual({ state: "off", id: null });
    expect(analyticsDecision("   ", false)).toEqual({ state: "off", id: null });
    expect(analyticsDecision("UA-1234567-1", false)).toEqual({ state: "invalid_id", id: null }); // Universal Analytics ids are dead
    expect(analyticsDecision("G-ABC", false)).toEqual({ state: "invalid_id", id: null });
    expect(analyticsDecision(" g-abc123xyz9 ", false)).toEqual({ state: "on", id: "G-ABC123XYZ9" }); // trimmed, upper-cased
    expect(analyticsDecision("G-ABC123XYZ9", true)).toEqual({ state: "gpc", id: null });
  });

  it("without an id: no script, no dataLayer, no page views — the site stays exactly as before", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    expect(installAnalytics()).toBe("off"); // main.tsx passes nothing: the default is the build's id
    expect(document.querySelector("script")).toBeNull();
    expect(win.dataLayer).toBeUndefined();
    expect(pageView()).toBe(false);
  });

  it("reads VITE_GA_MEASUREMENT_ID by default, so a configured build measures without any code change", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", " g-env12345678 ");
    expect(installAnalytics()).toBe("on");
    expect(document.querySelector<HTMLScriptElement>("script")?.src).toBe(`${GTAG_SRC}?id=G-ENV12345678`);
  });

  it("a malformed id is refused with one console warning and nothing loads", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(installAnalytics("not-an-id")).toBe("invalid_id");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("not-an-id");
    expect(document.querySelector("script")).toBeNull();
    expect(pageView()).toBe(false);
  });

  it("installs the tag as a script element (no inline snippet), queues js + config with the automatic page view off", () => {
    expect(installAnalytics("G-TEST123456")).toBe("on");
    expect(analyticsState()).toBe("on");
    const script = document.querySelector<HTMLScriptElement>("script");
    expect(script?.src).toBe(`${GTAG_SRC}?id=G-TEST123456`);
    expect(script?.async).toBe(true);
    expect(document.querySelectorAll("script")).toHaveLength(1);

    const queue = win.dataLayer ?? [];
    expect(queue).toHaveLength(2);
    // gtag.js only recognises `arguments` objects — an array pushed by an arrow function would be silently dropped.
    expect(Object.prototype.toString.call(queue[0])).toBe("[object Arguments]");
    expect(Array.from(queue[0] as IArguments)[0]).toBe("js");
    expect(Array.from(queue[0] as IArguments)[1]).toBeInstanceOf(Date);
    expect(Array.from(queue[1] as IArguments)).toEqual(["config", "G-TEST123456", { send_page_view: false }]);
  });

  it("sends one page view per path with the title and a query-less address; a second title on the same page is not a second visit", () => {
    installAnalytics("G-TEST123456");
    const queue = win.dataLayer ?? [];
    window.history.replaceState(null, "", "/surveillance?zone=east&type=camera");
    document.title = "Surveillance · theTraffic.";

    expect(pageView()).toBe(true);
    expect(queue).toHaveLength(3);
    expect(Array.from(queue[2] as IArguments)).toEqual(["event", "page_view", { page_title: "Surveillance · theTraffic.", page_location: "http://localhost:3000/surveillance" }]);

    document.title = "Surveillance · theTraffic. (filtered)";
    expect(pageView()).toBe(false); // same path: nothing new
    expect(queue).toHaveLength(3);

    window.history.pushState(null, "", "/intersection/gw-0123456789ab");
    document.title = "Silk Board Junction · theTraffic.";
    expect(pageView()).toBe(true);
    expect(Array.from(queue[3] as IArguments)[2]).toEqual({ page_title: "Silk Board Junction · theTraffic.", page_location: "http://localhost:3000/intersection/gw-0123456789ab" });

    window.history.pushState(null, "", "/surveillance");
    expect(pageView()).toBe(true); // coming back is a visit again
    expect(queue).toHaveLength(5);
  });

  it("respects Global Privacy Control: nothing loads, nothing is sent", () => {
    const fake = {
      navigator: { globalPrivacyControl: true },
      document,
      location: window.location,
    } as unknown as Parameters<typeof installAnalytics>[1];
    expect(installAnalytics("G-TEST123456", fake)).toBe("gpc");
    expect(document.querySelector("script")).toBeNull();
    expect(pageView()).toBe(false);
  });

  it("never reports the query string", () => {
    expect(pageLocation({ origin: "https://thetraffic.example", pathname: "/support" })).toBe("https://thetraffic.example/support");
  });
});
