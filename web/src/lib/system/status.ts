import type { BasemapHealth } from "@/lib/map/basemapStatus";

/**
 * System status model for the bottom rail and the support page. Pure: every input is passed in so
 * the rail wording can be tested without a browser. Nothing here is estimated — an unknown state
 * renders as "—", never as "ok".
 *
 * Tones are the palette's names: orange = confirmed fine, ember = degraded or unconfirmed, red =
 * failed, grey = nothing to report / still checking.
 */
export type Tone = "orange" | "ember" | "red" | "grey";

export interface RailItem {
  id: string;
  label: string;
  value: string;
  tone: Tone;
  /** Longer explanation for the support page / tooltips. */
  detail: string;
}

export interface StatusInputs {
  nowMs: number;
  dataset: { version: string; osmBase: string | null; intersections: number | null; nodes: number | null } | null;
  basemap: { mode: "dark" | "satellite"; health: BasemapHealth };
  build: string;
  /** The surveillance snapshot, only while the Surveillance page is mounted (it alone loads the file). */
  cameras?: { state: "loading" | "ok" | "error"; count: number | null; osmBase: string | null; syncedAt: string | null } | null;
}

/** A surveillance snapshot older than this reads "stale" (ember): the data is still served, its age is said. */
export const CAMERAS_STALE_AFTER_DAYS = 30;

/** Build stamp injected by Vite (see vite.config.ts); falls back for tests and tooling. */
declare const __GW_BUILD__: string | undefined;
export const BUILD_STAMP: string = typeof __GW_BUILD__ === "string" ? __GW_BUILD__ : "dev";

const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** "14:32:07" in Asia/Kolkata. */
export function istClock(ms: number): string {
  return IST.format(new Date(ms)).replace(/\u200e/g, "");
}

export function basemapItem(mode: "dark" | "satellite", health: BasemapHealth): RailItem {
  const label = "basemap";
  switch (health) {
    case "none":
      return { id: "basemap", label, value: "—", tone: "grey", detail: "No map on this screen." };
    case "loading":
      return { id: "basemap", label, value: `${mode} · loading`, tone: "grey", detail: "The map style is still being fetched." };
    case "ok":
      return { id: "basemap", label, value: `${mode} · ok`, tone: "orange", detail: mode === "satellite" ? "Satellite imagery under OpenStreetMap roads and labels." : "OpenFreeMap dark vector tiles, tinted." };
    case "tiles_pending":
      return { id: "basemap", label, value: `${mode} · tiles pending`, tone: "ember", detail: "The map host is slow or unreachable; the signals still draw." };
    case "style_failed":
      return { id: "basemap", label, value: "unavailable", tone: "red", detail: "The map style could not be fetched; signals draw on a plain black canvas." };
    case "webgl_failed":
      return { id: "basemap", label, value: "no webgl", tone: "red", detail: "This browser has WebGL disabled, so no map can be drawn." };
  }
}

export function datasetItem(d: StatusInputs["dataset"]): RailItem {
  if (!d) return { id: "dataset", label: "signals", value: "loading", tone: "grey", detail: "Loading the signal map." };
  return { id: "dataset", label: "signals", value: `${d.intersections ?? "—"} junctions · osm ${d.osmBase ?? "—"}`, tone: "orange", detail: `Signal map ${d.version}: ${d.intersections ?? "—"} junctions merged from ${d.nodes ?? "—"} OpenStreetMap signal nodes (base ${d.osmBase ?? "—"}).` };
}

export function camerasItem(c: NonNullable<StatusInputs["cameras"]>, nowMs: number): RailItem {
  const label = "cameras";
  if (c.state === "loading") return { id: "cameras", label, value: "loading", tone: "grey", detail: "Loading the surveillance snapshot." };
  if (c.state === "error") return { id: "cameras", label, value: "unavailable", tone: "red", detail: "The surveillance snapshot could not be loaded; the map still draws." };
  const ageDays = c.syncedAt ? Math.floor((nowMs - Date.parse(c.syncedAt)) / 86_400_000) : null;
  const stale = ageDays !== null && ageDays > CAMERAS_STALE_AFTER_DAYS;
  const count = c.count === null ? "—" : c.count.toLocaleString("en-IN");
  return {
    id: "cameras",
    label,
    value: `${count} records · osm ${c.osmBase?.slice(0, 10) ?? "—"}${stale ? " · stale" : ""}`,
    tone: stale ? "ember" : "orange",
    detail: `${count} surveillance records mapped in OpenStreetMap (man_made=surveillance) inside the Bengaluru boundary, synchronized ${c.syncedAt?.slice(0, 10) ?? "—"}${stale ? ` — ${ageDays} days ago, so treat it as stale` : ""}. The browser never queries Overpass; coverage may be incomplete.`,
  };
}

/**
 * Every rail item, in display order. Only things worth a glance: the clock, the dataset, the
 * surveillance snapshot (on the Surveillance page only) and the map (on map screens only). The site
 * talks to no server of its own — there is no gateway to probe — and the build stamp lives on the
 * error panel, not here.
 */
export function railItems(s: StatusInputs): RailItem[] {
  const items: RailItem[] = [{ id: "clock", label: "ist", value: istClock(s.nowMs), tone: "orange", detail: "Local time in Asia/Kolkata — every time on the site uses it." }, datasetItem(s.dataset)];
  if (s.cameras) items.push(camerasItem(s.cameras, s.nowMs));
  if (s.basemap.health !== "none") items.push(basemapItem(s.basemap.mode, s.basemap.health));
  return items;
}
