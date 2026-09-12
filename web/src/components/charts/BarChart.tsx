import { useEffect, useRef, useState } from "react";

/** Hourly bar chart with optional p10–p90 whiskers and highlighted bar; null → gap. */
export interface BarChartProps {
  labels: string[];
  values: (number | null)[];
  whiskers?: { lo: (number | null)[]; hi: (number | null)[] } | null;
  highlight?: number | null;
  height?: number;
  yMax?: number;
  yFormat?: (v: number) => string;
  counts?: number[] | null;
  ariaLabel: string;
  emptyMessage?: string | null;
}

export function BarChart({ labels, values, whiskers = null, highlight = null, height = 200, yMax, yFormat = (v) => String(Math.round(v)), counts = null, ariaLabel, emptyMessage = null }: BarChartProps) {
  // Like LineChart: the viewBox follows the measured width so the chart keeps its pixel height and
  // legible 11 px labels on a phone instead of shrinking with a fixed aspect ratio.
  const figRef = useRef<HTMLElement | null>(null);
  const [W, setW] = useState<number>(720);
  useEffect(() => {
    const el = figRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 720);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width) || 720);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 40, r: 8, t: 12, b: counts ? 44 : 26 };
  const n = labels.length;
  // Under ~420 px only every fourth hour label fits.
  const labelEvery = W < 420 ? 4 : 2;
  const all = [...values, ...(whiskers?.hi ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
  const hi = yMax ?? (all.length ? Math.max(...all) * 1.1 : 1);
  const bw = (W - pad.l - pad.r) / n;
  const y = (v: number) => pad.t + (1 - v / (hi || 1)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * hi);
  return (
    <figure ref={figRef} className="relative w-full" style={{ height: H }} role="img" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#1F1C19" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#9A928A" fontFamily="IBM Plex Mono, monospace">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const cx = pad.l + i * bw + bw / 2;
          if (v === null) return null;
          const isHi = highlight === i;
          return (
            <g key={i}>
              <rect x={cx - bw * 0.32} y={y(v)} width={bw * 0.64} height={Math.max(0, y(0) - y(v))} fill={isHi ? "#FF8A2B" : "#2E2A26"} rx={1.5} />
              {whiskers && whiskers.lo[i] !== null && whiskers.hi[i] !== null && (
                <g stroke="#67605A" strokeWidth={1}>
                  <line x1={cx} x2={cx} y1={y(whiskers.hi[i] as number)} y2={y(whiskers.lo[i] as number)} />
                  <line x1={cx - 3} x2={cx + 3} y1={y(whiskers.hi[i] as number)} y2={y(whiskers.hi[i] as number)} />
                  <line x1={cx - 3} x2={cx + 3} y1={y(whiskers.lo[i] as number)} y2={y(whiskers.lo[i] as number)} />
                </g>
              )}
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={pad.l + i * bw + bw / 2} y={H - (counts ? 26 : 8)} textAnchor="middle" fontSize={11} fill="#9A928A" fontFamily="IBM Plex Mono, monospace">
              {l}
            </text>
          ) : null,
        )}
        {counts && (
          <>
            <text x={pad.l - 6} y={H - 8} textAnchor="end" fontSize={10} fill="#67605A" fontFamily="IBM Plex Mono, monospace">
              N
            </text>
            {counts.map((c, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#67605A" fontFamily="IBM Plex Mono, monospace">
                  {c}
                </text>
              ) : null,
            )}
          </>
        )}
      </svg>
      {emptyMessage && (
        <figcaption className="absolute inset-0 flex items-center justify-center p-4">
          <span className="card-inset px-3 py-1.5 text-center text-[12px] text-gw-secondary">{emptyMessage}</span>
        </figcaption>
      )}
    </figure>
  );
}
