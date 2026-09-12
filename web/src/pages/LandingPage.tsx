import { ArrowRight, BookOpen, Cctv, FlaskConical, LifeBuoy, Map as MapIcon, Megaphone } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";

import { StatusRail } from "@/components/layout/StatusRail";
import { Wordmark } from "@/components/layout/Wordmark";
import { KnotAnimation } from "@/components/ui/knot-animation";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useIntersectionDataset, usePublishedPlans } from "@/lib/data/dataset";
import { BRAND_CITY, BRAND_NAME } from "@/lib/system/brand";
import { MODULES, type ModuleId } from "@/lib/system/modules";

const INSTRUMENTS: ModuleId[] = ["signals", "surveillance", "grievances"];
const ICONS: Record<ModuleId, ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>> = {
  signals: MapIcon,
  research: FlaskConical,
  methodology: BookOpen,
  support: LifeBuoy,
  surveillance: Cctv,
  grievances: Megaphone,
};

const nf = new Intl.NumberFormat("en-IN");
const num = (n: number | null | undefined): string => (n == null ? "—" : nf.format(n));

const STEPS: { index: string; title: string; body: string }[] = [
  { index: "01", title: "Find a junction", body: "Search by name, tap a dot on the map, or press the locate button to start where you stand." },
  { index: "02", title: "Read its signal", body: "A timing plan linked by an explicit review decision, with its source and dates — and, for your day and time, the expected wait and chance of stopping." },
  { index: "03", title: "Say what's wrong", body: "A pothole, a footpath that stops, standing water, nowhere to cross: a photo and the place, posted without an account to the public board." },
];

/** The four promises — each honesty rule, said once. */
const RULES: { index: string; body: string }[] = [
  { index: "R1", body: "Colours show what we know — never what a light is doing." },
  { index: "R2", body: "Unknown stays unknown: no data means a dash, never a guess." },
  { index: "R3", body: "Only timing plans with an explicit accepted junction link feed a prediction." },
  { index: "R4", body: "No countdowns, no “catch the green” — we never tell you to speed." },
];

const h2 = "eyebrow";

const LandingPage = () => {
  usePageTitle(null);
  const dataset = useIntersectionDataset();
  const plans = usePublishedPlans();

  const counts = dataset.data?.meta.counts;
  const osmBase = dataset.data?.meta.source.osm_timestamp_base.slice(0, 10) ?? null;
  const planDocs = plans.data?.sources.length ?? null;
  const planBlocks = plans.data ? plans.data.sources.reduce((s, src) => s + src.junctions.length, 0) : null;

  return (
    <div className="relative flex min-h-full flex-col bg-gw-canvas">
      <div className="grid-bg pointer-events-none fixed inset-0" aria-hidden />

      <header className="sticky top-0 z-40 h-[var(--gw-top)] shrink-0 border-b border-gw-border bg-gw-canvas/95 pt-[var(--gw-safe-top)] backdrop-blur-sm" role="banner">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-[calc(var(--gw-safe-top)+0.5rem)] focus:z-50 focus:rounded-md focus:bg-gw-orange focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-gw-canvas">
          Skip to content
        </a>
        <div className="mx-auto flex h-full max-w-[1200px] items-center gap-6 px-5 sm:px-8">
          <Link to="/" className="flex min-h-[44px] items-center gap-2.5" aria-label={`${BRAND_NAME} ${BRAND_CITY}`}>
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Landing sections">
            {[
              ["#tools", "What's inside"],
              ["#method", "How it works"],
              ["#rules", "Our rules"],
              ["#data", "Data"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="flex h-14 items-center px-3 text-[14px] text-gw-secondary transition-colors hover:text-gw-text">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/support" className="btn-secondary hidden h-10 px-3 text-[13px] sm:inline-flex" aria-label="Support">
              <LifeBuoy size={14} className="text-gw-secondary" aria-hidden />
              <span className="ml-1.5 hidden lg:inline">Support</span>
            </Link>
            <Link to="/console" className="btn-primary h-10 px-4 text-[14px]">
              <span className="sm:hidden">Console</span>
              <span className="hidden sm:inline">Open the console</span> <ArrowRight size={15} className="ml-1.5" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="relative flex-1">
        {/* Hero — one column. The knot is not a figure any more: it rotates straight on the black canvas beside the title (user decision 2026-09-09). */}
        <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-12 sm:px-8 lg:pb-24 lg:pt-20" aria-labelledby="hero-title">
          <div className="rise-in">
            <div className="eyebrow">
              <b>bengaluru</b> · roads, junction by junction
            </div>
            <div className="relative mt-5 flex w-fit items-center">
              <h1 id="hero-title" className="relative z-10 text-[40px] font-semibold leading-[1.02] tracking-[-0.02em] text-gw-text sm:text-[56px] lg:text-[64px]">
                Know the signals,
                <br />
                junction by junction.
              </h1>
              {/* 80 columns of Plex Mono, very dark and decorative: from `lg` it starts at the title's right edge (pulled in so the tube
                  sits just past the last letter); below `lg` the title fills the width, so the ghost sits behind its right edge instead. */}
              <KnotAnimation speedA={0.028} speedB={0.014} className="knot-ghost absolute right-0 top-1/2 -translate-y-1/2 text-[4px] md:text-[5px] lg:left-full lg:right-auto lg:-ml-8 lg:text-[6.5px] xl:-ml-10 xl:text-[7.5px]" />
            </div>
            <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-gw-secondary sm:text-[19px]">Bengaluru's mapped traffic signals and published timing records, a dated snapshot of mapped surveillance, and a public board of road problems.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/console" className="btn-primary h-12 px-6 text-[16px]">
                Open the console <ArrowRight size={16} className="ml-2" aria-hidden />
              </Link>
              <Link to="/grievances" className="btn-secondary h-12 px-5 text-[15px]">
                The grievance board
              </Link>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3" aria-label="Dataset at a glance">
              {[
                ["junctions", num(counts?.logical_intersections)],
                ["traffic signals", num(counts?.source_signal_nodes)],
                ["map data from", osmBase ?? "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="label">{label}</dt>
                  <dd className="readout mt-1.5 text-[20px] text-gw-text sm:text-[24px]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Tools */}
        <section id="tools" className="border-t border-gw-border" aria-labelledby="tools-title">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 lg:py-20">
            <h2 id="tools-title" className={h2}>
              <b>01</b> · tools
            </h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {INSTRUMENTS.map((id) => {
                const m = MODULES.find((x) => x.id === id);
                if (!m) return null;
                const Icon = ICONS[id];
                return (
                  <Link key={id} to={m.to} className="panel group flex flex-col p-5 transition-colors hover:bg-gw-hover">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2.5">
                        <Icon size={16} className="text-gw-secondary" aria-hidden />
                        <h3 className="text-[19px] font-semibold text-gw-text">{m.title}</h3>
                      </span>
                      <ArrowRight size={15} className="shrink-0 text-gw-muted transition-colors group-hover:text-gw-text" aria-hidden />
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-gw-secondary">{m.description}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* Method */}
        <section id="method" className="border-t border-gw-border" aria-labelledby="method-title">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 lg:py-20">
            <h2 id="method-title" className={h2}>
              <b>02</b> · how it works
            </h2>
            <ol className="mt-6 grid gap-3 lg:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.index} className="card-inset grid gap-4 p-5 sm:grid-cols-[72px_minmax(0,1fr)]">
                  <span className="readout text-[28px] text-gw-tick">{s.index}</span>
                  <div>
                    <h3 className="text-[17px] font-semibold text-gw-text">{s.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-gw-secondary">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Rules */}
        <section id="rules" className="border-t border-gw-border" aria-labelledby="rules-title">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 lg:py-20">
            <h2 id="rules-title" className={h2}>
              <b>03</b> · our rules
            </h2>
            <ul className="panel mt-6 divide-y divide-gw-border">
              {RULES.map((r) => (
                <li key={r.index} className="flex items-baseline gap-4 px-5 py-4">
                  <span className="mono shrink-0 text-[11px] text-gw-muted">{r.index}</span>
                  <p className="text-[15px] leading-relaxed text-gw-text sm:text-[16px]">{r.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Data */}
        <section id="data" className="border-t border-gw-border" aria-labelledby="data-title">
          <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 lg:py-20">
            <h2 id="data-title" className={h2}>
              <b>04</b> · data
            </h2>
            <div className="mt-6 grid gap-3 lg:grid-cols-3">
              <article className="panel p-5">
                <div className="label-strong">OpenStreetMap</div>
                <div className="rule mt-4" />
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="label">signals → junctions</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-text">
                      {num(counts?.source_signal_nodes)} → {num(counts?.logical_intersections)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">as of · licence</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-text">{osmBase ?? "—"} · ODbL</dd>
                  </div>
                </dl>
              </article>
              <article className="panel p-5">
                <div className="label-strong">Timing plans · Bengaluru Traffic Police</div>
                <div className="rule mt-4" />
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="label">documents · junctions</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-text">
                      {num(planDocs)} · {num(planBlocks)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">used only after</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-ember">accepted review link</dd>
                  </div>
                </dl>
              </article>
              <article className="panel p-5">
                <div className="label-strong">Grievance board · no account</div>
                <div className="rule mt-4" />
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="label">accounts</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-text">none</dd>
                  </div>
                  <div>
                    <dt className="label">kept about you</dt>
                    <dd className="mono mt-1 text-[13px] text-gw-text">nothing</dd>
                  </div>
                </dl>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-gw-border px-5 py-6 text-[12px] text-gw-muted sm:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap items-center gap-4" aria-label="Footer">
            <Link to="/support" className="hover:text-gw-text">
              Support
            </Link>
            <Link to="/methodology" className="hover:text-gw-text">
              Methodology
            </Link>
            <Link to="/research" className="hover:text-gw-text">
              Data &amp; sources
            </Link>
            <Link to="/grievances" className="hover:text-gw-text">
              Grievances
            </Link>
          </nav>
          <span className="mono">© OpenStreetMap contributors (ODbL) · OpenFreeMap · Esri</span>
        </div>
      </footer>
      <StatusRail />
    </div>
  );
};

export default LandingPage;
