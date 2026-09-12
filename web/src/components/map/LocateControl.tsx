import type { Map as MlMap } from "maplibre-gl";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LOCATE_FAILURE_TEXT, locateOnce, locateZoom, upsertLocateMarker, type LocationFix } from "@/lib/map/locate";
import { cn } from "@/lib/utils";

export interface LocateControlProps {
  /** The mounted map; the control is inert until it exists. */
  map: MlMap | null;
  className?: string;
  /** Called with every fix shown (a page may mark a place from it). */
  onFix?: (fix: LocationFix) => void;
  /** Called with the one-sentence reason a fix was refused; null clears an earlier one. */
  onNotice?: (text: string | null) => void;
}

/**
 * The "where am I" button for every city map (user request 2026-09-11): one position request at the
 * press, then the map flies to the fix and marks it — a warm-white disc with a black casing and a
 * hairline ring for the reported accuracy. Same 30 px stack as the Dark / Satellite toggle it sits
 * beside; 44 px on touch screens. Nothing is watched, nothing is kept.
 */
export function LocateControl({ map, className, onFix, onNotice }: LocateControlProps) {
  const [busy, setBusy] = useState<boolean>(false);
  const fixRef = useRef<LocationFix | null>(null);
  const alive = useRef<boolean>(true);

  // The marker survives a style reload (the plain-canvas fallback replaces every layer).
  useEffect(() => {
    alive.current = true;
    if (!map) return;
    const redraw = () => {
      if (fixRef.current) upsertLocateMarker(map, fixRef.current);
    };
    map.on("style.load", redraw);
    return () => {
      alive.current = false;
      map.off("style.load", redraw);
    };
  }, [map]);

  const locate = async () => {
    if (!map || busy) return;
    onNotice?.(null);
    setBusy(true);
    const result = await locateOnce();
    if (!alive.current) return;
    setBusy(false);
    if (result.ok === false) {
      onNotice?.(LOCATE_FAILURE_TEXT[result.reason]);
      return;
    }
    fixRef.current = result.fix;
    try {
      upsertLocateMarker(map, result.fix);
    } catch {
      /* the style is mid-reload: the style.load handler redraws it */
    }
    map.flyTo({ center: result.fix.point, zoom: locateZoom(result.fix.accuracyM, map.getZoom()), duration: 900, essential: true });
    onFix?.(result.fix);
  };

  return (
    <div className={cn("panel flex p-0.5", className)} role="group" aria-label="Location">
      <button type="button" onClick={() => void locate()} disabled={!map || busy} aria-busy={busy} aria-label="Show my location" title="Show my location" className={cn("flex h-[30px] w-[30px] items-center justify-center rounded-[3px] text-gw-secondary transition-colors hover:text-gw-text disabled:opacity-60 coarse:h-[44px] coarse:w-[44px]", busy && "text-gw-orange")}>
        <LocateFixed size={14} className={busy ? "pulse-dot" : undefined} aria-hidden />
      </button>
    </div>
  );
}
