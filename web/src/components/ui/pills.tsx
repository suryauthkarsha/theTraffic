import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Pill tones follow the palette: orange = good / confirmed, ember = partial / uncertain, red = trouble. */
export type PillTone = "orange" | "ember" | "red" | "grey" | "neutral";
type Tone = PillTone;

const tones: Record<Tone, string> = {
  orange: "border-gw-orange/40 bg-gw-orange/10 text-gw-orange",
  ember: "border-gw-ember/50 bg-gw-ember/10 text-gw-ember",
  red: "border-gw-red/40 bg-gw-red/10 text-gw-red",
  grey: "border-gw-border bg-gw-card text-gw-secondary",
  neutral: "border-gw-border bg-gw-card text-gw-text",
};

/** Text colour class per tone (static strings so Tailwind can see them). */
export const TONE_TEXT: Record<Tone, string> = {
  orange: "text-gw-orange",
  ember: "text-gw-ember",
  red: "text-gw-red",
  grey: "text-gw-grey",
  neutral: "text-gw-text",
};

export function Pill({ tone = "grey", children, className, mono = false }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium", tones[tone], mono && "mono", className)}>{children}</span>;
}

export function confidenceTone(label: string): Tone {
  if (label === "High" || label === "Very high") return "orange";
  if (label === "Moderate") return "ember";
  if (label === "Low") return "red";
  return "grey";
}

/** Three-bar confidence glyph. */
export function ConfidenceBars({ level }: { level: 0 | 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-sm", i <= level ? "bg-current" : "bg-gw-track")} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

/**
 * Flat colour key for lists, pills, charts and map legends — never a glow. On the maps a signal is the
 * same flat disc in the same colour (`upsertSignalLayer`), so a legend key and its marker always match.
 */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} aria-hidden />;
}
