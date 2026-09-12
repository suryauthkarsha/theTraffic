import { describe, expect, it } from "vitest";

import { chunkUrl, isChunkLoadError, MARK_KEY, readMark, recoverFromStaleBuild, RELOAD_WINDOW_MS, shouldReload, type RecoveryHost } from "./staleBuild";

const CHROME = new TypeError("Failed to fetch dynamically imported module: https://thetraffic.example/assets/SignalMapPage-BOwdvvID.js");
const FIREFOX = new TypeError("error loading dynamically imported module: https://thetraffic.example/assets/SupportPage-3_aADOAg.js");
const SAFARI = new TypeError("Importing a module script failed.");
const CSS = new Error("Unable to preload CSS for /assets/GrievancesPage-abc123.css");
const HTML_INSTEAD = new TypeError('Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".');

function fakeHost(opts: { stored?: string | null; storageThrows?: boolean; pathname?: string } = {}): { host: RecoveryHost; reloads: number; stored: () => string | null } {
  const state = { reloads: 0, stored: opts.stored ?? null };
  const host: RecoveryHost = {
    location: {
      pathname: opts.pathname ?? "/signals",
      reload: () => {
        state.reloads += 1;
      },
    },
    sessionStorage: {
      getItem: () => {
        if (opts.storageThrows) throw new Error("storage disabled");
        return state.stored;
      },
      setItem: (_k, v) => {
        if (opts.storageThrows) throw new Error("storage disabled");
        state.stored = v;
      },
    },
  };
  return {
    host,
    get reloads() {
      return state.reloads;
    },
    stored: () => state.stored,
  };
}

describe("recognising a stale tab", () => {
  it("knows every browser's wording for a chunk that could not be loaded, and nothing else", () => {
    for (const e of [CHROME, FIREFOX, SAFARI, CSS, HTML_INSTEAD]) expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false); // a plain network call, not a chunk
    expect(isChunkLoadError(new Error("Minified React error #31"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("reads the chunk's address out of the message when the browser gives one", () => {
    expect(chunkUrl(CHROME.message)).toBe("https://thetraffic.example/assets/SignalMapPage-BOwdvvID.js");
    expect(chunkUrl(CSS.message)).toBe("/assets/GrievancesPage-abc123.css");
    expect(chunkUrl(SAFARI.message)).toBeNull();
  });
});

describe("reloading once", () => {
  it("reloads for the first failure of a chunk and marks the tab", () => {
    const f = fakeHost();
    expect(recoverFromStaleBuild(CHROME, f.host, 1_000)).toBe(true);
    expect(f.reloads).toBe(1);
    expect(readMark(f.stored())).toEqual({ url: "https://thetraffic.example/assets/SignalMapPage-BOwdvvID.js", at: 1_000 });
  });

  it("does not reload a second time for the same chunk inside the window — an outage falls through to the panel", () => {
    const first = fakeHost();
    recoverFromStaleBuild(CHROME, first.host, 1_000);
    const again = fakeHost({ stored: first.stored() });
    expect(recoverFromStaleBuild(CHROME, again.host, 1_000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(again.reloads).toBe(0);
    // …but a different chunk, or the same one much later, is a new stale tab
    expect(recoverFromStaleBuild(FIREFOX, again.host, 2_000)).toBe(true);
    const later = fakeHost({ stored: first.stored() });
    expect(recoverFromStaleBuild(CHROME, later.host, 1_000 + RELOAD_WINDOW_MS)).toBe(true);
  });

  it("keys an unnamed chunk (Safari) on the page path", () => {
    const f = fakeHost({ pathname: "/grievances" });
    expect(recoverFromStaleBuild(SAFARI, f.host, 5)).toBe(true);
    expect(readMark(f.stored())?.url).toBe("/grievances");
  });

  it("leaves every other error alone and never reloads without a guard", () => {
    const f = fakeHost();
    expect(recoverFromStaleBuild(new TypeError("Failed to fetch"), f.host, 1)).toBe(false);
    expect(recoverFromStaleBuild(undefined, f.host, 1)).toBe(false);
    const noStorage = fakeHost({ storageThrows: true });
    expect(recoverFromStaleBuild(CHROME, noStorage.host, 1)).toBe(false); // storage refused: the panel's Reload button remains
    expect(noStorage.reloads).toBe(0);
    expect(f.reloads).toBe(0);
  });

  it("treats a damaged or foreign mark as none", () => {
    expect(readMark(null)).toBeNull();
    expect(readMark("not json")).toBeNull();
    expect(readMark(JSON.stringify({ url: 5, at: "x" }))).toBeNull();
    expect(readMark(JSON.stringify(null))).toBeNull();
    expect(shouldReload("/a", 10, null)).toBe(true);
    expect(shouldReload("/a", 10, { url: "/a", at: 5 })).toBe(false);
    expect(shouldReload("/b", 10, { url: "/a", at: 5 })).toBe(true);
    expect(MARK_KEY).toBe("gw.reload"); // sessionStorage: this tab only, gone when it closes
  });
});
