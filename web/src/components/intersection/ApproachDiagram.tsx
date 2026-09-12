import type { Approach } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** Compass glyph of approaches with bearings; the selected arm is orange (design contract). */
export function ApproachDiagram({ approaches, selectedId, onSelect }: { approaches: Approach[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const S = 260;
  const c = S / 2;
  const r = 96;
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto h-[240px] w-[240px] shrink-0" role="img" aria-label="Approach diagram">
        {["N", "E", "S", "W"].map((l, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return (
            <text key={l} x={c + Math.sin(a) * (r + 22)} y={c - Math.cos(a) * (r + 22) + 4} textAnchor="middle" fontSize={12} fill="#9A928A" fontFamily="IBM Plex Sans">
              {l}
            </text>
          );
        })}
        <circle cx={c} cy={c} r={26} fill="#141211" stroke="#F3EFE9" strokeWidth={2} />
        {approaches.map((ap) => {
          // Approach bearing is the direction of travel INTO the junction; the arm is drawn on the side traffic comes from.
          const from = ((ap.bearing_deg + 180) % 360) * (Math.PI / 180);
          const x1 = c + Math.sin(from) * r;
          const y1 = c - Math.cos(from) * r;
          const x2 = c + Math.sin(from) * 30;
          const y2 = c - Math.cos(from) * 30;
          const sel = ap.id === selectedId;
          return (
            <g key={ap.id} className="cursor-pointer" onClick={() => onSelect(ap.id)}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={sel ? "#FF8A2B" : "#67605A"} strokeWidth={sel ? 10 : 6} strokeLinecap="round" opacity={sel ? 0.95 : 0.7} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={sel ? "#000000" : "#F3EFE9"} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
              <polygon points={`${x2},${y2} ${x2 - 6 * Math.cos(from) - 5 * Math.sin(from)},${y2 - 6 * Math.sin(from) + 5 * Math.cos(from)} ${x2 + 6 * Math.cos(from) - 5 * Math.sin(from)},${y2 + 6 * Math.sin(from) + 5 * Math.cos(from)}`} fill={sel ? "#FF8A2B" : "#9A928A"} />
              <text x={c + Math.sin(from) * (r + 8)} y={c - Math.cos(from) * (r + 8) + 3} textAnchor="middle" fontSize={10} fill={sel ? "#FF8A2B" : "#9A928A"} fontFamily="IBM Plex Mono">
                {String(Math.round(ap.bearing_deg)).padStart(3, "0")}°
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="flex-1 space-y-1" role="listbox" aria-label="Approaches">
        {approaches.map((ap) => {
          const sel = ap.id === selectedId;
          return (
            <li key={ap.id}>
              <button
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => onSelect(ap.id)}
                className={cn("flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left hover:bg-gw-hover", sel && "bg-gw-hover")}
              >
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border", sel ? "border-gw-orange bg-gw-orange" : "border-gw-muted")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-gw-text">
                    {capitalize(ap.direction)} {ap.road_name ?? "unnamed road"}
                  </span>
                  <span className="mono block text-[12px] text-gw-secondary">
                    {String(Math.round(ap.bearing_deg)).padStart(3, "0")}° · {ap.movement}
                    {ap.highway ? ` · ${ap.highway}` : ""}
                    {ap.lanes ? ` · ${ap.lanes} lanes` : ""}
                    {ap.maxspeed ? ` · ${ap.maxspeed} km/h` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {approaches.length === 0 && <li className="px-2.5 py-2 text-[13px] text-gw-muted">No approaches in OpenStreetMap for this node.</li>}
      </ul>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
