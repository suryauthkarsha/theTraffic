import { Dot, Pill } from "@/components/ui/pills";
import { COVERAGE_META, COVERAGE_ORDER, type CoverageCategory, type CoverageSummary } from "@/lib/timing";

/** Category pill with its colour dot — the same colour the Signal Map uses for the "Timing coverage" layer. */
export function CoverageBadge({ category, className }: { category: CoverageCategory; className?: string }) {
  const m = COVERAGE_META[category];
  return (
    <Pill tone="neutral" className={className}>
      <Dot color={m.color} size={7} /> {m.label}
    </Pill>
  );
}

/** Stacked bar over the six categories (widths proportional to counts). */
export function CoverageBar({ s, height = 24 }: { s: CoverageSummary; height?: number }) {
  const total = Math.max(1, s.mapped);
  return (
    <div className="flex w-full overflow-hidden rounded-sm bg-gw-track" style={{ height }} role="img" aria-label={COVERAGE_ORDER.map((c) => `${COVERAGE_META[c].label}: ${s.by_category[c]}`).join(", ")}>
      {COVERAGE_ORDER.map((c) => (
        <span key={c} style={{ width: `${(s.by_category[c] / total) * 100}%`, background: COVERAGE_META[c].color }} title={`${COVERAGE_META[c].label}: ${s.by_category[c]}`} />
      ))}
    </div>
  );
}
