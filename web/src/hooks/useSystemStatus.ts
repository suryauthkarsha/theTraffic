import { useEffect, useMemo, useState } from "react";

import { useIntersectionDataset } from "@/lib/data/dataset";
import { useBasemapMode } from "@/lib/map/basemap";
import { useBasemapReport } from "@/lib/map/basemapStatus";
import { useSurveillanceReport } from "@/lib/surveillance/status";
import { BUILD_STAMP, railItems, type RailItem, type StatusInputs } from "@/lib/system/status";

/** Ticks once a second (only while mounted). */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Everything the status rail and the support page show, computed from live probes — never guessed. */
export function useSystemStatus(): { items: RailItem[]; inputs: StatusInputs } {
  const now = useClock();
  const dataset = useIntersectionDataset();
  const [sharedMode] = useBasemapMode();
  const basemap = useBasemapReport();
  // The mounted map's own mode wins: the junction page pins satellite whatever the shared toggle says.
  const mode = basemap.mode ?? sharedMode;
  const health = basemap.health;
  // Reported by the Surveillance page while it is mounted; no other screen loads that snapshot.
  const cameras = useSurveillanceReport();

  const inputs = useMemo<StatusInputs>(
    () => ({
      nowMs: now,
      dataset: dataset.data ? { version: dataset.data.meta.version ?? "v1", osmBase: dataset.data.meta.source.osm_timestamp_base.slice(0, 10), intersections: dataset.data.meta.counts.logical_intersections, nodes: dataset.data.meta.counts.source_signal_nodes } : null,
      basemap: { mode, health },
      build: BUILD_STAMP,
      cameras: cameras.state === "none" ? null : { state: cameras.state, count: cameras.count, osmBase: cameras.osmBase, syncedAt: cameras.syncedAt },
    }),
    [now, dataset.data, mode, health, cameras],
  );

  const items = useMemo(() => railItems(inputs), [inputs]);
  return { items, inputs };
}
