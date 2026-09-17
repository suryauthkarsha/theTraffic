/**
 * bun test functions/tests
 * The Worker's response rules: origins by name, JSON-only headers, constant-time secrets.
 */
import { describe, expect, test } from "bun:test";

import { bearerToken, corsHeaders, errorResponse, jpegResponse, jsonResponse, originAllowed, SECURITY_HEADERS, secretsEqual } from "../_lib/http";

describe("origins", () => {
  test("grants the site's own domain, the exact public Rork host, this project's preview and local dev servers — never a multi-tenant sibling, never public http", () => {
    expect(originAllowed("https://www.thetraffic.in", undefined)).toBe(true); // the public host (Vercel, since 2026-09-12)
    expect(originAllowed("https://thetraffic.in", undefined)).toBe(true); // the apex, which redirects to www
    expect(originAllowed("https://greenwave-bengaluru.rork.app", undefined)).toBe(true);
    expect(originAllowed("https://elsklqr8a0l8hi5jfkza7-web.rork.live", undefined)).toBe(true); // this project's editor preview, by name
    expect(originAllowed("https://preview.thetraffic.in", undefined)).toBe(false); // a further host of our own is granted through GRIEVANCE_ALLOWED_ORIGINS, exactly
    expect(originAllowed("https://another-project.rork.app", undefined)).toBe(false); // multi-tenant siblings are never granted by suffix
    expect(originAllowed("https://thetraffic-git-main-user.vercel.app", undefined)).toBe(false);
    expect(originAllowed("https://editor-preview.rork.live", undefined)).toBe(false);
    expect(originAllowed("http://localhost:8080", undefined)).toBe(true);
    expect(originAllowed("http://127.0.0.1:5173", undefined)).toBe(true);
    expect(originAllowed("http://greenwave-bengaluru.rork.app", undefined)).toBe(false); // plain http on the web
    expect(originAllowed("http://www.thetraffic.in", undefined)).toBe(false);
    expect(originAllowed("https://evil.example", undefined)).toBe(false);
    expect(originAllowed("https://rork.app.evil.example", undefined)).toBe(false); // a suffix is not a substring
    expect(originAllowed("https://thetraffic.in.evil.example", undefined)).toBe(false);
    expect(originAllowed("https://evilthetraffic.in", undefined)).toBe(false); // the dot matters
    expect(originAllowed("null", undefined)).toBe(false); // an opaque origin (sandboxed frame, file:)
    expect(originAllowed("*", undefined)).toBe(false);
    expect(originAllowed("garbage", undefined)).toBe(false);
  });

  test("a request without an Origin header is not a cross-site browser call and is served", () => {
    expect(originAllowed(null, undefined)).toBe(true);
  });

  test("GRIEVANCE_ALLOWED_ORIGINS grants exact https origins for a further domain and rejects wildcards or malformed entries", () => {
    const cfg = "https://example.in, *.example.in https://www.example.org/";
    expect(originAllowed("https://example.in", undefined)).toBe(false); // not built in…
    expect(originAllowed("https://example.in", cfg)).toBe(true); // …granted by the setting, exactly
    expect(originAllowed("https://www.example.in", cfg)).toBe(false); // a wildcard entry grants nothing
    expect(originAllowed("https://www.example.org", cfg)).toBe(true);
    expect(originAllowed("https://example.org", cfg)).toBe(false);
    expect(originAllowed("https://example.in.evil.example", cfg)).toBe(false);
    expect(originAllowed("http://example.in", cfg)).toBe(false);
  });

  test("the CORS grant names exactly one origin and varies on it", () => {
    const h = corsHeaders("https://thetraffic.rork.app");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://thetraffic.rork.app");
    expect(h.Vary).toBe("Origin");
    expect(h["Access-Control-Allow-Methods"]).not.toMatch(/PUT|PATCH/);
    expect(JSON.stringify(h)).not.toContain("*");
    expect(h).not.toHaveProperty("Access-Control-Allow-Credentials"); // there is nothing to send credentials for
  });
});

describe("responses", () => {
  test("every JSON answer is unsniffable, unframeable, uncached and referrer-free", async () => {
    const res = jsonResponse({ ok: true });
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
    const granted = jsonResponse({ ok: true }, { origin: "https://thetraffic.rork.app", cacheControl: "public, max-age=30" });
    expect(granted.headers.get("Access-Control-Allow-Origin")).toBe("https://thetraffic.rork.app");
    expect(granted.headers.get("Cache-Control")).toBe("public, max-age=30");
  });

  test("errors are one plain sentence with a status, and may carry Retry-After", async () => {
    const res = errorResponse("Too many grievances from here for now — try again later.", 429, null, { "Retry-After": "60" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: "Too many grievances from here for now — try again later." });
  });

  test("a photo is served as an inline JPEG, cacheable and embeddable, still unsniffable", () => {
    const res = jpegResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "https://thetraffic.rork.app", "thetraffic-grievance-1234abcd.jpg");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="thetraffic-grievance-1234abcd.jpg"');
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });
});

describe("moderator secrets", () => {
  test("reads a bearer token and compares in constant time", async () => {
    expect(bearerToken(new Request("https://x/", { headers: { Authorization: "Bearer abc.def" } }))).toBe("abc.def");
    expect(bearerToken(new Request("https://x/", { headers: { Authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("https://x/"))).toBeNull();
    expect(await secretsEqual("a long passphrase of twenty chars", "a long passphrase of twenty chars")).toBe(true);
    expect(await secretsEqual("a long passphrase of twenty chars", "a long passphrase of twenty charz")).toBe(false);
    expect(await secretsEqual("", "x")).toBe(false);
  });
});
