import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { normalizeCamera, type Camera } from "./normalize";
import { SURVEILLANCE_DATASET_URL, SURVEILLANCE_SCHEMA, type SurveillanceDataset } from "./snapshot";
import { reportSurveillance } from "./status";

async function fetchSnapshot(): Promise<SurveillanceDataset> {
  const res = await fetch(SURVEILLANCE_DATASET_URL);
  if (!res.ok) throw new Error(`Failed to load ${SURVEILLANCE_DATASET_URL}: ${res.status}`);
  const data = (await res.json()) as SurveillanceDataset;
  if (data?.meta?.schema !== SURVEILLANCE_SCHEMA || !Array.isArray(data.records)) throw new Error("Surveillance snapshot has an unexpected shape");
  return data;
}

/**
 * The synchronized surveillance snapshot (static, versioned). Only the Surveillance page imports this
 * module, so no other screen downloads the file; the browser never queries Overpass itself.
 */
export function useSurveillanceDataset(): UseQueryResult<SurveillanceDataset> {
  return useQuery({
    queryKey: ["dataset", "surveillance-cameras", "v1"],
    queryFn: fetchSnapshot,
    staleTime: Infinity,
  });
}

/** Every record normalized once per dataset instance. */
export function useCameras(data: SurveillanceDataset | undefined): Camera[] {
  return useMemo(() => (data ? data.records.map(normalizeCamera) : []), [data]);
}

/** Mirrors the query state into the rail's `cameras` item while the page is mounted. */
export function useSurveillanceRailReport(q: UseQueryResult<SurveillanceDataset>): void {
  const { data, isError } = q;
  useEffect(() => {
    if (isError) reportSurveillance({ state: "error", count: null, osmBase: null, syncedAt: null });
    else if (data) reportSurveillance({ state: "ok", count: data.meta.count, osmBase: data.meta.osm_base, syncedAt: data.meta.synced_at });
    else reportSurveillance({ state: "loading", count: null, osmBase: null, syncedAt: null });
  }, [data, isError]);
  useEffect(() => () => reportSurveillance(null), []);
}
