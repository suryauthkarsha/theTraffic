import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { LocateFixed, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { BaseMap } from "@/components/map/BaseMap";
import { COLORS, intersectionsToGeoJSON, upsertFocusRing, upsertSignalLayer } from "@/components/map/layers";
import { Dot } from "@/components/ui/pills";
import { useMediaQuery } from "@/hooks/use-mobile";
import type { Intersection } from "@/lib/data/types";
import { fmtCoord, junctionPlace, NEAREST_JUNCTION_M, osmLink, placeAt, PLACE_SOURCE_LABEL, type GrievancePlace } from "@/lib/grievance/grievance";
import { hitTolerance, pointerTypeOf, signalAt } from "@/lib/map/hit";
import { CITY_HOME } from "@/lib/map/home";
import { LOCATE_FAILURE_TEXT, locateOnce } from "@/lib/map/locate";
import { searchJunctions, SIGNAL_SEARCH_MIN_CHARS } from "@/lib/signals/search";

/** Layer ids carry the `gw-` prefix so the basemap re-tint leaves them alone. */
const JUNCTIONS = "gw-junctions";
const PLACE_RING = "gw-place";
const PLACE_MARK = "gw-place-mark";
/** Close enough to see the kerb when the map moves to a picked junction or the device position. */
const PICK_ZOOM = 16.5;

export interface PlacePickerProps {
  intersections: readonly Intersection[];
  place: GrievancePlace | null;
  onPick: (place: GrievancePlace) => void;
  onClear: () => void;
}

/**
 * Where the grievance is: tap the map to mark a spot (the nearest junction on file is named when one
 * is within 300 m), tap a dot to pick that junction, find one by name, or take the device's position —
 * asked for only at that press (`lib/map/locate`), and only if it lands inside Bengaluru; the map then
 * flies to it. Every junction on file is a dim dot; the marked place is the orange selection ring with
 * a dot at its centre.
 */
export function PlacePicker({ intersections, place, onPick, onClear }: PlacePickerProps) {
  const coarse = useMediaQuery("(pointer: coarse)");
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [styleGen, setStyleGen] = useState<number>(0);
  const [query, setQuery] = useState<string>("");
  const [locating, setLocating] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(() => new Map(intersections.map((i) => [i.id, i])), [intersections]);
  const search = useMemo(() => searchJunctions(query, intersections as Intersection[]), [query, intersections]);
  const matches = search.matches ?? [];
  const showList = query.trim().length >= SIGNAL_SEARCH_MIN_CHARS;

  // The map's click handler reads the latest values through a ref, so it is bound once per map.
  const latest = useRef({ intersections, byId, onPick, coarse });
  latest.current = { intersections, byId, onPick, coarse };

  // Every junction on file, as a dim dot: a hit target for "name this junction".
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    upsertSignalLayer(map, JUNCTIONS, intersectionsToGeoJSON(intersections as Intersection[], () => ({ color: COLORS.dim, value: null, radius: 3.5 })));
  }, [ready, styleGen, intersections]);

  // The marked place: the selection ring with a dot at its centre (empty collections clear both).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    upsertFocusRing(map, PLACE_RING, place?.point ?? null, { color: COLORS.orange });
    upsertSignalLayer(map, PLACE_MARK, {
      type: "FeatureCollection",
      features: place ? [{ type: "Feature", geometry: { type: "Point", coordinates: place.point }, properties: { id: "place", name: "", color: COLORS.orange, value: null, radius: 4.5, label: "" } }] : [],
    });
  }, [ready, styleGen, place]);

  // A junction picked by name brings the map to it (a tap is already there; the device paths move the map themselves).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !place || place.source !== "junction") return;
    map.easeTo({ center: place.point, zoom: Math.max(map.getZoom(), PICK_ZOOM), duration: 600 });
  }, [ready, place]);

  // Tap: the nearest dot within a pointer-sized tolerance names that junction; anywhere else marks the spot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: MapMouseEvent) => {
      const { intersections: all, byId: index, onPick: pick, coarse: coarseNow } = latest.current;
      const id = signalAt(map, `${JUNCTIONS}-dot`, e.point, hitTolerance(pointerTypeOf(e.originalEvent), coarseNow));
      const hit = id ? index.get(id) : undefined;
      pick(hit ? junctionPlace(hit) : placeAt([e.lngLat.lng, e.lngLat.lat], "map", all));
    };
    map.on("click", onClick);
    if (!coarse) map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [ready, coarse]);

  const locate = async () => {
    setNotice(null);
    setLocating(true);
    const result = await locateOnce();
    setLocating(false);
    if (result.ok === false) {
      setNotice(`${LOCATE_FAILURE_TEXT[result.reason]} Tap the map instead.`);
      return;
    }
    latest.current.onPick(placeAt(result.fix.point, "device", latest.current.intersections, result.fix.accuracyM));
    const map = mapRef.current;
    if (map) map.easeTo({ center: result.fix.point, zoom: Math.max(map.getZoom(), PICK_ZOOM), duration: 600 });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <label className="input-field h-11 min-w-0 flex-1">
          <Search size={15} className="text-gw-muted" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a junction" aria-label="Find a junction" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[14px] text-gw-text outline-none placeholder:text-gw-muted" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded text-gw-muted hover:text-gw-text" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        <button type="button" className="btn-secondary h-11 text-[13px] disabled:opacity-50" onClick={() => void locate()} disabled={locating} aria-busy={locating}>
          <LocateFixed size={14} className="mr-1.5" aria-hidden /> {locating ? "Locating…" : "Use my location"}
        </button>
      </div>
      {showList && (
        <ul className="card-inset mt-2 max-h-56 overflow-y-auto p-1" aria-label="Matching junctions">
          {matches.map((m) => (
            <li key={m.intersection.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(junctionPlace(m.intersection));
                  setQuery("");
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-gw-text hover:bg-gw-hover"
              >
                <Dot color={COLORS.dim} size={7} />
                <span className="min-w-0 flex-1 truncate">{m.intersection.canonical_name}</span>
                <span className="mono shrink-0 text-[11px] text-gw-muted">{fmtCoord([m.intersection.lon, m.intersection.lat])}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2.5 py-3 text-[13px] text-gw-secondary">No matches for “{query.trim()}”.</li>}
          {search.total > matches.length && (
            <li className="mono px-2.5 py-1.5 text-[11px] text-gw-muted" aria-live="polite">
              {matches.length} of {search.total} matches
            </li>
          )}
        </ul>
      )}
      {notice && (
        <p className="mt-2 text-[12px] text-gw-ember" role="status">
          {notice}
        </p>
      )}

      <div className="card-inset relative mt-3 h-[300px] overflow-hidden sm:h-[360px]">
        <BaseMap
          center={CITY_HOME.center}
          zoom={CITY_HOME.zoom}
          cooperativeGestures
          locate
          onLocate={(fix) => latest.current.onPick(placeAt(fix.point, "device", latest.current.intersections, fix.accuracyM))}
          onLoad={(m) => {
            mapRef.current = m;
            m.on("style.load", () => setStyleGen((g) => g + 1));
            setReady(true);
          }}
          ariaLabel="Map of Bengaluru — tap to mark the place"
        />
      </div>

      {/* The one instruction lives in the empty state; once a place is marked, the card is the place. */}
      <div className="card-inset mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-[13px]" aria-live="polite">
        {place ? (
          <>
            <span className="mono text-gw-text">{fmtCoord(place.point)}</span>
            <span className="text-gw-muted">
              {PLACE_SOURCE_LABEL[place.source]}
              {place.accuracyM !== null ? ` · ±${Math.round(place.accuracyM)} m` : ""}
            </span>
            {place.junction ? (
              <span className="text-gw-secondary">
                {place.junction.distanceM > 0 ? "near " : ""}
                <Link to={`/intersection/${place.junction.id}`} className="text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange">
                  {place.junction.name}
                </Link>
                {place.junction.distanceM > 0 ? ` · ${Math.round(place.junction.distanceM)} m` : ""}
              </span>
            ) : (
              <span className="text-gw-muted">no junction on file within {NEAREST_JUNCTION_M} m</span>
            )}
            <a href={osmLink(place.point)} target="_blank" rel="noopener noreferrer" className="mono text-[11px] text-gw-secondary underline decoration-gw-muted underline-offset-2 hover:text-gw-text">
              osm
            </a>
            <button type="button" onClick={onClear} className="ml-auto inline-flex min-h-[32px] items-center text-[12px] text-gw-muted hover:text-gw-text coarse:min-h-[44px]">
              Clear
            </button>
          </>
        ) : (
          <span className="text-gw-muted">Tap the map to mark the place, or a dot to name a junction.</span>
        )}
      </div>
    </div>
  );
}
