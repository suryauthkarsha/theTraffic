import { LifeBuoy } from "lucide-react";
import { Link } from "react-router-dom";

import { useSystemStatus } from "@/hooks/useSystemStatus";
import type { Tone } from "@/lib/system/status";
import { cn } from "@/lib/utils";

/** Flat status-dot fill per tone (shared with the support page's status card). */
export const TONE_DOT: Record<Tone, string> = {
  orange: "bg-gw-orange",
  ember: "bg-gw-ember",
  red: "bg-gw-red",
  grey: "bg-gw-track",
};

/**
 * Bottom system rail on every screen: IST clock, dataset, basemap (map screens). Every value is a
 * live probe result (lib/system/status) — a state the app cannot confirm reads "—" or "checking",
 * never "ok".
 */
export function StatusRail({ className, overlay = false }: { className?: string; overlay?: boolean }) {
  const { items } = useSystemStatus();
  return (
    <aside className={cn("rail", overlay ? "absolute inset-x-0 bottom-0 z-30" : "sticky bottom-0 z-30", className)} aria-label="System status">
      {items.map((it) => {
        const isClock = it.id === "clock";
        const [hh, mm, ss] = isClock ? it.value.split(":") : [];
        return (
          <span key={it.id} className="rail-item" title={it.detail}>
            <span className={cn("rail-dot", TONE_DOT[it.tone])} aria-hidden />
            <span>{it.label}</span>
            {isClock ? (
              <b aria-label={`${it.value} IST`}>
                {hh}
                <span className="blink">:</span>
                {mm}
                <span className="blink">:</span>
                {ss}
              </b>
            ) : (
              <b>{it.value}</b>
            )}
          </span>
        );
      })}
      <Link to="/support" className="rail-item ml-auto border-l border-r-0 text-gw-secondary hover:text-gw-text" title="Help, FAQ and a way to report a problem">
        <LifeBuoy size={11} aria-hidden /> support
      </Link>
    </aside>
  );
}
