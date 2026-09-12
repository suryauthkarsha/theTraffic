import { Moon, Satellite } from "lucide-react";

import { BASEMAP_MODES, useBasemapMode, type BasemapMode } from "@/lib/map/basemap";
import { cn } from "@/lib/utils";

const ICON: Record<BasemapMode, typeof Moon> = { dark: Moon, satellite: Satellite };

/**
 * Dark / Satellite control shown on every interactive map. `compact` renders it as a 30 px-wide
 * vertical stack that docks above MapLibre's zoom control. The choice is shared across maps and
 * persisted (lib/map/basemap); imagery attribution appears in the map's attribution control.
 */
export function BasemapToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [mode, setMode] = useBasemapMode();
  return (
    <div className={cn("panel flex p-0.5", compact ? "flex-col" : "items-center", className)} role="group" aria-label="Basemap">
      {BASEMAP_MODES.map((m) => {
        const Icon = ICON[m.id];
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={active}
            aria-label={`${m.label} basemap`}
            title={`${m.label} — ${m.description}`}
            className={cn("flex items-center justify-center gap-1.5 rounded-[3px] text-[12px] transition-colors", compact ? "h-[30px] w-[30px]" : "h-9 min-w-[44px] px-2.5", active ? "bg-gw-track text-gw-text" : "text-gw-secondary hover:text-gw-text")}
          >
            <Icon size={13} className={active ? "text-gw-orange" : undefined} aria-hidden />
            {!compact && <span>{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
