import { AttributionControl, Map as MlMap, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { BENGALURU_CENTER, type LngLat } from "@/lib/geo";
import { applyBasemapMode, getBasemapMode, subscribeBasemapMode, type BasemapMode, type ImageryTone } from "@/lib/map/basemap";
import { reportBasemapHealth } from "@/lib/map/basemapStatus";
import type { LocationFix } from "@/lib/map/locate";
import { cn } from "@/lib/utils";

import { BasemapToggle } from "./BasemapToggle";
import { LocateControl } from "./LocateControl";

/** How long a refused location's one sentence stays on the map. */
const LOCATE_NOTICE_MS = 6_000;

/**
 * MapLibre wrapper. Basemap: OpenFreeMap "dark" vector style (free, keyless, OSM data) unless
 * VITE_MAP_STYLE_URL overrides it. After every style load the basemap is re-tinted for the active
 * mode (dark tint, or satellite imagery under the vector roads and labels — see lib/map/basemap):
 * the shared Dark / Satellite choice, or the mode a screen pins with `fixedBasemap`.
 *
 * Readiness is announced on `style.load` (style JSON parsed, sources and layers set up), NOT on
 * `load`, which additionally waits for every tile in view and never fires when tiles cannot be
 * fetched or parsed — the app's own layers (signals, routes) must not depend on the basemap host.
 * If the style itself cannot be fetched, a plain-canvas fallback style keeps the app usable and the
 * user is told so.
 */
const STYLE_URL: string = import.meta.env.VITE_MAP_STYLE_URL?.trim() || "https://tiles.openfreemap.org/styles/dark";

/** Glyphs for our own symbol layers (route numbers) when the fallback style is in force. */
const FALLBACK_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Used when the basemap style cannot be fetched: our layers render on a plain canvas. */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "thetraffic-fallback",
  sources: {},
  glyphs: FALLBACK_GLYPHS,
  layers: [{ id: "background", type: "background", paint: { "background-color": "#050505" } }],
};

/** How long the style JSON may take before the plain-canvas fallback replaces it. */
export const STYLE_TIMEOUT_MS = 12_000;
/** How long tiles may stay pending after the style parsed before the user is told. */
export const TILE_WATCHDOG_MS = 15_000;

export type BasemapStatus = "loading" | "ok" | "tiles_pending" | "style_failed" | "webgl_failed";

const NOTICE: Record<BasemapStatus, string | null> = {
  loading: null,
  ok: null,
  tiles_pending: "Map tiles not loading — the signals still draw",
  style_failed: "Map unavailable — signals only",
  webgl_failed: "No map: WebGL is off in this browser",
};

export interface BaseMapProps {
  center?: LngLat;
  zoom?: number;
  interactive?: boolean;
  className?: string;
  onLoad?: (map: MlMap) => void;
  onMoveEnd?: (map: MlMap) => void;
  onBasemapStatus?: (status: BasemapStatus) => void;
  showNav?: boolean;
  /** Dark / Satellite control docked above the zoom buttons (defaults to `showNav`, never shown on a pinned map). */
  showBasemapToggle?: boolean;
  /**
   * Pin this map to one basemap whatever the shared Dark / Satellite choice says (the junction page
   * always shows imagery). The toggle is hidden and the shared choice is left untouched. Read once, at mount.
   */
  fixedBasemap?: BasemapMode;
  /** Imagery exposure in satellite mode: `standard` (city map) or `dim` (junction page). Read once, at mount. */
  imagery?: ImageryTone;
  /** Dark vignette over the map edges so floating panels read against imagery. */
  vignette?: boolean;
  /**
   * Phone layout: the bottom sheet owns the bottom edge, so MapLibre's zoom buttons go (pinch
   * zooms), attribution docks top-left and the basemap toggle top-right. Read once, at mount.
   */
  mobileControls?: boolean;
  /**
   * For a small map inside a scrolling page: one finger scrolls the page (two pan the map) and the
   * wheel scrolls the page (Ctrl / ⌘ + wheel zooms), so the map never traps the visitor. Read once, at mount.
   */
  cooperativeGestures?: boolean;
  /**
   * The "show my location" control (user request 2026-09-11): one position request at the press, then
   * the map flies to the fix and marks it. Docked with the Dark / Satellite toggle.
   */
  locate?: boolean;
  /** Every fix the locate control shows. */
  onLocate?: (fix: LocationFix) => void;
  ariaLabel?: string;
}

export function BaseMap({ center = BENGALURU_CENTER, zoom = 11.2, interactive = true, className, onLoad, onMoveEnd, onBasemapStatus, showNav = true, showBasemapToggle, fixedBasemap, imagery = "standard", vignette = true, mobileControls = false, cooperativeGestures = false, locate = false, onLocate, ariaLabel = "Map of Bengaluru" }: BaseMapProps) {
  const toggle = fixedBasemap ? false : showBasemapToggle ?? (interactive && showNav);
  const onLocateRef = useRef(onLocate);
  onLocateRef.current = onLocate;
  // The locate control needs the map as state (a ref would not re-render it once the map exists).
  const [mapObj, setMapObj] = useState<MlMap | null>(null);
  const [locateNotice, setLocateNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!locateNotice) return;
    const t = window.setTimeout(() => setLocateNotice(null), LOCATE_NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [locateNotice]);
  const mobileRef = useRef<boolean>(mobileControls);
  const fixedRef = useRef<BasemapMode | undefined>(fixedBasemap);
  const imageryRef = useRef<ImageryTone>(imagery);
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onLoadRef = useRef(onLoad);
  const onMoveRef = useRef(onMoveEnd);
  const onStatusRef = useRef(onBasemapStatus);
  onLoadRef.current = onLoad;
  onMoveRef.current = onMoveEnd;
  onStatusRef.current = onBasemapStatus;
  const [status, setStatus] = useState<BasemapStatus>("loading");

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    let styleLoaded = false;
    let announced = false;
    let usingFallback = false;
    let current: BasemapStatus = "loading";
    const modeShown = (): BasemapMode => fixedRef.current ?? getBasemapMode();
    const report = (s: BasemapStatus) => {
      if (s === current) return;
      current = s;
      setStatus(s);
      reportBasemapHealth(s, modeShown());
      onStatusRef.current?.(s);
    };
    reportBasemapHealth("loading", modeShown());

    let map: MlMap;
    try {
      map = new MlMap({
        container: el.current,
        style: STYLE_URL as string | StyleSpecification,
        center,
        zoom,
        interactive,
        attributionControl: false,
        minZoom: 8,
        maxZoom: 19,
        cooperativeGestures,
      });
    } catch (e) {
      // No WebGL context (disabled, blocked or exhausted): the page still works without the map.
      console.warn("[thetraffic] map could not be created:", (e as Error).message);
      report("webgl_failed");
      return;
    }
    mapRef.current = map;
    setMapObj(map);
    const mobile = mobileRef.current;
    map.addControl(new AttributionControl({ compact: true }), mobile ? "top-left" : "bottom-right");
    if (interactive && showNav && !mobile) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

    const applyMode = () => {
      try {
        applyBasemapMode(map, modeShown(), { imagery: imageryRef.current });
        reportBasemapHealth(current, modeShown());
      } catch (e) {
        console.warn("[thetraffic] basemap mode could not be applied:", (e as Error).message);
      }
    };
    const ready = () => {
      applyMode();
      if (announced) return;
      announced = true;
      onLoadRef.current?.(map);
    };
    const switchToFallback = (reason: string) => {
      if (usingFallback) return;
      usingFallback = true;
      console.warn("[thetraffic] basemap style unavailable, using a plain canvas:", reason);
      report("style_failed");
      map.setStyle(FALLBACK_STYLE);
    };

    map.on("style.load", () => {
      styleLoaded = true;
      ready();
    });
    map.on("load", () => {
      if (!usingFallback) report("ok");
    });
    // Recover the notice once late tiles arrive.
    map.on("idle", () => {
      if (styleLoaded && !usingFallback && map.areTilesLoaded()) report("ok");
    });
    map.on("moveend", () => onMoveRef.current?.(map));
    map.on("error", (e) => {
      const msg = e?.error?.message ?? "";
      // Anything failing before the style parsed is the style request itself.
      if (!styleLoaded && !usingFallback) {
        switchToFallback(msg || "style request failed");
        return;
      }
      if (msg && !/tile/i.test(msg)) console.warn("[thetraffic] map error:", msg);
    });
    // A pinned map ignores the shared toggle (there is none on it).
    const unsubscribeMode = fixedRef.current
      ? () => undefined
      : subscribeBasemapMode(() => {
          if (styleLoaded) applyMode();
        });

    const styleTimer = window.setTimeout(() => {
      if (!styleLoaded) switchToFallback(`no style after ${STYLE_TIMEOUT_MS / 1000} s`);
    }, STYLE_TIMEOUT_MS);
    const tileTimer = window.setTimeout(() => {
      if (styleLoaded && !usingFallback && !map.areTilesLoaded()) {
        console.warn("[thetraffic] basemap tiles still pending after", TILE_WATCHDOG_MS / 1000, "s");
        report("tiles_pending");
      }
    }, TILE_WATCHDOG_MS);

    return () => {
      window.clearTimeout(styleTimer);
      window.clearTimeout(tileTimer);
      unsubscribeMode();
      map.remove();
      mapRef.current = null;
      setMapObj(null);
      reportBasemapHealth("none");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notice = NOTICE[status];
  const mobile = mobileRef.current;
  const controls = status !== "webgl_failed";
  // The control column: on a desk it stacks upward from the zoom buttons (toggle, then locate); on a
  // phone it hangs from the top-right corner (toggle, then locate below it).
  // (The compact toggle is 66 px tall: two 30 px buttons, 2 px padding, 1 px borders; the zoom control ~70 px.)
  const locateDock = mobile ? (toggle ? "right-[10px] top-[82px]" : "right-[10px] top-[10px]") : toggle ? "bottom-[156px] right-[10px]" : "bottom-[84px] right-[10px]";

  return (
    <div className={cn("relative", mobile && "map-mobile", className ?? "h-full w-full")} role="region" aria-label={ariaLabel}>
      <div ref={el} className="absolute inset-0" />
      {vignette && <div className="map-vignette pointer-events-none absolute inset-0" aria-hidden />}
      {toggle && controls && <BasemapToggle compact className={cn("absolute z-10", mobile ? "right-[10px] top-[10px]" : "bottom-[84px] right-[10px]")} />}
      {locate && controls && <LocateControl map={mapObj} className={cn("absolute z-10", locateDock)} onFix={(fix) => onLocateRef.current?.(fix)} onNotice={setLocateNotice} />}
      {(notice || locateNotice) && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5" role="status">
          {notice && (
            <span className="chip whitespace-nowrap border-gw-ember/40 text-gw-ember">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gw-ember" aria-hidden />
              {notice}
            </span>
          )}
          {locateNotice && <span className="chip max-w-[calc(100%-1rem)] border-gw-ember/40 text-center text-gw-ember">{locateNotice}</span>}
        </div>
      )}
    </div>
  );
}
