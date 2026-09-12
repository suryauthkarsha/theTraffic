import { CAMERA_TYPES, CATEGORIES, KINDS, ZONES, type Camera, type CameraKind, type CameraTypeFacet, type CategoryFacet, type ZoneFacet } from "./normalize";

/**
 * Filters on the Surveillance page: one value per OSM key group, "all" meaning no restriction.
 * Pure; the page's selects, counts and view memory all go through here.
 */
export type Tri = "all" | "mapped" | "none";

export interface CameraFilters {
  /** `surveillance:type` — camera, number-plate reader, guard post, viewpoint. */
  kind: CameraKind | "all";
  /** `surveillance` — public, outdoor, indoor, private, traffic. */
  category: CategoryFacet | "all";
  /** `surveillance:zone`. */
  zone: ZoneFacet | "all";
  /** `camera:type`. */
  cameraType: CameraTypeFacet | "all";
  operator: Tri;
  direction: Tri;
}

export type FilterGroupId = keyof CameraFilters;

export const DEFAULT_FILTERS: CameraFilters = { kind: "all", category: "all", zone: "all", cameraType: "all", operator: "all", direction: "all" };

export interface FilterOption {
  id: string;
  label: string;
}

export interface FilterGroup {
  id: FilterGroupId;
  /** Short label for the select. */
  label: string;
  /** The OSM key it reads, for the tooltip. */
  key: string;
  options: FilterOption[];
}

const NOT_MAPPED = "Not mapped";
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const facetOptions = (ids: readonly string[], labels: Record<string, string> = {}): FilterOption[] => ids.map((id) => ({ id, label: labels[id] ?? (id === "none" ? NOT_MAPPED : cap(id)) }));

export const FILTER_GROUPS: FilterGroup[] = [
  { id: "category", label: "Surveillance", key: "surveillance", options: facetOptions(CATEGORIES) },
  { id: "zone", label: "Zone", key: "surveillance:zone", options: facetOptions(ZONES) },
  { id: "cameraType", label: "Camera type", key: "camera:type", options: facetOptions(CAMERA_TYPES) },
  { id: "kind", label: "Device", key: "surveillance:type", options: facetOptions(KINDS, { alpr: "Number-plate reader (ALPR)", guard: "Guard post" }) },
  { id: "operator", label: "Operator", key: "operator", options: [{ id: "mapped", label: "Mapped" }, { id: "none", label: NOT_MAPPED }] },
  { id: "direction", label: "Direction", key: "camera:direction", options: [{ id: "mapped", label: "Mapped" }, { id: "none", label: NOT_MAPPED }] },
];

/** The value a record has for a group — what its select compares against. */
export function facetValue(c: Camera, group: FilterGroupId): string {
  switch (group) {
    case "kind":
      return c.kind;
    case "category":
      return c.category;
    case "zone":
      return c.zone;
    case "cameraType":
      return c.cameraType;
    case "operator":
      return c.operator ? "mapped" : "none";
    case "direction":
      return c.directions.length ? "mapped" : "none";
  }
}

export function matchesFilters(c: Camera, f: CameraFilters, except: FilterGroupId | null = null): boolean {
  for (const g of FILTER_GROUPS) {
    if (g.id === except) continue;
    const want = f[g.id];
    if (want !== "all" && facetValue(c, g.id) !== want) return false;
  }
  return true;
}

export function applyFilters(cameras: readonly Camera[], f: CameraFilters): Camera[] {
  return cameras.filter((c) => matchesFilters(c, f));
}

/**
 * Faceted counts: for each group, how many records each option would show given every OTHER group's
 * current choice — so a select's counts always add up to what picking it would leave on the map.
 */
export function facetCounts(cameras: readonly Camera[], f: CameraFilters): Record<FilterGroupId, Record<string, number>> {
  const out = {} as Record<FilterGroupId, Record<string, number>>;
  for (const g of FILTER_GROUPS) {
    const counts: Record<string, number> = {};
    for (const o of g.options) counts[o.id] = 0;
    for (const c of cameras) if (matchesFilters(c, f, g.id)) counts[facetValue(c, g.id)] = (counts[facetValue(c, g.id)] ?? 0) + 1;
    out[g.id] = counts;
  }
  return out;
}

export function activeFilterCount(f: CameraFilters): number {
  return FILTER_GROUPS.filter((g) => f[g.id] !== "all").length;
}

export function isFilterValue(group: FilterGroupId, v: unknown): boolean {
  if (v === "all") return true;
  const g = FILTER_GROUPS.find((x) => x.id === group);
  return typeof v === "string" && !!g && g.options.some((o) => o.id === v);
}

/** Filters ← anything (view memory, a URL); every unknown or invalid value falls back to "all". */
export function parseFilters(raw: unknown): CameraFilters {
  const out: CameraFilters = { ...DEFAULT_FILTERS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const g of FILTER_GROUPS) if (isFilterValue(g.id, r[g.id])) (out as unknown as Record<string, string>)[g.id] = r[g.id] as string;
  return out;
}

export function serializeFilters(f: CameraFilters): string {
  return JSON.stringify(f);
}

export function parseFiltersString(s: string | null | undefined): CameraFilters {
  if (!s) return { ...DEFAULT_FILTERS };
  try {
    return parseFilters(JSON.parse(s) as unknown);
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}
