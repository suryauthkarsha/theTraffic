# Routing, search and traffic providers — removed

**The route / departure planner was removed from the site on 2026-09-08 (user decision).** The site
no longer geocodes places, requests routes or fetches live traffic; it shows what is on file for each
junction and the expected wait a timing plan accepted in the committed review file implies at a chosen time of week.
Nothing a visitor types or picks leaves the browser.

This document is kept as a record of what existed. The last leftover, the gateway Worker, was
retired on 2026-09-09.

## What was deleted from `web/`

| Piece | Was |
| --- | --- |
| `src/pages/PlanPage.tsx`, `src/components/plan/*`, `src/hooks/usePlan.ts` | the `/plan` screen: origin / destination comboboxes, route cards (Earliest arrival · Shortest drive · Lowest signal delay · Leave now), departure-time chart, signals-on-the-way list, signal popover |
| `src/components/ui/PlaceSearchField.tsx`, `src/lib/geocoding/*` | place search chain Mapbox Geocoding v6 → Photon (OSM) → Geoapify (opt-in) → explicit "No locations found"; Nominatim only behind a button (OSMF policy); session recents |
| `src/lib/routing/*` | provider adapters and runtime fallback chain Mapbox Directions `driving-traffic` → Google Routes proxy → OSRM → Valhalla; TomTom opt-in via `VITE_ROUTING_PROVIDER`; OSM-node route→signal matching |
| `src/lib/optimizer/*` | signals along a route (Δθ ≤ 40° approach match), residual ETA recursion (α = 1), Monte Carlo durations, 30-minute departure search with robust cost, objectives, "no advantage" rule |
| `src/lib/gateway/client.ts`, `src/lib/functionsUrl.ts` | the browser side of the provider gateway (proxy mode via the Worker, direct mode via a public Mapbox token) and the rail's `GATEWAY` probe |
| `scripts/e2e-plan.ts`, `scripts/check-route-nodes.ts` | planner end-to-end and route-node checks |

The `VITE_ROUTING_PROVIDER`, `VITE_MAPBOX_*`, `VITE_TOMTOM_*`, `VITE_GOOGLE_ROUTES_PROXY_URL`,
`VITE_OSRM_*`, `VITE_VALHALLA_URL`, `VITE_PHOTON_URL`, `VITE_NOMINATIM_URL` and `VITE_GEOAPIFY_API_KEY`
variables are read by nothing.

## The gateway Worker — retired 2026-09-09

`functions/` used to hold a Cloudflare Worker + one Durable Object per provider
(`ProviderGatewayObject`: per-cell / 5-minute-bucket cache, single-flight coalescing, quota guardrails,
circuit breaker) exposing `/{provider}/health`, `/route`, `/search`, `/reverse` and `/tomtom/flow` with
the operator's `MAPBOX_ACCESS_TOKEN` / `TOMTOM_API_KEY`. Once the planner left, that was an
unauthenticated `Access-Control-Allow-Origin: *` proxy able to spend paid quotas, so it was retired:
`functions/gateway-object.ts`, `web/src/lib/gateway/core/*`, `web/src/lib/math/pchip.ts`,
`web/scripts/e2e-gateway.ts` and `web/scripts/load-sim.ts` were deleted. The Worker was temporarily a
liveness stub; since 2026-09-11 it hosts the unrelated grievance board. `GET /ping` remains and the
retired `/mapbox/*` and `/tomtom/*` routes return `410 Gone`. The `MAPBOX_*` and `TOMTOM_*` project
environment values are read by nothing. See `docs/DEPLOYMENT.md`.

## Map rendering is unaffected

Map rendering was never a provider concern and still is not: MapLibre GL JS with OpenFreeMap vector
tiles (dark) or Esri World Imagery under the same roads and labels (satellite). See
`web/src/lib/map/basemap.ts`.
