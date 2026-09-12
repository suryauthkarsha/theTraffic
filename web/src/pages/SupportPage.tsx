import { ArrowRight, Check, ClipboardCopy, Instagram, LifeBuoy, Linkedin, Mail, Megaphone } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ComponentType } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { Pill } from "@/components/ui/pills";
import { XLogo } from "@/components/ui/x-logo";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { SOCIAL_PROFILES, type SocialNetwork } from "@/lib/support/social";
import { buildMailto, collectDiagnostics, copyReport, formatReport, MESSAGE_MAX, PREFILL_DETAIL_MAX, PREFILL_REFERENCE_MAX, prefillText, reportPage, SUPPORT_EMAIL, SUPPORT_TOPICS, toReport, validateDraft, type SupportDraft, type SupportOutcome, type SupportTopic } from "@/lib/support/support";
import type { Tone } from "@/lib/system/status";
import { cn } from "@/lib/utils";

/** Five questions, one or two sentences each. */
const FAQ: { q: string; a: string }[] = [
  { q: "What do the colours mean?", a: "What we know about a junction — how much timing data it has, the wait an accepted plan implies, how surely its signals were merged. Never what a light is doing." },
  { q: "Do you know the current signal state?", a: "No. There is no live feed for Bengaluru's signals. Estimates come from published timing plans with an explicit accepted junction link; without one, a junction reads Unknown." },
  { q: "Why a delay at one time and a dash at another?", a: "A plan covers set windows on set day types. Inside an accepted plan window we show what the cycle implies; outside it there is no cycle to reason about." },
  { q: "Do you record anything or need an account?", a: "No account. The only thing we keep is what you choose to post on the grievance board — the kind, the words, the place and the photo, with no name or number attached. Google Analytics counts which pages are visited and stays off when your browser sends the Global Privacy Control signal." },
  { q: "Where do the timing plans come from?", a: "Bengaluru Traffic Police sheets published on OpenCity, parsed into time-of-day windows and linked to junctions by recorded AI-assisted review decisions before a prediction may use them." },
];

const DOT: Record<Tone, string> = { orange: "bg-gw-orange", ember: "bg-gw-ember", red: "bg-gw-red", grey: "bg-gw-track" };

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean };

/** One outline glyph per network, all in lucide's stroke style. */
const SOCIAL_ICON: Record<SocialNetwork, ComponentType<IconProps>> = { instagram: Instagram, x: XLogo, linkedin: Linkedin };

function isTopic(v: string | null): v is SupportTopic {
  return SUPPORT_TOPICS.some((t) => t.id === v);
}

export default function SupportPage() {
  usePageTitle("Support");
  const id = useId();
  const [params] = useSearchParams();
  const location = useLocation();
  const { items, inputs } = useSystemStatus();

  const [draft, setDraft] = useState<SupportDraft>(() => {
    // Links may pre-fill the form (error panel, junction pages) — within the caps in support.ts, never beyond.
    const topic = params.get("topic");
    const detail = prefillText(params.get("detail"), PREFILL_DETAIL_MAX);
    return {
      topic: isTopic(topic) ? topic : "bug",
      message: detail ? `What happened: ${detail}\n\nWhat I was doing: ` : "",
      contact: "",
      reference: prefillText(params.get("ref"), PREFILL_REFERENCE_MAX),
      website: "",
      includeDiagnostics: true,
    };
  });
  const [outcome, setOutcome] = useState<SupportOutcome | null>(null);
  const [touched, setTouched] = useState<boolean>(false);

  useEffect(() => {
    setOutcome(null);
  }, [draft.topic]);

  const page = useMemo(() => reportPage(params.get("from"), `${location.pathname}${location.search}`), [location.pathname, location.search, params]);
  const diagnostics = useMemo(() => collectDiagnostics(inputs, page, typeof navigator !== "undefined" ? navigator.userAgent : "unknown", { w: typeof window !== "undefined" ? window.innerWidth : 0, h: typeof window !== "undefined" ? window.innerHeight : 0 }), [inputs, page]);
  const report = useMemo(() => toReport(draft, page, diagnostics), [draft, page, diagnostics]);
  const validation = validateDraft(draft);

  const copy = async () => {
    setTouched(true);
    if (validation) return;
    setOutcome(await copyReport(report));
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 pb-12 pt-4 sm:px-6">
        <Breadcrumb parent={{ to: "/console", label: "Console" }} current="Support" />
        <header className="mt-4">
          <div className="eyebrow">
            <b>05</b> · support
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.01em] text-gw-text">Support</h1>
          <p className="mt-2 text-[13.5px] text-gw-secondary">
            A project under{" "}
            <a href="https://rasthe.in" target="_blank" rel="noopener noreferrer" className="text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange">
              Rasthe
            </a>{" "}
            and{" "}
            <a href="https://www.linkedin.com/company/the-marg-initiative" target="_blank" rel="noopener noreferrer" className="text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange">
              The Marg Initiative
            </a>
            .
          </p>
          {/* The maker's profiles: icon + handle, the network named for screen readers; 44 px rows on touch. */}
          <ul className="mt-2 flex flex-wrap gap-x-5" aria-label="Profiles">
            {SOCIAL_PROFILES.map((s) => {
              const Icon = SOCIAL_ICON[s.id];
              return (
                <li key={s.id}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${s.network} · ${s.handle}`} className="group inline-flex min-h-[32px] items-center gap-1.5 text-[12.5px] text-gw-secondary transition-colors hover:text-gw-text coarse:min-h-[44px]">
                    <Icon size={15} className="shrink-0 text-gw-muted transition-colors group-hover:text-gw-orange" aria-hidden />
                    <span className="mono">{s.handle}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </header>

        {/* Phones: the request form comes first ("Report a problem" lands here); the FAQ follows. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="order-last space-y-6 lg:order-none">
            {/* The board: what people face on the road itself, posted without an account with a photo and the place. */}
            <section className="panel flex flex-wrap items-center gap-3 p-4" aria-labelledby={`${id}-grievance`}>
              <Megaphone size={17} className="shrink-0 text-gw-orange" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 id={`${id}-grievance`} className="text-[15px] font-semibold text-gw-text">
                  Grievances
                </h2>
                <p className="mt-0.5 text-[13px] text-gw-secondary">Potholes, footpaths, water, crossings, signals, and lights, posted without an account to one public board.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/grievances" className="btn-secondary h-11 text-[13px]">
                  The board <ArrowRight size={14} className="ml-1.5" aria-hidden />
                </Link>
                <Link to="/grievance" className="btn-secondary h-11 text-[13px]">
                  File one
                </Link>
              </div>
            </section>

            <section className="panel p-5" aria-labelledby={`${id}-faq`}>
              <h2 id={`${id}-faq`} className="text-[15px] font-semibold text-gw-text">
                Frequently asked
              </h2>
              <div className="rule mt-3" aria-hidden />
              <ul className="mt-2 divide-y divide-gw-border">
                {FAQ.map((f, i) => (
                  <li key={f.q}>
                    <details className="group py-2.5">
                      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 text-[14px] text-gw-text marker:content-none">
                        <span className="mono w-6 shrink-0 text-[11px] text-gw-muted">{String(i + 1).padStart(2, "0")}</span>
                        <span className="flex-1">{f.q}</span>
                        <span className="mono text-[11px] text-gw-muted group-open:rotate-90 transition-transform" aria-hidden>
                          ›
                        </span>
                      </summary>
                      <p className="mt-1 pl-9 text-[13.5px] leading-relaxed text-gw-secondary">{f.a}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel p-5" aria-labelledby={`${id}-status`}>
              <h2 id={`${id}-status`} className="text-[15px] font-semibold text-gw-text">
                System status
              </h2>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {items.map((it) => (
                  <div key={it.id} className="card-inset flex items-start gap-2.5 p-3">
                    <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT[it.tone])} aria-hidden />
                    <div className="min-w-0">
                      <dt className="label">{it.label}</dt>
                      <dd className="mono mt-0.5 truncate text-[13px] text-gw-text">{it.value}</dd>
                      <dd className="mt-0.5 text-[12px] leading-snug text-gw-muted">{it.detail}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <section className="panel panel-hud order-first self-start p-4 sm:p-5 lg:order-none" aria-labelledby={`${id}-form`}>
            <div className="flex items-center gap-2">
              <LifeBuoy size={17} className="text-gw-orange" aria-hidden />
              <h2 id={`${id}-form`} className="text-[17px] font-semibold text-gw-text">
                Report a problem
              </h2>
            </div>
            {SUPPORT_EMAIL ? (
              <p className="mt-1.5 text-[12.5px] text-gw-muted">
                Opens in your e-mail app, addressed to{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="mono text-gw-secondary underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            ) : (
              <p className="mt-1.5 text-[12.5px] text-gw-muted">This build has no support mailbox — copy the report and send it your own way.</p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
              }}
              className="mt-4 space-y-3"
              aria-describedby={`${id}-validation`}
              noValidate
            >
              <label className="block">
                <span className="label">Topic</span>
                <select value={draft.topic} onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value as SupportTopic }))} className="mt-1 h-11 w-full rounded-[4px] border border-gw-border bg-gw-card px-3 text-[14px] text-gw-text outline-none focus:border-gw-orange">
                  {SUPPORT_TOPICS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">What happened</span>
                <textarea value={draft.message} onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))} onBlur={() => setTouched(true)} rows={6} maxLength={MESSAGE_MAX + 200} placeholder="What you did, what you expected, what you saw." className="mt-1 w-full resize-y rounded-[4px] border border-gw-border bg-gw-card px-3 py-2.5 text-[14px] leading-relaxed text-gw-text outline-none placeholder:text-gw-muted focus:border-gw-orange" aria-required />
                <span className="mono mt-1 block text-right text-[11px] text-gw-muted">{draft.message.trim().length.toLocaleString("en-IN")} / {MESSAGE_MAX.toLocaleString("en-IN")}</span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Reference (optional)</span>
                  <input value={draft.reference} onChange={(e) => setDraft((d) => ({ ...d, reference: e.target.value }))} placeholder="junction id, date" className="mono mt-1 h-11 w-full rounded-[4px] border border-gw-border bg-gw-card px-3 text-[13px] text-gw-text outline-none placeholder:text-gw-muted focus:border-gw-orange" />
                </label>
                <label className="block">
                  <span className="label">Contact (optional)</span>
                  <input value={draft.contact} onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))} placeholder="e-mail, if you want a reply" autoComplete="email" className="mt-1 h-11 w-full rounded-[4px] border border-gw-border bg-gw-card px-3 text-[14px] text-gw-text outline-none placeholder:text-gw-muted focus:border-gw-orange" />
                </label>
              </div>

              {/* Honeypot: hidden from people, filled by naive bots. */}
              <label className="sr-only" aria-hidden>
                Website
                <input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))} />
              </label>

              <label className="flex items-start gap-2.5 text-[13px] text-gw-secondary">
                <input type="checkbox" checked={draft.includeDiagnostics} onChange={(e) => setDraft((d) => ({ ...d, includeDiagnostics: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-gw-orange" />
                <span>
                  Attach diagnostics — build, page, dataset, browser. Never your location.
                  <details className="mt-1">
                    <summary className="mono cursor-pointer text-[11px] text-gw-muted">what is attached</summary>
                    <pre className="card-inset mono mt-1 overflow-x-auto p-2 text-[11px] leading-relaxed text-gw-secondary">{JSON.stringify(diagnostics, null, 2)}</pre>
                  </details>
                </span>
              </label>

              {touched && validation && (
                <p id={`${id}-validation`} className="text-[12px] text-gw-ember" role="alert">
                  {validation}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {SUPPORT_EMAIL ? (
                  <>
                    <a href={validation ? undefined : buildMailto(SUPPORT_EMAIL, report)} onClick={() => setTouched(true)} className={cn("btn-primary h-11 flex-1 text-[14px]", validation && "pointer-events-none opacity-50")} aria-disabled={Boolean(validation)}>
                      <Mail size={15} className="mr-2" aria-hidden /> E-mail the report
                    </a>
                    <button type="button" className="btn-secondary h-11 text-[13px]" onClick={() => void copy()}>
                      <ClipboardCopy size={14} className="mr-1.5" aria-hidden /> Copy instead
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary h-11 flex-1 text-[14px]" onClick={() => void copy()}>
                    <ClipboardCopy size={15} className="mr-2" aria-hidden /> Copy the report
                  </button>
                )}
              </div>

              {outcome && !outcome.ok && (
                <div className="card-inset border-gw-ember/50 p-3 text-[13px]" role="alert">
                  <Pill tone="ember">clipboard</Pill>
                  <p className="mt-1.5 text-gw-secondary">{outcome.message}</p>
                  <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-gw-secondary" tabIndex={0}>
                    {formatReport(report)}
                  </pre>
                </div>
              )}
              {outcome?.ok && (
                <p className="text-[13px] text-gw-orange" role="status">
                  <Check size={14} className="mr-1 inline" aria-hidden /> {outcome.message}
                </p>
              )}
            </form>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
