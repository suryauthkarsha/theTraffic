import { useMemo } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { CoverageBar } from "@/components/timing/CoverageBadge";
import { Dot, Pill } from "@/components/ui/pills";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useSignalModel } from "@/hooks/useSignalModel";
import { allJunctions, effectivePlanStatus, useIntersectionDataset, useSourceRegistry } from "@/lib/data/dataset";
import type { RegistrySource } from "@/lib/data/types";
import { fmtDate, fmtInt, safeHttpUrl } from "@/lib/format";
import { PLAN_MODEL_VERSION } from "@/lib/models/predict";
import { COVERAGE_META, COVERAGE_ORDER } from "@/lib/timing";

/**
 * Research tab — counts over the shipped datasets, and nothing else: six figures, the coverage bar,
 * the control-type split, what feeds the predictions, and one tile per source. No prose between them.
 */
export default function ResearchPage() {
  usePageTitle("Research");
  const dataset = useIntersectionDataset();
  const model = useSignalModel();
  const registry = useSourceRegistry();
  const meta = dataset.data?.meta;

  const planStats = useMemo(() => {
    const rows = allJunctions(model.plans);
    let verified = 0;
    let rejected = 0;
    let candidates = 0;
    let preValidated = 0;
    let deactivated = 0;
    for (const { junction } of rows) {
      const eff = effectivePlanStatus(junction, model.decisions);
      if (eff.status === "verified") verified++;
      else if (eff.status === "rejected") rejected++;
      else if (eff.status === "deactivated") deactivated++;
      else {
        candidates++;
        if (eff.pre_validated) preValidated++;
      }
    }
    return { total: rows.length, verified, rejected, candidates, preValidated, deactivated, intersections: model.verifiedPlanIntersections.size };
  }, [model.plans, model.decisions, model.verifiedPlanIntersections]);

  const coverage = useMemo(() => model.summarise(dataset.data?.intersections ?? []), [model, dataset.data]);
  const conflictCount = useMemo(() => Array.from(model.conflicts.values()).filter((c) => c.among_verified).length, [model.conflicts]);

  const classification = useMemo(() => {
    const inters = dataset.data?.intersections ?? [];
    const c = { fixed: 0, actuated: 0, adaptive: 0, unknown: 0 };
    for (const i of inters) {
      const links = model.verifiedPlans.get(i.id);
      const hint = links?.[0]?.junction.control_type_hint ?? (model.decisions.controlType[i.id]?.control_type ?? i.control_type);
      if (hint === "fixed" || hint === "fixed_coordinated") c.fixed++;
      else if (hint === "vehicle_actuated" || hint === "time_of_day" || hint === "actuated") c.actuated++;
      else if (hint === "adaptive") c.adaptive++;
      else c.unknown++;
    }
    return c;
  }, [dataset.data, model.verifiedPlans, model.decisions]);

  const kpis: { value: string; label: string; tone?: "ember" }[] = [
    { value: fmtInt(meta?.counts.logical_intersections), label: "junctions" },
    { value: fmtInt(meta?.counts.approaches), label: "approaches" },
    { value: fmtInt(planStats.total), label: "timing blocks parsed" },
    { value: fmtInt(planStats.verified), label: "links accepted" },
    { value: fmtInt(planStats.intersections), label: "junctions with an accepted plan" },
    { value: fmtInt(planStats.candidates), label: "blocks awaiting review", tone: "ember" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-[1480px] px-4 pb-10 pt-4 sm:px-6">
        <div className="eyebrow">
          <b>03</b> · research
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold text-gw-text">What we know</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="grey" mono>
              osm {meta ? meta.source.osm_timestamp_base.slice(0, 10) : "—"}
            </Pill>
            <Pill tone="grey" mono>
              plans {fmtDate(model.plans?.meta.portal_metadata_modified)}
            </Pill>
          </div>
        </div>

        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Key figures">
          {kpis.map((k, i) => (
            <div key={k.label} className="panel p-3 rise-in sm:p-4" style={{ animationDelay: `${i * 40}ms` }}>
              <div className={`readout break-words text-[22px] sm:text-[26px] ${k.tone === "ember" ? "readout-ember" : "readout-orange"}`}>{k.value}</div>
              <div className="mt-2 text-[13px] leading-snug text-gw-secondary">{k.label}</div>
            </div>
          ))}
        </section>

        <section className="panel mt-4 p-4" aria-labelledby="coverage">
          <h2 id="coverage" className="text-[15px] font-semibold text-gw-text">
            Timing coverage
          </h2>
          <div className="mt-3">
            <CoverageBar s={coverage} />
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Coverage categories">
            {COVERAGE_ORDER.map((c) => {
              const m = COVERAGE_META[c];
              const n = coverage.by_category[c];
              return (
                <li key={c} className="card-inset p-3">
                  <div className="flex items-center gap-1.5 text-[12px] text-gw-secondary">
                    <Dot color={m.color} size={7} /> {m.label}
                  </div>
                  <div className="mono mt-1.5 text-[22px] font-medium leading-none text-gw-text">{fmtInt(n)}</div>
                  <div className="mono mt-1 text-[11px] text-gw-muted">{coverage.mapped ? `${((n / coverage.mapped) * 100).toFixed(1)} %` : "—"}</div>
                </li>
              );
            })}
          </ul>
          <p className="mono mt-3 text-[12px] text-gw-secondary" aria-label="Published plan review states">
            {fmtInt(planStats.total)} blocks parsed · <span className="text-gw-orange">{fmtInt(planStats.verified)}</span> accepted · <span className="text-gw-ember">{fmtInt(planStats.preValidated)}</span> rule-set passed · <span className="text-gw-ember">{fmtInt(planStats.candidates - planStats.preValidated)}</span> in review · {fmtInt(planStats.rejected)} rejected · {fmtInt(planStats.deactivated)} deactivated
            {conflictCount > 0 && <span className="text-gw-red"> · {conflictCount} with conflicting accepted plans</span>}
          </p>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]" aria-label="Control type and predictions">
          <div className="panel p-4">
            <h2 className="text-[15px] font-semibold text-gw-text">Control type</h2>
            <div className="mt-4 flex h-6 w-full overflow-hidden rounded-sm bg-gw-track" role="img" aria-label="Control type breakdown">
              {[
                { n: classification.fixed, c: "#FF8A2B" },
                { n: classification.actuated, c: "#C0651C" },
                { n: classification.adaptive, c: "#F0535A" },
                { n: classification.unknown, c: "#67605A" },
              ].map((seg, i) => {
                const total = Object.values(classification).reduce((a, b) => a + b, 0) || 1;
                return <span key={i} style={{ width: `${(seg.n / total) * 100}%`, background: seg.c }} />;
              })}
            </div>
            <dl className="mono mt-4 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
              <Cls n={classification.fixed} label="Fixed / coord." color="text-gw-orange" />
              <Cls n={classification.actuated} label="Veh.-actuated" color="text-gw-ember" />
              <Cls n={classification.adaptive} label="Adaptive" color="text-gw-red" />
              <Cls n={classification.unknown} label="Unknown" color="text-gw-secondary" />
            </dl>
            <p className="mt-3 text-[12px] text-gw-muted">From accepted plan links, else review labels, else OpenStreetMap tags.</p>
          </div>

          <div className="panel p-4" aria-labelledby="feeds">
            <h2 id="feeds" className="text-[15px] font-semibold text-gw-text">
              What feeds the predictions
            </h2>
            <dl className="mono mt-3 grid gap-3 text-[12.5px]">
              <div className="border-l-2 border-l-gw-orange pl-3">
                <dt className="text-gw-text">
                  Level P · accepted timing-plan link <span className="text-gw-muted">· {PLAN_MODEL_VERSION.split(" ")[1]}</span>
                </dt>
                <dd className="mt-1 text-gw-secondary">
                  {fmtInt(planStats.intersections)} junctions · cycle length and phase splits from the sheet · uniform arrival phase (offsets are never published) · stale sheets weighted × 0.6
                </dd>
              </div>
              <div className="border-l-2 border-l-gw-border pl-3">
                <dt className="text-gw-text">Level E · unknown</dt>
                <dd className="mt-1 text-gw-secondary">every other junction · nothing on file, nothing guessed</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="mt-4" aria-labelledby="sources">
          <h2 id="sources" className="text-[15px] font-semibold text-gw-text">
            Sources
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(registry.data?.sources ?? []).map((s) => (
              <SourceTile key={s.id} s={s} publishedVerified={s.class === "published" ? planStats.verified : undefined} />
            ))}
            {!registry.data && <div className="panel p-4 text-[13px] text-gw-secondary">Loading…</div>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

const CLASS_LABEL: Record<RegistrySource["class"], string> = { published: "Published timing", live: "Live timing", historical: "Historical / planning", location: "Location only" };
const STATUS_TONE: Record<string, "orange" | "ember" | "grey" | "red"> = { ingested: "orange", ingested_pending_review: "ember", ingested_evidence_only: "grey", not_authorized: "ember", registered_not_retrievable: "grey" };

function fmtRegistryDate(v: string | Record<string, number> | null): string {
  if (!v) return "—";
  if (typeof v === "string") return /^\d{4}(-\d{2})?$/.test(v) ? v : fmtDate(v);
  return Object.entries(v)
    .map(([k, n]) => `${k} (${n})`)
    .join(", ");
}

/** One source: class, status, name, counts, dates, licence and link. The registry's notes stay in the JSON. */
function SourceTile({ s, publishedVerified }: { s: RegistrySource; publishedVerified?: number }) {
  const dates = Object.entries(s.dates).filter(([, v]) => v !== null);
  const counts = Object.entries(s.counts);
  const url = safeHttpUrl(s.url);
  return (
    <div className="panel p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label">{CLASS_LABEL[s.class]}</span>
        <Pill tone={STATUS_TONE[s.status] ?? "grey"}>{s.status.replace(/_/g, " ")}</Pill>
        {!s.timing_source && <Pill tone="grey">not a timing source</Pill>}
      </div>
      <div className="mt-2 font-medium text-gw-text">{s.name}</div>
      <div className="text-[12px] text-gw-secondary">{s.publisher}</div>
      {counts.length > 0 && (
        <div className="mono mt-2 text-[12px] text-gw-text">
          {counts.map(([k, n]) => `${fmtInt(n)} ${k.replace(/_/g, " ")}`).join(" · ")}
          {publishedVerified !== undefined ? ` · ${fmtInt(publishedVerified)} accepted` : ""}
        </div>
      )}
      {dates.length > 0 && <div className="mono mt-1 text-[11px] text-gw-muted">{dates.map(([k, v]) => `${k.replace(/_/g, " ")} ${fmtRegistryDate(v)}`).join(" · ")}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] text-gw-muted">
        <span>{s.license}</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            source
          </a>
        )}
      </div>
    </div>
  );
}

function Cls({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div>
      <dt className={`text-[18px] ${color}`}>{fmtInt(n)}</dt>
      <dd className="text-gw-secondary">{label}</dd>
    </div>
  );
}
