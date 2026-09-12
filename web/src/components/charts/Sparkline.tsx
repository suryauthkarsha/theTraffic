/** Tiny sparkline for KPI tiles. Renders a flat baseline when there is no history yet. */
export function Sparkline({ values, color = "#FF8A2B", width = 120, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const n = values.length;
  if (n < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1={0} x2={width} y1={height - 2} y2={height - 2} stroke="#2E2A26" strokeWidth={1.5} strokeDasharray="2 3" />
      </svg>
    );
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (n - 1)) * width},${height - 2 - ((v - lo) / span) * (height - 4)}`);
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <polygon points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill={color} opacity={0.12} />
    </svg>
  );
}
