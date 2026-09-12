import { parseMailbox } from "@/lib/support/mailbox";
import { BRAND_NAME } from "@/lib/system/brand";
import type { StatusInputs } from "@/lib/system/status";
import { basemapItem } from "@/lib/system/status";

/**
 * Support requests. Filed from /support (and from "Report a problem" links on junction pages). There
 * is no inbox on a server: the report opens in the visitor's e-mail app addressed to the support
 * mailbox, or is copied to the clipboard — the page prints the address it goes to.
 *
 * Diagnostics attached to a request are build/dataset/basemap states only — never a location or
 * anything typed into a search field.
 */
export type SupportTopic = "bug" | "data" | "junction" | "camera" | "privacy" | "other";

/** Topic labels are the whole explanation — the form carries no hint line under the select. */
export const SUPPORT_TOPICS: { id: SupportTopic; label: string }[] = [
  { id: "bug", label: "Something is broken" },
  { id: "data", label: "A number or colour looks wrong" },
  { id: "junction", label: "A junction is missing, misplaced or misnamed" },
  { id: "camera", label: "A camera record is missing or wrong" },
  { id: "privacy", label: "Privacy" },
  { id: "other", label: "Something else" },
];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;

/**
 * The mailbox reports are addressed to — `VITE_SUPPORT_EMAIL`, read by key (never via the whole env
 * object). Null when the build has none: the page then offers the clipboard alone and says so.
 */
export const SUPPORT_EMAIL: string | null = parseMailbox(import.meta.env.VITE_SUPPORT_EMAIL);

/** How much a link may pre-fill: enough for an error message or a junction id, never a flood. */
export const PREFILL_DETAIL_MAX = 300;
export const PREFILL_REFERENCE_MAX = 120;
export const PAGE_MAX = 300;

/**
 * Text taken from a query parameter, for pre-filling a field: trimmed, capped, control characters
 * (other than line breaks) dropped. Links from the error panel and junction pages pre-fill the form;
 * so could a crafted link, and it must not be able to plant more than a visitor can read at a glance.
 */
export function prefillText(value: string | null, max: number): string {
  if (!value) return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

/**
 * The page a report refers to: `?from=` when it is a same-site path (one leading slash, no scheme,
 * no protocol-relative `//`, no whitespace), else the page the visitor is on. The value only ever
 * becomes a line of report text — it is never navigated to — but it still has to look like ours.
 */
export function reportPage(from: string | null, current: string): string {
  const v = from?.trim() ?? "";
  return /^\/(?!\/)\S*$/.test(v) ? v.slice(0, PAGE_MAX) : current.slice(0, PAGE_MAX);
}

export interface SupportDiagnostics {
  build: string;
  page: string;
  dataset: string;
  basemap: string;
  user_agent: string;
  viewport: string;
  at: string;
}

export interface SupportDraft {
  topic: SupportTopic;
  message: string;
  contact: string;
  reference: string;
  /** Honeypot: must stay empty. */
  website: string;
  includeDiagnostics: boolean;
}

/** The report as sent, whichever channel carries it. */
export interface SupportReport {
  topic: SupportTopic;
  message: string;
  contact: string | null;
  page: string | null;
  reference: string | null;
  diagnostics: Partial<SupportDiagnostics>;
}

export type SupportChannel = "mailto" | "clipboard";

export interface SupportOutcome {
  ok: boolean;
  channel: SupportChannel;
  message: string;
}

/** Diagnostics from the same status model the rail shows. Pure. */
export function collectDiagnostics(s: StatusInputs, page: string, userAgent: string, viewport: { w: number; h: number }): SupportDiagnostics {
  const basemap = basemapItem(s.basemap.mode, s.basemap.health);
  return {
    build: s.build,
    page,
    dataset: s.dataset ? `${s.dataset.version} · osm ${s.dataset.osmBase ?? "—"} · ${s.dataset.intersections ?? "—"} intersections` : "loading",
    basemap: basemap.value,
    user_agent: userAgent,
    viewport: `${viewport.w}×${viewport.h}`,
    at: new Date(s.nowMs).toISOString(),
  };
}

/** Validation sentence, or null when the draft can be sent. Pure. */
export function validateDraft(d: SupportDraft): string | null {
  if (d.website.trim()) return "Please leave the hidden field empty.";
  const msg = d.message.trim();
  if (msg.length < MESSAGE_MIN) return `Describe the problem in at least ${MESSAGE_MIN} characters.`;
  if (msg.length > MESSAGE_MAX) return `Keep the description under ${MESSAGE_MAX.toLocaleString("en-IN")} characters (${msg.length.toLocaleString("en-IN")} now).`;
  if (d.contact.trim().length > 200) return "The contact field is limited to 200 characters.";
  if (d.reference.trim().length > 120) return "The reference is limited to 120 characters.";
  return null;
}

/** The report exactly as sent. Pure. */
export function toReport(d: SupportDraft, page: string, diagnostics: SupportDiagnostics | null): SupportReport {
  return {
    topic: d.topic,
    message: d.message.trim(),
    contact: d.contact.trim() || null,
    page: page.slice(0, 300) || null,
    reference: d.reference.trim() || null,
    diagnostics: d.includeDiagnostics && diagnostics ? diagnostics : {},
  };
}

/** Plain-text report for the e-mail and clipboard channels. Pure. */
export function formatReport(r: SupportReport): string {
  const topic = SUPPORT_TOPICS.find((t) => t.id === r.topic)?.label ?? r.topic;
  const lines = [`${BRAND_NAME} — support request`, `Topic: ${topic}`, r.reference ? `Reference: ${r.reference}` : null, r.page ? `Page: ${r.page}` : null, r.contact ? `Contact: ${r.contact}` : null, "", r.message, ""];
  const diag = Object.entries(r.diagnostics).filter(([, v]) => v !== undefined && v !== "");
  if (diag.length) {
    lines.push("Diagnostics:");
    for (const [k, v] of diag) lines.push(`  ${k}: ${String(v)}`);
  }
  return lines.filter((l): l is string => l !== null).join("\n");
}

export function buildMailto(to: string, r: SupportReport): string {
  const subject = `${BRAND_NAME} support · ${SUPPORT_TOPICS.find((t) => t.id === r.topic)?.label ?? r.topic}${r.reference ? ` · ${r.reference}` : ""}`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formatReport(r))}`;
}

export async function copyReport(r: SupportReport): Promise<SupportOutcome> {
  try {
    await navigator.clipboard.writeText(formatReport(r));
    return { ok: true, channel: "clipboard", message: "Report copied." };
  } catch {
    return { ok: false, channel: "clipboard", message: "Clipboard blocked — copy the text below." };
  }
}
