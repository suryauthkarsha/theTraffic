import type { Intersection } from "@/lib/data/types";
import { haversine, type LngLat } from "@/lib/geo";

/**
 * Junction search for the Signal Map (audit finding 7). Pure functions so the behaviour is testable
 * without a map: token match on the canonical name and road names, ranked exact → prefix → contains,
 * with an explicit "no results" outcome and a stable cap.
 */
export const SIGNAL_SEARCH_MIN_CHARS = 2;
export const SIGNAL_SEARCH_LIMIT = 8;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface JunctionMatch {
  intersection: Intersection;
  /** 0 exact name · 1 name starts with query · 2 name contains query · 3 a road name matches */
  rank: 0 | 1 | 2 | 3;
}

export interface JunctionSearchResult {
  query: string;
  /** Null until the query is long enough. */
  matches: JunctionMatch[] | null;
  total: number;
}

export function searchJunctions(query: string, intersections: Intersection[], limit = SIGNAL_SEARCH_LIMIT): JunctionSearchResult {
  const q = norm(query);
  if (q.length < SIGNAL_SEARCH_MIN_CHARS) return { query, matches: null, total: 0 };
  const out: JunctionMatch[] = [];
  for (const i of intersections) {
    const name = norm(i.canonical_name);
    let rank: JunctionMatch["rank"] | null = null;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (i.road_names.some((r) => norm(r).includes(q))) rank = 3;
    if (rank !== null) out.push({ intersection: i, rank });
  }
  out.sort((a, b) => a.rank - b.rank || a.intersection.canonical_name.localeCompare(b.intersection.canonical_name));
  return { query, matches: out.slice(0, limit), total: out.length };
}

/** Junctions nearest to a point (the non-map browse list when nothing is typed). */
export function nearestJunctions(center: LngLat, intersections: Intersection[], limit = 10): { intersection: Intersection; distance_m: number }[] {
  return intersections
    .map((i) => ({ intersection: i, distance_m: haversine(center, [i.lon, i.lat]) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

/** Keyboard navigation over a result list. Returns the next active index (or -1 when the list is empty). */
export function moveActive(current: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End", length: number): number {
  if (length <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return (current + 1) % length;
    case "ArrowUp":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
  }
}
