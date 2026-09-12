import { ExternalLink } from "lucide-react";

import { Pill } from "@/components/ui/pills";
import { fmtDate, safeHttpUrl } from "@/lib/format";
import { currencyTone, type ClaimKind, type ClaimVerification, type TimingClaim } from "@/lib/timing";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<ClaimKind, string> = { live: "Live", published: "Published", historical: "Historical" };
const KIND_TONE: Record<ClaimKind, "orange" | "ember" | "grey" | "neutral"> = { live: "orange", published: "neutral", historical: "grey" };

export function verificationTone(s: ClaimVerification): "orange" | "ember" | "red" | "grey" | "neutral" {
  switch (s) {
    case "verified":
      return "orange";
    case "pre_validated":
    case "awaiting_review":
      return "ember";
    case "rejected":
      return "red";
    default:
      return "grey";
  }
}

export const VERIFICATION_SHORT: Record<ClaimVerification, string> = {
  verified: "Accepted review link",
  pre_validated: "Awaiting review · rule set passed",
  awaiting_review: "Awaiting review",
  rejected: "Rejected",
  deactivated: "Deactivated",
  not_applicable: "Not a timing claim",
};

const FLAG_LABEL: Record<string, string> = {
  duplicate: "duplicate document",
  conflicting_timings: "conflicting timings (same junction name)",
  conflicting_target: "conflicting timings (same intersection)",
  weak_match: "weak junction match",
  stale_document: "stale document",
  undated_document: "undated document",
  possible_mention: "possible mention (moderate name match)",
  stale_live_sample: "stale live sample",
};

function fmtDoc(iso: string | null): string {
  if (!iso) return "—";
  if (iso.length === 7) return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}-01T00:00:00Z`));
  if (iso.length === 4) return iso;
  return fmtDate(iso);
}

/**
 * One timing claim with its provenance in six rows: source, junction, the window that applies now,
 * its three dates (document · published · retrieved), verification and a summary. Currency and
 * verification status are the pills; nothing is printed twice.
 */
export function TimingClaimCard({ claim, compact = false, className }: { claim: TimingClaim; compact?: boolean; className?: string }) {
  const c = claim;
  const w = c.applicable_window;
  const dates = [fmtDoc(c.document_date), c.published_at ? `published ${fmtDate(c.published_at)}` : null, c.retrieved_at ? `retrieved ${fmtDate(c.retrieved_at)}` : null].filter((d): d is string => d !== null).join(" · ");
  return (
    <article className={cn("card-inset p-3 text-[13px]", c.affects_recommendations && "border-l-2 border-l-gw-orange", className)} aria-label={`${KIND_LABEL[c.kind]} timing claim from ${c.source.name}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Pill>
        <Pill tone={verificationTone(c.verification.status)}>{VERIFICATION_SHORT[c.verification.status]}</Pill>
        <Pill tone={currencyTone(c.currency.status)} mono>
          {c.currency.status}
        </Pill>
        {c.affects_recommendations ? <span className="text-[11px] text-gw-orange">used in predictions</span> : <span className="text-[11px] text-gw-muted">not used in predictions</span>}
      </div>
      <dl className="mono mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-gw-secondary">Source</dt>
        <dd className="text-gw-text">
          {c.source.name}
          <span className="text-gw-secondary"> · {c.source.publisher}</span>
          {safeHttpUrl(c.source.url) && (
            <a href={safeHttpUrl(c.source.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-1 text-gw-secondary underline">
              document <ExternalLink size={11} />
            </a>
          )}
        </dd>
        <dt className="text-gw-secondary">Junction</dt>
        <dd className="text-gw-text">
          {c.junction_label}
          {c.match && <span className="text-gw-muted"> · match {c.match.tier}{c.match.score !== null ? ` ${c.match.score.toFixed(2)}` : ""}</span>}
        </dd>
        <dt className="text-gw-secondary">Window</dt>
        <dd className="text-gw-text">
          {w ? (
            <>
              {w.day_type.replace(/_/g, " ")} {w.start}–{w.end}
              {w.mode === "timed" && w.cycle_s !== null ? ` · C ${w.cycle_s} s · phases [${w.phases.map((p) => (p === null ? "?" : p)).join(", ")}]${w.pedestrian_phase_s !== null ? ` · pedestrian ${w.pedestrian_phase_s} s` : ""}` : w.mode === "blinking" ? " · blinking (no control)" : " · unreadable"}
            </>
          ) : (
            <span className="text-gw-secondary">{c.applicable_note ?? "—"}</span>
          )}
          {w && c.applicable_note && <div className="text-gw-muted">{c.applicable_note}</div>}
        </dd>
        <dt className="text-gw-secondary">Dates</dt>
        <dd className="text-gw-text">{dates}</dd>
        <dt className="text-gw-secondary">Verification</dt>
        <dd className="text-gw-text">
          {c.verification.label}
          {c.verification.at ? <span className="text-gw-muted"> · {fmtDate(c.verification.at)}</span> : null}
        </dd>
        <dt className="text-gw-secondary">Summary</dt>
        <dd className="text-gw-text">
          {c.summary}
          {c.control_type_hint ? ` · ${c.control_type_hint.replace(/_/g, " ")}` : ""}
        </dd>
      </dl>
      {c.quality_flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.quality_flags.map((f) => (
            <Pill key={f} tone={f.startsWith("conflicting") || f === "duplicate" ? "red" : "ember"}>
              {FLAG_LABEL[f] ?? f.replace(/_/g, " ")}
            </Pill>
          ))}
        </div>
      )}
      {!compact && c.quote && <blockquote className="mt-2 border-l-2 border-gw-border pl-3 text-[12px] italic text-gw-secondary">“{c.quote}”{c.page !== null ? <span className="mono not-italic text-gw-muted"> — p. {c.page}</span> : null}</blockquote>}
      {!compact && c.windows && c.windows.length > 0 && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-gw-secondary hover:text-gw-text">All {c.windows.length} published windows</summary>
          <ul className="mono mt-1 space-y-0.5 text-gw-text">
            {c.windows.map((x, i) => (
              <li key={i} className={x.consistent === false ? "text-gw-ember" : ""}>
                <span className="text-gw-secondary">{x.day_type.replace(/_/g, " ")}</span> {x.start}–{x.end}
                {x.mode === "timed" ? ` · phases [${x.phases.map((p) => (p === null ? "?" : p)).join(", ")}] · C ${x.cycle_s ?? "?"} s${x.pedestrian_phase_s !== null ? ` · ped ${x.pedestrian_phase_s} s` : ""}` : x.mode === "blinking" ? " · blinking" : " · unreadable"}
              </li>
            ))}
          </ul>
          {c.phase_labels && c.phase_labels.some(Boolean) && <div className="mt-1 text-gw-muted">Phase labels: {c.phase_labels.map((l, i) => `${i + 1}: ${l ?? "—"}`).join(" · ")}</div>}
          {c.parse_confidence !== null && <div className="mono mt-1 text-gw-muted">parse confidence {c.parse_confidence.toFixed(2)}</div>}
        </details>
      )}
    </article>
  );
}
