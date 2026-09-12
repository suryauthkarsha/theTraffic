import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { BottomSheet, type SheetSnap } from "@/components/layout/BottomSheet";
import { BaseMap } from "@/components/map/BaseMap";
import { cameraAt, camerasToGeoJSON, clusterAt, clusterExpansionZoom, setCameraView, toleranceFor, upsertCameraLayers, type CameraLayerData } from "@/components/map/cameraLayers";
import { COLORS, upsertFocusRing } from "@/components/map/layers";
import { CameraDetail } from "@/components/surveillance/CameraDetail";
import { CameraGlyph, ClusterGlyph } from "@/components/surveillance/CameraGlyph";
import { Dot } from "@/components/ui/pills";
import { useIsMobile, useMediaQuery } from "@/hooks/use-mobile";
import { usePageTitle } from "@/hooks/usePageTitle";
import { fmtDate, fmtInt } from "@/lib/format";
import { CITY_HOME, sheetPadding, shouldRestoreView } from "@/lib/map/home";
import { useCameras, useSurveillanceDataset, useSurveillanceRailReport } from "@/lib/surveillance/dataset";
import { activeFilterCount, applyFilters, DEFAULT_FILTERS, facetCounts, FILTER_GROUPS, type CameraFilters, type FilterGroupId } from "@/lib/surveillance/filters";
import { DENSITY_RAMP, densityGrid, directionCones } from "@/lib/surveillance/geometry";
import { CREDIT, OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from "@/lib/surveillance/normalize";
import { recallSurveillanceView, rememberSurveillanceView, type CameraView } from "@/lib/surveillance/viewMemory";
import { cn } from "@/lib/utils";

/** Zoom the map goes to when a record is chosen from a URL or on a phone. */
const FOCUS_ZOOM = 16.5;
const EMPTY: GeoJSON.FeatureCollection<GeoJSON.Polygon> = { type: "FeatureCollection", features: [] };
/** A snapshot older than this is called stale on the page and the rail. */
export const STALE_AFTER_DAYS = 30;

const VIEWS: { id: CameraView; label: string }[] = [
  { id: "clusters", label: "Clusters" },
  { id: "density", label: "Density" },
];

/** `?camera=<osm node id>`; anything else is no selection. */
export function parseCameraParam(v: string | null): number | null {
  return v && /^\d{1,12}$/.test(v) ? Number(v) : null;
}

/**
 * Surveillance (`/surveillance`): every `man_made=surveillance` record contributors have mapped in
 * OpenStreetMap inside the Bengaluru boundary, from the synchronized snapshot. A tap on a glyph opens
 * that record's panel; a tap on a cluster zooms into it. Filters read the OSM tags as typed. Nothing
 * on this screen says a camera is on, recording, police-owned or making anywhere safer — the legend
 * says so once.
 */
export default function SurveillancePage() {
  usePageTitle("Surveillance");
  const dataset = useSurveillanceDataset();
  useSurveillanceRailReport(dataset);
  const cameras = useCameras(dataset.data);
  const isMobile = useIsMobile();
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const [params, setParams] = useSearchParams();
  const selectedId = parseCameraParam(params.get("camera"));
  const uid = useId();
  const navigationType = useNavigationType();
  const location = useLocation();

  // A fresh open starts on the city home; only Back / Forward lands where the visitor left (user decision 2026-09-09).
  const [remembered] = useState(() => (shouldRestoreView(navigationType, location.state) ? recallSurveillanceView() : null));
  const [view, setView] = useState<CameraView>(() => remembered?.view ?? "clusters");
  const [filters, setFilters] = useState<CameraFilters>(() => remembered?.filters ?? { ...DEFAULT_FILTERS });
  const [cones, setCones] = useState<boolean>(true);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const flownTo = useRef<number | null>(null);

  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  const selected = selectedId !== null ? byId.get(selectedId) ?? null : null;
  const filtered = useMemo(() => applyFilters(cameras, filters), [cameras, filters]);
  const counts = useMemo(() => facetCounts(cameras, filters), [cameras, filters]);
  const shown = useMemo(() => {
    let operator = 0;
    let direction = 0;
    for (const c of filtered) {
      if (c.operator) operator++;
      if (c.directions.length) direction++;
    }
    return { operator, direction };
  }, [filtered]);

  const layerData = useMemo<CameraLayerData | null>(() => {
    if (!dataset.data) return null;
    return { points: camerasToGeoJSON(filtered), grid: view === "density" ? densityGrid(filtered) : EMPTY, cones: cones ? directionCones(filtered) : EMPTY };
  }, [dataset.data, filtered, view, cones]);

  // Layers follow the data; if the basemap style is ever swapped (the plain-canvas fallback), they are put back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !layerData) return;
    const apply = () => upsertCameraLayers(map, layerData, view, cones);
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [ready, layerData, view, cones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setCameraView(map, view, cones);
  }, [ready, view, cones]);

  const select = useCallback(
    (id: number | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete("camera");
          else next.set("camera", String(id));
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  // Pointer interaction: the nearest glyph within a pointer-sized tolerance opens its record (a glyph
  // is smaller than a fingertip); a cluster disc is big enough for an exact hit and zooms in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: MapMouseEvent) => {
      const cluster = clusterAt(map, e.point);
      if (cluster) {
        void clusterExpansionZoom(map, cluster.clusterId).then((zoom) => map.easeTo({ center: cluster.center, zoom, duration: 500 }));
        return;
      }
      const id = cameraAt(map, e.point, toleranceFor(e.originalEvent, coarsePointer));
      if (id !== null) {
        flownTo.current = id;
        select(id);
        if (isMobile) setSnap("half");
      }
    };
    const onMove = (e: MapMouseEvent) => {
      const overCluster = clusterAt(map, e.point) !== null;
      const id = overCluster ? null : cameraAt(map, e.point, toleranceFor(e.originalEvent, coarsePointer));
      map.getCanvas().style.cursor = overCluster || id !== null ? "pointer" : "";
      setHoverId((prev) => (prev === id ? prev : id));
    };
    const onOut = () => {
      map.getCanvas().style.cursor = "";
      setHoverId(null);
    };
    map.on("click", onClick);
    if (!coarsePointer) {
      map.on("mousemove", onMove);
      map.on("mouseout", onOut);
    }
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
    };
  }, [ready, coarsePointer, isMobile, select]);

  // Rings: orange around the chosen record, warm white around the one a click would open.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    upsertFocusRing(map, "gw-camera-focus", selected ? [selected.lon, selected.lat] : null, { color: COLORS.orange });
  }, [ready, selected]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const h = hoverId !== null && hoverId !== selectedId ? byId.get(hoverId) : null;
    upsertFocusRing(map, "gw-camera-hover", h ? [h.lon, h.lat] : null, { color: COLORS.text });
  }, [ready, hoverId, selectedId, byId]);

  // A record chosen from a link (or Back) is brought into view; one chosen by a tap on the map is
  // already in view — on a phone it is moved into the half the sheet leaves open.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selected) return;
    const fromMap = flownTo.current === selected.id;
    flownTo.current = null;
    if (fromMap && !isMobile) return;
    map.easeTo({ center: [selected.lon, selected.lat], zoom: fromMap ? map.getZoom() : Math.max(map.getZoom(), FOCUS_ZOOM), duration: 500, padding: sheetPadding(map.getContainer().clientHeight, isMobile) });
  }, [ready, selected, isMobile]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, select]);

  const persistView = useCallback(
    (map: MlMap | null) => {
      if (!map) return;
      const c = map.getCenter();
      rememberSurveillanceView({ center: [c.lng, c.lat], zoom: map.getZoom(), view, filters });
    },
    [view, filters],
  );
  useEffect(() => {
    if (ready) persistView(mapRef.current);
  }, [ready, persistView]);

  const onSheetFocus = useCallback((t: HTMLElement) => {
    if (t.matches("input:not([type=range]):not([type=checkbox]), textarea, select")) setSnap("full");
  }, []);

  const setFilter = (group: FilterGroupId, value: string) => setFilters((f) => ({ ...f, [group]: value }));
  const active = activeFilterCount(filters);
  const meta = dataset.data?.meta;
  const ageDays = meta ? Math.floor((Date.now() - Date.parse(meta.synced_at)) / 86_400_000) : null;
  const stale = ageDays !== null && ageDays > STALE_AFTER_DAYS;

  const eyebrow = (
    <div className="eyebrow">
      <b>02</b> · surveillance · {dataset.data ? `${fmtInt(cameras.length)} records` : dataset.isError ? "unavailable" : "loading"}
    </div>
  );

  const controls = (
    <>
      {dataset.isError && (
        <div role="alert" className="card-inset border-gw-red/50 p-3 text-[13px] text-gw-secondary">
          Camera data could not be loaded.{" "}
          <button type="button" className="text-gw-orange underline underline-offset-2" onClick={() => void dataset.refetch()}>
            Try again
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segment" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className="min-h-[36px]">
              {v.label}
            </button>
          ))}
        </div>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[13px] text-gw-secondary">
          <input type="checkbox" checked={cones} onChange={(e) => setCones(e.target.checked)} className="h-4 w-4 accent-gw-orange" />
          Direction cones
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Filters">
        {FILTER_GROUPS.map((g) => (
          <div key={g.id} className="min-w-0">
            <label htmlFor={`${uid}-${g.id}`} className="label mb-1 block" title={g.key}>
              {g.label}
            </label>
            <select id={`${uid}-${g.id}`} value={filters[g.id]} onChange={(e) => setFilter(g.id, e.target.value)} className={cn("h-10 w-full rounded-[4px] border bg-gw-card px-2 text-[13px] text-gw-text outline-none focus:border-gw-orange", filters[g.id] === "all" ? "border-gw-border" : "border-gw-orange/50")}>
              <option value="all">All</option>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · {fmtInt(counts[g.id][o.id] ?? 0)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex min-h-[24px] items-center justify-between gap-2 text-[12px]">
        {active > 0 ? (
          <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS })} className="text-gw-secondary underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
            Reset {active} {active === 1 ? "filter" : "filters"}
          </button>
        ) : (
          <span />
        )}
        <span className="mono text-gw-muted">{fmtInt(filtered.length)} shown</span>
      </div>

      <div className="card-inset p-3 text-[12.5px]">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-gw-secondary">
            <CameraGlyph size={15} /> a mapped record
          </span>
          {view === "clusters" ? (
            <span className="flex items-center gap-1.5 text-gw-secondary">
              <ClusterGlyph size={15} /> several, zoom in
            </span>
          ) : (
            <>
              {DENSITY_RAMP.map((s, i) => (
                <span key={s.from} className="mono flex items-center gap-1.5 text-gw-secondary">
                  <Dot color={s.color} size={9} /> {i === DENSITY_RAMP.length - 1 ? `${s.from}+` : `${s.from}–${DENSITY_RAMP[i + 1].from - 1}`}
                </span>
              ))}
              <span className="text-gw-secondary">records per 500 m cell</span>
            </>
          )}
          <span className="flex items-center gap-1.5 text-gw-secondary">
            <span className="inline-block h-[9px] w-[9px] shrink-0 border border-gw-orange bg-gw-orange/20" aria-hidden /> viewing direction
          </span>
        </div>
        <div className="mt-2 text-gw-muted">A mark means someone mapped a camera here — never that it is on, recording, or who watches it.</div>
      </div>

      <div className="mono text-[11px] leading-relaxed text-gw-muted">
        {meta ? (
          <>
            osm {meta.osm_base.slice(0, 10)} · synced {fmtDate(meta.synced_at)}
            {stale && <span className="text-gw-ember"> · stale, {ageDays} days</span>}
            {" · "}
          </>
        ) : null}
        <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
          {OSM_ATTRIBUTION}
        </a>
        {" · after "}
        <a href={CREDIT.url} target="_blank" rel="noopener noreferrer" className="underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
          {CREDIT.name}
        </a>
      </div>
    </>
  );

  const countsBlock = (
    <div className="mono text-gw-secondary">
      <span className="text-gw-orange">{fmtInt(filtered.length)}</span> shown · {fmtInt(shown.operator)} operator mapped · {fmtInt(shown.direction)} direction mapped
    </div>
  );

  return (
    <AppShell mapScreen>
      <div className="relative h-full w-full">
        <BaseMap
          className="h-full w-full"
          center={remembered?.center ?? CITY_HOME.center}
          zoom={remembered?.zoom ?? CITY_HOME.zoom}
          onLoad={(m) => {
            // On a phone the sheet covers the lower half: the centre moves up into the open half.
            if (isMobile) m.setPadding(sheetPadding(m.getContainer().clientHeight, true));
            mapRef.current = m;
            setReady(true);
          }}
          onMoveEnd={(m) => persistView(m)}
          mobileControls={isMobile}
          locate
          ariaLabel="City surveillance map — tap a camera to open its record"
        />

        {isMobile ? (
          <BottomSheet snap={snap} onSnapChange={setSnap} label="Surveillance map controls" header={eyebrow} peekHeight={64} halfFraction={0.5} onBodyFocus={onSheetFocus} scrollTopKey={selected?.id ?? null}>
            {selected ? (
              <CameraDetail camera={selected} onClose={() => select(null)} />
            ) : (
              <div className="flex flex-col gap-3">
                {controls}
                <div className="card-inset p-3 text-[12.5px]">{countsBlock}</div>
              </div>
            )}
          </BottomSheet>
        ) : (
          <>
            <section className="panel panel-hud absolute left-4 top-4 flex max-h-[calc(100dvh-7.5rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto p-4 sm:left-6 sm:top-6" aria-label="Surveillance map controls">
              <div className="-mb-1">{eyebrow}</div>
              {controls}
            </section>

            {selected && (
              <div className="panel absolute right-4 top-4 max-h-[calc(100dvh-7.5rem)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto p-4 sm:right-6 sm:top-6">
                <CameraDetail camera={selected} onClose={() => select(null)} />
              </div>
            )}

            <div className="panel absolute bottom-4 right-14 hidden max-w-[520px] p-3 text-[12.5px] md:block">{countsBlock}</div>
          </>
        )}
      </div>
    </AppShell>
  );
}

