import { describe, expect, it } from "vitest";

import { safeHttpUrl } from "@/lib/format";
import type { StatusInputs } from "@/lib/system/status";

import { parseMailbox } from "./mailbox";
import { buildMailto, collectDiagnostics, formatReport, MESSAGE_MIN, PREFILL_DETAIL_MAX, PREFILL_REFERENCE_MAX, prefillText, reportPage, SUPPORT_EMAIL, SUPPORT_TOPICS, toReport, validateDraft, type SupportDraft } from "./support";

const STATUS: StatusInputs = {
  nowMs: Date.UTC(2026, 8, 7, 9, 2, 7),
  dataset: { version: "v1", osmBase: "2026-09-05", intersections: 579, nodes: 1392 },
  basemap: { mode: "satellite", health: "ok" },
  build: "2026-09-07 16:32Z",
};

const DRAFT: SupportDraft = { topic: "junction", message: "Silk Board's northern arm is drawn 60 m south of the stop line.", contact: "", reference: "gw-0123456789ab", website: "", includeDiagnostics: true };

describe("support requests", () => {
  it("validates length limits and the honeypot", () => {
    expect(validateDraft(DRAFT)).toBeNull();
    expect(validateDraft({ ...DRAFT, message: "short" })).toContain(`${MESSAGE_MIN} characters`);
    expect(validateDraft({ ...DRAFT, message: "x".repeat(4001) })).toContain("under 4,000");
    expect(validateDraft({ ...DRAFT, website: "http://spam" })).toContain("hidden field");
    expect(validateDraft({ ...DRAFT, contact: "c".repeat(201) })).toContain("200 characters");
  });

  it("offers no reviewer-access topic: there is nothing to sign in to", () => {
    expect(SUPPORT_TOPICS.map((t) => t.id)).not.toContain("access");
    expect(SUPPORT_TOPICS.map((t) => t.label).join(" ")).not.toMatch(/journey|delete|account/i);
    for (const t of SUPPORT_TOPICS) expect(t).not.toHaveProperty("hint"); // the label is the whole explanation (declutter, 2026-09-08)
  });

  it("attaches only system diagnostics — never a location, a route, a gateway or a store", () => {
    const d = collectDiagnostics(STATUS, "/intersection/gw-0123456789ab", "UA/1.0", { w: 1440, h: 900 });
    expect(d).toEqual({
      build: "2026-09-07 16:32Z",
      page: "/intersection/gw-0123456789ab",
      dataset: "v1 · osm 2026-09-05 · 579 intersections",
      basemap: "satellite · ok",
      user_agent: "UA/1.0",
      viewport: "1440×900",
      at: "2026-09-07T09:02:07.000Z",
    });
    for (const k of Object.keys(d)) expect(["location", "journey", "sample", "lat", "lon", "store", "gateway", "route"].some((s) => k.includes(s))).toBe(false);
  });

  it("builds the report exactly as sent, dropping diagnostics when the user opts out", () => {
    const diag = collectDiagnostics(STATUS, "/x", "UA", { w: 1, h: 1 });
    const r = toReport({ ...DRAFT, contact: "  me@example.org " }, "/intersection/gw-0123456789ab", diag);
    expect(r).toMatchObject({ topic: "junction", contact: "me@example.org", reference: "gw-0123456789ab", page: "/intersection/gw-0123456789ab" });
    expect(r.diagnostics).toEqual(diag);
    expect(toReport({ ...DRAFT, includeDiagnostics: false }, "/x", diag).diagnostics).toEqual({});
    expect(toReport({ ...DRAFT, reference: "" }, "", diag)).toMatchObject({ reference: null, page: null });
  });

  it("outbound links from the datasets are drawn for http(s) targets only", () => {
    expect(safeHttpUrl("https://opencity.in/data/x.pdf")).toBe("https://opencity.in/data/x.pdf");
    expect(safeHttpUrl(" http://example.org/a ")).toBe("http://example.org/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("has a mailbox only when VITE_SUPPORT_EMAIL provides a well-formed one — no address lives in the source", () => {
    expect(parseMailbox(" help@example.org ")).toBe("help@example.org");
    expect(parseMailbox(undefined)).toBeNull();
    expect(parseMailbox("")).toBeNull();
    expect(parseMailbox("not an address")).toBeNull();
    expect(parseMailbox("a@b")).toBeNull();
    expect(parseMailbox(`${"x".repeat(250)}@example.org`)).toBeNull();
    expect(SUPPORT_EMAIL === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL)).toBe(true);
  });

  it("caps what a link may pre-fill and only accepts a same-site path as the reported page", () => {
    expect(prefillText(null, PREFILL_DETAIL_MAX)).toBe("");
    expect(prefillText("  TypeError: x is not a function ", PREFILL_DETAIL_MAX)).toBe("TypeError: x is not a function");
    expect(prefillText("a".repeat(1000), PREFILL_DETAIL_MAX)).toHaveLength(PREFILL_DETAIL_MAX);
    expect(prefillText("gw-0123456789ab\u0000\u001b[31m", PREFILL_REFERENCE_MAX)).toBe("gw-0123456789ab [31m");
    expect(prefillText("line one\nline two", PREFILL_DETAIL_MAX)).toBe("line one\nline two"); // line breaks survive
    expect(reportPage("/intersection/gw-0123456789ab", "/support")).toBe("/intersection/gw-0123456789ab");
    expect(reportPage("https://evil.example/phish", "/support?topic=bug")).toBe("/support?topic=bug");
    expect(reportPage("//evil.example", "/support")).toBe("/support");
    expect(reportPage("javascript:alert(1)", "/support")).toBe("/support");
    expect(reportPage("/with space", "/support")).toBe("/support");
    expect(reportPage(null, `/support?${"q".repeat(400)}`)).toHaveLength(300);
  });

  it("formats a plain-text report and a mailto link carrying it", () => {
    const r = toReport(DRAFT, "/intersection/gw-0123456789ab", collectDiagnostics(STATUS, "/x", "UA", { w: 1, h: 1 }));
    const text = formatReport(r);
    expect(text).toContain("Topic: A junction is missing, misplaced or misnamed");
    expect(text).toContain("Reference: gw-0123456789ab");
    expect(text).toContain("  basemap: satellite · ok");
    const href = buildMailto("help@example.org", r);
    expect(href.startsWith("mailto:help%40example.org?subject=")).toBe(true);
    expect(text.startsWith("theTraffic. — support request")).toBe(true);
    expect(decodeURIComponent(href)).toContain("theTraffic. support · A junction is missing, misplaced or misnamed · gw-0123456789ab");
  });
});
