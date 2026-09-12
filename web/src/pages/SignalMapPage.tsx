import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { BottomSheet, type SheetSnap } from "@/components/layout/BottomSheet";
import { BaseMap } from "@/components/map/BaseMap";
import { COLORS, delayColor, intersectionsToGeoJSON, upsertFocusRing, upsertSignalLayer } from "@/components/map/layers";
import { CoverageBadge } from "@/components/timing/CoverageBadge";
import { Dot } from "@/components/ui/pills";
import { useIsMobile, useMediaQuery } from "@/hooks/use-mobile";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useSignalModel } from "@/hooks/useSignalModel";
import { useIntersectionDataset } from "@/lib/data/dataset";
import type { Intersection } from "@/lib/data/types";
import { fmtInt } from "@/lib/format";
import type { LngLat } from "@/lib/geo";
import { hitTolerance, pointerTypeOf, signalAt } from "@/lib/map/hit";
import { CITY_HOME, sheetPadding, shouldRestoreView } from "@/lib/map/home";
import { recallSignalMapView, rememberSignalMapView } from "@/lib/map/viewMemory";
import { moveActive, nearestJunctions, searchJunctions, SIGNAL_SEARCH_MIN_CHARS } from "@/lib/signals/search";
import { COVERAGE_META, COVERAGE_ORDER, type CoverageCategory } from "@/lib/timing";
import { cn } from "@/lib/utils";

type LayerId = "timing_coverage" | "model" | "median_delay" | "p90_delay" | "p_stop" | "control_type" | "published" | "cluster_confidence" | "review";

/** Layer labels are plain words and carry no note: the legend under the controls is the only explanation. */
const LAYERS: { id: LayerId; label: string; timeDependent: boolean }[] = [
  { id: "timing_coverage", label: "Timing coverage", timeDependent: false },
  { id: "model", label: "Prediction available", timeDependent: true },
  { id: "median_delay", label: "Expected delay", timeDependent: true },
  { id: "p90_delay", label: "P90 delay", timeDependent: true },
  { id: "p_stop", label: "Stop probability", timeDependent: true },
  { id: "control_type", label: "Control type", timeDependent: false },
  { id: "published", label: "Timing plans on file", timeDependent: false },
  { id: "cluster_confidence", label: "Junction match confidence", timeDependent: false },
  { id: "review", label: "Review queue", timeDependent: false },
];
const isLayerId = (v: unknown): v is LayerId => LAYERS.some((l) => l.id === v);

type Filter = "all" | CoverageCategory | "review";
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, ...COVERAGE_ORDER.map((c) => ({ id: c as Filter, label: COVERAGE_META[c].short })), { id: "review", label: "Cluster review" }];
const isFilter = (v: unknown): v is Filter => FILTERS.some((f) => f.id === v);

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The one marker layer; every click is matched against it. */
const DOT_LAYER = "signals-dot";

/** Epoch ms for the next occurrence of weekday `dow` (0=Mon) at `minutes` past midnight IST. */
function istEpoch(dow: number, minutes: number): number {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const cur = (istNow.getUTCDay() + 6) % 7;
  const delta = (dow - cur + 7) % 7;
  const base = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + delta, 0, 0, 0) - 5.5 * 3600 * 1000;
  return base + minutes * 60_000;
}

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default function SignalMapPage() {
  usePageTitle("Signal Map");
  const dataset = useIntersectionDataset();
  const model = useSignalModel();
  const navigate = useNavigate();
  const listboxId = useId();
  const isMobile = useIsMobile();
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const navigationType = useNavigationType();
  const location = useLocation();
  // A fresh open starts on the city home; only a return — Back, or the junction page's breadcrumb and
  // "Show on map" — lands where the visitor left (user decision 2026-09-09).
  const [remembered] = useState(() => (shouldRestoreView(navigationType, location.state) ? recallSignalMapView() : null));
  const [layer, setLayer] = useState<LayerId>(() => (isLayerId(remembered?.layer) ? remembered.layer : "timing_coverage"));
  const [filter, setFilter] = useState<Filter>(() => (isFilter(remembered?.filter) ? remembered.filter : "all"));
  const [dow, setDow] = useState<number>(() => (new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay() + 6) % 7);
  const [minutes, setMinutes] = useState<number>(() => {
    const d = new Date(Date.now() + 5.5 * 3600 * 1000);
    return d.getUTCHours() * 60 + Math.floor(d.getUTCMinutes() / 5) * 5;
  });
  const [query, setQuery] = useState<string>("");
  const [active, setActive] = useState<number>(-1);
  const [listOpen, setListOpen] = useState<boolean>(false);
  const [hover, setHover] = useState<Intersection | null>(null);
  const [center, setCenter] = useState<LngLat>(remembered?.center ?? CITY_HOME.center);
  const [browseOpen, setBrowseOpen] = useState<boolean>(false);
  const [browseLimit, setBrowseLimit] = useState<number>(60);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [snap, setSnap] = useState<SheetSnap>("half");

  const at = useMemo(() => istEpoch(dow, minutes), [dow, minutes]);
  const inters = useMemo(() => dataset.data?.intersections ?? [], [dataset.data]);
  const categoryOf = useMemo(() => {
    const m = new Map<string, CoverageCategory>();
    for (const i of inters) m.set(i.id, model.coverageOf(i));
    return m;
  }, [inters, model]);
  const coverage = useMemo(() => model.summarise(inters), [inters, model]);
  const candidateDocs = useMemo(() => new Set(model.candidatePlans.keys()), [model.candidatePlans]);

  const filtered = useMemo(
    () =>
      inters.filter((i) => {
        if (filter === "all") return true;
        if (filter === "review") return i.review_needed;
        return categoryOf.get(i.id) === filter;
      }),
    [inters, filter, categoryOf],
  );

  const styled = useMemo(() => {
    if (!inters.length) return null;
    const now = Date.now();
    return intersectionsToGeoJSON(filtered, (i) => {
      const verified = model.verifiedPlanIntersections.has(i.id);
      switch (layer) {
        case "timing_coverage": {
          const c = categoryOf.get(i.id) ?? "unknown";
          const strong = c === "live_timing" || c === "verified_published" || c === "published_awaiting_review";
          return { color: COVERAGE_META[c].color, value: null, radius: strong ? 4.5 : c === "control_type_known" ? 3.5 : 3 };
        }
        case "model": {
          if (!verified) return { color: COLORS.dim, value: null, radius: 3 };
          const p = model.predict(i, null, at, now);
          if (p.level === "E") return { color: COLORS.dim, value: null, radius: 3 };
          return { color: p.mean_delay_s !== null ? COLORS.ember : NO_WINDOW, value: p.mean_delay_s, radius: 4.5 };
        }
        case "median_delay":
        case "p90_delay":
        case "p_stop": {
          if (!verified) return { color: COLORS.dim, value: null };
          const p = model.predict(i, null, at, now);
          if (layer === "p_stop") return { color: p.p_stop === null ? COLORS.dim : p.p_stop < 0.35 ? COLORS.orange : p.p_stop < 0.65 ? COLORS.ember : COLORS.red, value: p.p_stop, radius: 4.5 };
          const v = layer === "median_delay" ? p.mean_delay_s : p.p90_delay_s;
          return { color: delayColor(v, p.level), value: v, radius: 4.5 };
        }
        case "control_type": {
          const links = model.verifiedPlans.get(i.id);
          const hint = links?.[0]?.junction.control_type_hint ?? (model.decisions.controlType[i.id]?.control_type ?? i.control_type);
          return { color: hint === "unknown" ? COLORS.dim : hint === "fixed" || hint === "fixed_coordinated" ? COLORS.orange : hint === "adaptive" ? COLORS.red : COLORS.ember, value: null, radius: hint === "unknown" ? 3 : 4.5 };
        }
        case "published":
          return { color: verified ? COLORS.orange : candidateDocs.has(i.id) ? COLORS.ember : COLORS.dim, value: null, radius: verified || candidateDocs.has(i.id) ? 4.5 : 3 };
        case "cluster_confidence":
          return { color: i.cluster_confidence >= 0.8 ? COLORS.orange : i.cluster_confidence >= 0.6 ? COLORS.ember : COLORS.red, value: i.cluster_confidence };
        case "review":
          return { color: i.review_needed ? COLORS.red : COLORS.dim, value: null, radius: i.review_needed ? 5 : 2.5 };
      }
    });
  }, [inters.length, filtered, layer, at, model, candidateDocs, categoryOf]);

  const byId = useMemo(() => new Map(inters.map((i) => [i.id, i])), [inters]);

  // The dots are the only rendering of a layer — nothing blurred under or over them (user decision 2026-09-08).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !styled) return;
    upsertSignalLayer(map, "signals", styled);
  }, [ready, styled]);

  // Pointer interaction. A click or tap anywhere near a dot opens that junction's page (user decision
  // 2026-09-08): the hit is the NEAREST dot within a pointer-sized tolerance, never the exact pixel,
  // because a 3 px disc is far smaller than a fingertip. Fine pointers also get a ring + preview card
  // on hover showing exactly which junction a click would open; touch has no hover.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const under = (e: MapMouseEvent): Intersection | null => {
      const id = signalAt(map, DOT_LAYER, e.point, hitTolerance(pointerTypeOf(e.originalEvent), coarsePointer));
      return id ? byId.get(id) ?? null : null;
    };
    const onClick = (e: MapMouseEvent) => {
      const i = under(e);
      if (i) navigate(`/intersection/${i.id}`);
    };
    const onMove = (e: MapMouseEvent) => {
      const i = under(e);
      map.getCanvas().style.cursor = i ? "pointer" : "";
      setHover((prev) => (prev?.id === i?.id ? prev : i));
    };
    const onOut = () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
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
  }, [ready, byId, navigate, coarsePointer]);

  // Ring around the junction a click would open (map hover, or a hovered / focused list row).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    upsertFocusRing(map, "signal-focus", hover ? [hover.lon, hover.lat] : null, { color: COLORS.orange });
  }, [ready, hover]);

  // Remember the view (and the two control values) so Back from a junction page restores it.
  const persistView = useCallback(
    (map: MlMap | null) => {
      if (!map) return;
      const c = map.getCenter();
      rememberSignalMapView({ center: [c.lng, c.lat], zoom: map.getZoom(), layer, filter });
    },
    [layer, filter],
  );
  useEffect(() => {
    if (ready) persistView(mapRef.current);
  }, [ready, persistView]);

  /** Centre a junction in the part of the map the phone sheet leaves visible (half snap). */
  const focusOnMap = useCallback(
    (i: Intersection) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [i.lon, i.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 600, padding: sheetPadding(map.getContainer().clientHeight, isMobile) });
    },
    [isMobile],
  );
  const onSheetFocus = useCallback((t: HTMLElement) => {
    if (t.matches("input:not([type=range]), textarea, select")) setSnap("full");
  }, []);

  const search = useMemo(() => searchJunctions(query, inters), [query, inters]);
  const matches = search.matches ?? [];
  const nearest = useMemo(() => nearestJunctions(center, filtered, 8), [center, filtered]);
  const browse = useMemo(() => [...filtered].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)), [filtered]);

  useEffect(() => {
    setActive(matches.length ? 0 : -1);
  }, [matches.length, query]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setListOpen(false);
      setQuery("");
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = moveActive(active, e.key, matches.length);
      setActive(next);
      const m = matches[next];
      if (m) {
        setHover(m.intersection);
        focusOnMap(m.intersection);
      }
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      navigate(`/intersection/${matches[active].intersection.id}`);
    }
  };

  const current = LAYERS.find((l) => l.id === layer)!;
  const counts = dataset.data?.meta.counts;
  const legend = legendFor(layer);
  const card = coarsePointer || isMobile ? null : hover;
  const cardPrediction = card ? model.predict(card, null, at, Date.now()) : null;
  const cardCategory = card ? categoryOf.get(card.id) ?? "unknown" : null;
  const showList = listOpen && query.trim().length >= SIGNAL_SEARCH_MIN_CHARS;

  /** A list row: opens the junction page; on a fine pointer, hovering or focusing it rings the dot on the map. */
  const rowProps = (i: Intersection) => ({
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(i),
    onBlur: () => setHover(null),
  });

  const eyebrow = (
    <div className="eyebrow">
      <b>01</b> · signal map · {fmtInt(inters.length)} junctions
    </div>
  );

  const controls = (
    <>
      {dataset.isError && (
        <div role="alert" className="card-inset border-gw-red/50 p-3 text-[13px] text-gw-secondary">
          Signal data could not be loaded.{" "}
          <button type="button" className="text-gw-orange underline underline-offset-2" onClick={() => void dataset.refetch()}>
            Try again
          </button>
        </div>
      )}
      <div className="relative">
        <label className="input-field h-11">
          <Search size={15} className="text-gw-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={onSearchKey}
            placeholder="Find a junction"
            className="flex-1 bg-transparent text-[14px] text-gw-text outline-none placeholder:text-gw-muted"
            role="combobox"
            aria-label="Find a junction"
            aria-expanded={showList}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listboxId}-${active}` : undefined}
            aria-describedby={`${listboxId}-help`}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded text-gw-muted hover:text-gw-text" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <p id={`${listboxId}-help`} className="sr-only">
          Arrow keys move through the matches, Enter opens the junction.
        </p>
        {showList && (
          <ul id={listboxId} role="listbox" aria-label="Matching junctions" className="card-inset mt-2 max-h-64 overflow-y-auto p-1">
            {matches.map((m, i) => (
              <li key={m.intersection.id} id={`${listboxId}-${i}`} role="option" aria-selected={i === active}>
                <Link
                  to={`/intersection/${m.intersection.id}`}
                  tabIndex={-1}
                  onMouseEnter={() => {
                    setActive(i);
                    setHover(m.intersection);
                  }}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => focusOnMap(m.intersection)}
                  className={cn("flex min-h-[44px] items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-gw-text", i === active ? "bg-gw-hover" : "hover:bg-gw-hover")}
                >
                  <Dot color={COVERAGE_META[categoryOf.get(m.intersection.id) ?? "unknown"].color} size={7} />
                  <span className="min-w-0 flex-1 truncate">{m.intersection.canonical_name}</span>
                  <span className="mono shrink-0 text-[11px] text-gw-muted">{COVERAGE_META[categoryOf.get(m.intersection.id) ?? "unknown"].short.toLowerCase()}</span>
                  <ArrowRight size={12} className="shrink-0 text-gw-muted" aria-hidden />
                </Link>
              </li>
            ))}
            {matches.length === 0 && (
              <li role="option" aria-selected={false} aria-disabled className="px-2.5 py-3 text-[13px] text-gw-secondary">
                No matches for “{query.trim()}”.
              </li>
            )}
            {search.total > matches.length && (
              <li className="mono px-2.5 py-1.5 text-[11px] text-gw-muted" aria-live="polite">
                {matches.length} of {search.total} matches
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={cn("chip min-h-[32px] hover:text-gw-text", filter === f.id && "border-gw-orange/50 text-gw-text")}>
            {f.label}
          </button>
        ))}
        <span className="mono ml-auto self-center text-[11px] text-gw-muted">{fmtInt(filtered.length)} shown</span>
      </div>

      {!showList && (
        <div>
          <div className="label">Near the map centre</div>
          <ul className="mt-1.5 space-y-0.5" aria-label="Junctions near the map centre">
            {nearest.map(({ intersection: i, distance_m }) => (
              <li key={i.id}>
                <Link to={`/intersection/${i.id}`} {...rowProps(i)} className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-[13px] text-gw-text hover:bg-gw-hover">
                  <Dot color={COVERAGE_META[categoryOf.get(i.id) ?? "unknown"].color} size={7} />
                  <span className="min-w-0 flex-1 truncate">{i.canonical_name}</span>
                  <span className="mono shrink-0 text-[11px] text-gw-muted">{distance_m < 950 ? `${Math.round(distance_m / 10) * 10} m` : `${(distance_m / 1000).toFixed(1)} km`}</span>
                  <ArrowRight size={12} className="shrink-0 text-gw-muted" aria-hidden />
                </Link>
              </li>
            ))}
            {nearest.length === 0 && <li className="px-2 py-2 text-[13px] text-gw-secondary">Nothing matches this filter.</li>}
          </ul>
          <button type="button" className="mt-1.5 flex min-h-[44px] w-full items-center justify-between rounded-md px-2 text-[13px] text-gw-secondary hover:bg-gw-hover hover:text-gw-text" aria-expanded={browseOpen} aria-controls={`${listboxId}-browse`} onClick={() => setBrowseOpen((v) => !v)}>
            <span>All {fmtInt(browse.length)} junctions A–Z</span>
            <ChevronDown size={14} className={cn("transition-transform", browseOpen && "rotate-180")} aria-hidden />
          </button>
          {browseOpen && (
            <div id={`${listboxId}-browse`}>
              <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1" aria-label="All junctions">
                {browse.slice(0, browseLimit).map((i) => (
                  <li key={i.id}>
                    <Link to={`/intersection/${i.id}`} {...rowProps(i)} className="flex min-h-[44px] items-center gap-2 rounded-md px-2 text-[13px] text-gw-text hover:bg-gw-hover">
                      <Dot color={COVERAGE_META[categoryOf.get(i.id) ?? "unknown"].color} size={7} />
                      <span className="min-w-0 flex-1 truncate">{i.canonical_name}</span>
                      <ArrowRight size={12} className="shrink-0 text-gw-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {browse.length > browseLimit && (
                <button type="button" className="btn-secondary mt-1.5 h-10 w-full text-[13px]" onClick={() => setBrowseLimit((n) => n + 120)}>
                  Show {Math.min(120, browse.length - browseLimit)} more
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="label mb-1.5">Layer</div>
        <select value={layer} onChange={(e) => setLayer(e.target.value as LayerId)} className="h-11 w-full rounded-[4px] border border-gw-border bg-gw-card px-3 text-[14px] text-gw-text outline-none focus:border-gw-orange" aria-label="Map layer">
          {LAYERS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className={current.timeDependent ? "" : "opacity-50"}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Time of week (IST)</span>
          <span className="mono text-[13px] text-gw-text">
            {DAYS[dow]} {hhmm(minutes)}
          </span>
        </div>
        <input type="range" min={0} max={1439} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-11 w-full accent-gw-orange" aria-label="Time of day" disabled={!current.timeDependent} />
        <div className="segment mt-2 w-full justify-between" role="group" aria-label="Day of week">
          {DAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={dow === i} onClick={() => setDow(i)} className="flex-1 !px-1" disabled={!current.timeDependent}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="card-inset p-3 text-[12.5px]">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-gw-secondary">
              <Dot color={l.color} size={9} /> {l.label}
            </span>
          ))}
        </div>
        <div className="mt-2 text-gw-muted">Colour shows what we know about a junction — never the live light.</div>
      </div>
    </>
  );

  // One mono line: the eyebrow already carries the junction count.
  const countsBlock = (
    <div className="mono text-gw-secondary">
      <span className="text-gw-orange">{fmtInt(coverage.verified_published)}</span> accepted plans · {fmtInt(coverage.by_category.published_awaiting_review)} awaiting review · {fmtInt(coverage.location_only)} location only
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
          onMoveEnd={(m) => {
            const c = m.getCenter();
            setCenter([c.lng, c.lat]);
            persistView(m);
          }}
          mobileControls={isMobile}
          locate
          ariaLabel="City signal map — tap a dot to open its junction"
        />

        {isMobile ? (
          <BottomSheet snap={snap} onSnapChange={setSnap} label="Signal map controls" header={eyebrow} peekHeight={64} halfFraction={0.5} onBodyFocus={onSheetFocus}>
            <div className="flex flex-col gap-3">
              {controls}
              <div className="card-inset p-3 text-[12.5px]">{countsBlock}</div>
            </div>
          </BottomSheet>
        ) : (
          <>
            <section className="panel panel-hud absolute left-4 top-4 flex max-h-[calc(100dvh-7.5rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto p-4 sm:left-6 sm:top-6" aria-label="Signal map controls">
              <div className="-mb-1">{eyebrow}</div>
              {controls}
            </section>

            {card && cardPrediction && cardCategory && (
              <div className="panel pointer-events-none absolute right-4 top-4 w-[300px] max-w-[calc(100vw-2rem)] p-3 text-[13px] sm:right-6 sm:top-6" role="status" aria-live="polite">
                <div className="font-semibold text-gw-text">{card.canonical_name}</div>
                <div className="mt-1.5">
                  <CoverageBadge category={cardCategory} />
                </div>
                <div className="mono mt-1.5 text-gw-secondary">
                  {card.approaches.length} approaches
                  {cardPrediction.plan?.mode === "timed" ? ` · C ${cardPrediction.plan.cycle_s} s` : ""}
                </div>
                {cardPrediction.mean_delay_s !== null && (
                  <div className="mono text-gw-text">
                    E[delay] ~{Math.round(cardPrediction.mean_delay_s)} s · P(stop) {cardPrediction.p_stop?.toFixed(2)} at {DAYS[dow]} {hhmm(minutes)}
                  </div>
                )}
              </div>
            )}

            <div className="panel absolute bottom-4 right-14 hidden max-w-[520px] p-3 text-[12.5px] md:block">{countsBlock}</div>
          </>
        )}
      </div>
    </AppShell>
  );
}

/** An accepted plan is on file but covers no window at the chosen time: between ember and dim. */
const NO_WINDOW = "#A0561F";

function legendFor(layer: LayerId): { color: string; label: string }[] {
  switch (layer) {
    case "timing_coverage":
      return COVERAGE_ORDER.map((c) => ({ color: COVERAGE_META[c].color, label: COVERAGE_META[c].label.toLowerCase() }));
    case "model":
      return [
        { color: COLORS.ember, label: "from an accepted timing plan" },
        { color: NO_WINDOW, label: "plan on file, no window now" },
        { color: COLORS.dim, label: "no prediction" },
      ];
    case "median_delay":
    case "p90_delay":
      return [
        { color: COLORS.orange, label: "< 25 s" },
        { color: COLORS.ember, label: "25–60 s" },
        { color: COLORS.red, label: "> 60 s" },
        { color: COLORS.dim, label: "no prediction" },
      ];
    case "p_stop":
      return [
        { color: COLORS.orange, label: "< 0.35" },
        { color: COLORS.ember, label: "0.35–0.65" },
        { color: COLORS.red, label: "> 0.65" },
        { color: COLORS.dim, label: "no prediction" },
      ];
    case "control_type":
      return [
        { color: COLORS.orange, label: "fixed / coordinated" },
        { color: COLORS.ember, label: "vehicle-actuated / time-of-day" },
        { color: COLORS.red, label: "adaptive" },
        { color: COLORS.dim, label: "unknown" },
      ];
    case "published":
      return [
        { color: COLORS.orange, label: "accepted timing plan" },
        { color: COLORS.ember, label: "plan awaiting review" },
        { color: COLORS.dim, label: "none on file" },
      ];
    case "cluster_confidence":
      return [
        { color: COLORS.orange, label: "≥ 0.80" },
        { color: COLORS.ember, label: "0.60–0.79" },
        { color: COLORS.red, label: "< 0.60" },
      ];
    case "review":
      return [
        { color: COLORS.red, label: "review needed" },
        { color: COLORS.dim, label: "not flagged" },
      ];
    default:
      return [{ color: COLORS.dim, label: "insufficient data" }];
  }
}
