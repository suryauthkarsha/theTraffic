# Architecture

## Components

```
┌──────────────────────────────────────────────┐
│ web (Vite/React/MapLibre) — static build      │
│  Landing · Console · Signal Map ·             │
│  Intersection · Surveillance · Research ·     │
│  Methodology · Support · Grievance            │
│  reads versioned JSON from public/data:       │
│  intersections.v1 · published_timing_plans.v3 │
│  historical_sources.v1 · source_registry.v1 · │
│  review_decisions.v1 · surveillance_cameras.v1│
│  (the last only on /surveillance)             │
└──────────────────────────────────────────────┘
          │  basemap tiles: OpenFreeMap vector (dark) · Esri World Imagery (satellite) — MapLibre GL
          │  one server of ours: the grievance board (below), called only from /grievance and /grievances

functions/ (Cloudflare Worker + Durable Objects) — the grievance board since 2026-09-11 (`docs/DEPLOYMENT.md`
  § The Worker): `index.ts` routes, caps and validates; `GrievanceBoard` (one instance) holds the rows in
  SQLite and applies the rate limits; `GrievancePhotos` (256 shards) holds the stripped JPEGs. Reads two env
  values (moderator passphrase, extra origins). GET /ping; 410 Gone on the former routing / search routes.
scripts/  build-intersections.ts (Overpass → master map) · sync-surveillance.ts (cached Overpass → surveillance snapshot)
          · ingest_opencity_timing.py · ingest_secondary_sources.py
```

There is no authentication and no visitor data store (removed 2026-09-08), and no route or departure
planner (removed the same day, user decision). The one store is the grievance board — what people
choose to post about the road, with no field for who posted it (`docs/PRIVACY.md`). The site measures
its own audience with Google Analytics 4 page views, only when a measurement id is configured at build
time (`lib/system/analytics.ts`).

## Data flow

1. **Master map** — Overpass extracts → clustering + approach derivation → `intersections.v1.json`.
   Versioned, with OSM base timestamp and licence in `meta`.
2. **Published plans** — OpenCity CKAN metadata + PDFs → positioned words → panels, rows, movement
   matrix, PDF metadata dates, SHA-256 → junction match → rule-set pre-validation → quality pass
   (duplicates, conflicts, weak, stale) → `published_timing_plans.v3.json` (every block
   `pending_review` or `pre_validated`; none verified).
2a. **Review decisions** — explicit records accept / reject / deactivate block-to-intersection links,
   label control types and optionally assign document letters to compass approaches *outside the app*;
   the result is committed as `review_decisions.v1.json`. The current file identifies its provenance
   as an AI-assisted linkage review, not independent human verification. `web/src/lib/timing` derives coverage categories and
   provenance-complete timing claims from datasets + decisions at render time (`useSignalModel`).
2b. **Secondary sources** — `ingest_secondary_sources.py` → `historical_sources.v1.json` (BBMP CTMP
   2024, JICA 2015: page-referenced mentions, never timings) and `source_registry.v1.json` (published ·
   live · historical · location, with status and dates; Mappls = `not_authorized`, 0 coverage).
2c. **Surveillance snapshot** — `sync-surveillance.ts` runs one cached Overpass query (OSM
   `man_made=surveillance` nodes inside relation 7902476, `out meta`) with retries across mirrors,
   refuses partial results, drops and counts malformed coordinates, sanitizes tags, upserts by OSM id
   against the previous snapshot (removals only after a complete result) and writes
   `surveillance_cameras.v1.json` (meta: synced_at, osm_base, counts, sync stats, licence, credit) plus
   two registry rows (the OSM dataset; the Safe City tender as `reference_only`, not imported) and a
   line in `data/sync/data_sync_runs.jsonl`. It is a SEPARATE model from the signal datasets and is
   never merged with them; only `/surveillance` downloads it. Shared tag reading lives in
   `web/src/lib/surveillance/normalize.ts` so the script and the page agree on every facet.
3. **Predictions** — for a junction and a chosen time of week, `useSignalModel` → `predict()`: Level P
   from a plan link accepted in the committed review file (cycle + green splits, uniform arrival phase → P(stop) = r/C,
   E[D] = r²/2C, currency-weighted confidence), else Level E = unknown. Rendered as marker colour /
   brightness on the Signal Map, the junction card and the intersection page. There is no routing step
   any more (the planner was removed on 2026-09-08).
4. **Modelling** — `lib/models` still contains the kernel time-of-week baseline, periodicity estimators
   and the fixed-time model, unit-tested against the synthetic simulator. Nothing feeds them: the site
   has no trajectories. Methodology §3–§7 documents the design they would run on.

## Repository layout vs. specification

The specification's `/apps/web` and `/packages/*` map to `web/` and `web/src/lib/*`. The `/services/*`
model service and the collection / storage tier were removed on 2026-09-08 together with Supabase.

## Security

- The browser holds no token of any kind; the one server of ours it calls is the grievance board,
  over https, with `credentials: "omit"` (`lib/grievance/api.ts` — the security test pins that every
  other `fetch` in `web/src` loads a same-origin dataset). The bundle may carry eight `VITE_*` values
  (support mailbox, map style / imagery URLs, live-provider name, analytics id, board origin, site
  origin), each read by key;
  `vite.config.ts` fails the build if a `VITE_` key name or a credential-like value reaches a chunk
  (2026-09-09: a Mapbox token and a retired Supabase anon key had been inlined through wholesale
  `import.meta.env` reads).
- A Content Security Policy is injected at build: connections and images limited to this origin and
  the basemap / imagery hosts, no frames, plugins or `<base>` hijack, forms post only to this origin.
  Inline scripts stay allowed because the Rork host injects its own (preview bridge, log forwarding,
  the published-build badge); our build emits none.
- The Worker's surface is the grievance board alone: bodies capped before they are read, JPEGs parsed
  and stripped of metadata, contact details refused, origins granted by name (never `*`), per-caller
  and global rate limits keyed on a daily-salted hash, moderation behind a constant-time passphrase
  check. The former gateway (an unauthenticated `*` proxy for paid APIs) was retired on 2026-09-09;
  `/mapbox/*` and `/tomtom/*` answer `410 Gone`.
- Outbound links from the datasets are drawn for http(s) targets only (`safeHttpUrl`); every external
  link opens with `rel="noreferrer"`.
- Dependencies: `bun audit` clean (2026-09-09); react-router 7 (open-redirect advisories in 6.x).
- Server-side persistence is limited to submitted grievances and short-lived, daily-salted abuse
  counters. The form requests no account or identity, but a post's content, place and time may identify
  a person or private location.

## Observability

Client: `console.warn('[thetraffic] …')` for map/style failures; the bottom system rail shows the
dataset and basemap probes live. Server: the Worker logs only its own failures (`console.error` with
the error message, never a request's contents): `rork-agent logs backend`.
