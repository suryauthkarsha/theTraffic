# scripts/

| Script | Purpose |
| --- | --- |
| `build-intersections.ts` | Overpass extracts → logical intersections + approaches (`web/public/data/intersections.v1.json`), then cross-checks every `data/raw/osm/*.csv` signal list (see below). `bun run scripts/build-intersections.ts` |
| `lib/signalCsv.ts` | CSV parser + reconciliation rules for external traffic-signal lists. `bun test scripts/tests/signalCsv.test.ts` |
| `sync-surveillance.ts` | Cached Overpass query (`overpass/surveillance.overpassql`: `man_made=surveillance` nodes inside OSM relation 7902476, `out meta`) → `web/public/data/surveillance_cameras.v1.json` + the two surveillance rows of `source_registry.v1.json` + a line in `data/sync/data_sync_runs.jsonl`. Retries with backoff across three mirrors; an Overpass `remark` (partial result) is refused; bad ids / out-of-area coordinates are dropped and counted; tags sanitized, contact-style keys stripped; upsert by OSM id (inserted · updated · removed · unchanged); removals only after a complete result ≥ 50 % of the last snapshot (`--force` to override); no-op within 24 h of the last sync. `bun run scripts/sync-surveillance.ts` · `--from <saved.json>` · `--force`. Pure rules in `lib/surveillanceSync.ts`, shared tag reading in `web/src/lib/surveillance/normalize.ts`. `bun test scripts/tests/surveillanceSync.test.ts` |
| `ingest_opencity_timing.py` | OpenCity/BTP PDFs → `published_timing_plans.v3.json`: dated (PDF metadata), parse confidence, movement matrix, pedestrian stage, duplicates/conflicts/weak/stale flags, rule-set **pre-validation only** (no block is ever verified by the script). Needs `pip install -r requirements-dev.txt`. Downloaded PDFs and extracted text stay local and are gitignored. |
| `ingest_secondary_sources.py` | Historical text extracts (BBMP CTMP 2024, JICA 2015) → `historical_sources.v1.json` (evidence only) + `source_registry.v1.json` (published · live · historical · location with status/dates; Mappls registered as an unauthorised opportunity). |
| `build_icons.py` | The app icon and favicon set from one mark — the orange signal route with three cased junctions on black (`.rork/DESIGN.md`) — every size drawn on its own pixel grid: `favicon.ico` (16 · 32 · 48), `favicon-16x16.png` · `-32x32` · `-48x48` · `favicon.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon.png` (1024), all into `web/public/`. Needs Pillow (`requirements-dev.txt`). `python3 scripts/build_icons.py` · `--out DIR`. |
| `tests/` | `python3 -m unittest discover -s scripts/tests -v` — synthetic two-panel PDF parsing, junction matching, duplicates, conflicts, stale documents, weak matches, no-auto-verification; the icon mark as pixels (black and orange only, a junction at the centre, the road visible at 16 px, `.ico` frames identical to the PNGs). `bun test scripts/tests` — CSV cross-check rules. |

## Overpass queries used (2026-09-05)

Nodes:
```
[out:json][timeout:240];
node["highway"="traffic_signals"](12.78,77.38,13.18,77.82);
out body;
```
Ways (run per tile; the full bbox times out on public mirrors):
```
[out:json][timeout:200];
node["highway"="traffic_signals"](<tile bbox>)->.s;
way(bn.s)["highway"];
out tags geom;
```
Tiles: `12.78,77.38,12.98,77.60` · `12.78,77.60,12.98,77.82` · `12.98,77.38,13.18,77.60` · `12.98,77.60,13.18,77.82`.
Mirrors tried in order: overpass-api.de, overpass.kumi.systems, overpass.private.coffee.

## Surveillance snapshot (2026-09-09)

Query (exactly as run, `scripts/overpass/surveillance.overpassql`):
```
[out:json][timeout:120];
relation(7902476);
map_to_area->.bengaluru;
node["man_made"="surveillance"](area.bengaluru);
out meta;
```
First sync: 2 818 nodes (OSM base 2026-09-09T03:50:33Z, areas base 2026-09-08T17:15:46Z, via
overpass-api.de in 4.8 s): `surveillance:type` camera 2 724 · ALPR 3 · guard 8 · viewpoint 17 ·
other 2 · untagged 64; `camera:type` fixed 1 721 · dome 571 · panning 352; `operator` on 50;
`camera:direction` (else `direction`) readable on 1 866. A second run 31 minutes later over the
live API (`--force`; osm base 2026-09-09T04:20:20Z, one attempt) diffed against that snapshot:
0 inserted · 0 updated · 0 removed · 2 818 unchanged (`data/sync/data_sync_runs.jsonl`, two lines).
The count is never hard-coded anywhere —
the page, the rail and the Research tile read `meta.count` from the snapshot. The browser never
queries Overpass. Credit: the mapping effort is Thejesh GN's *Surveillance in Bengaluru* project
(<https://thejeshgn.com/projects/surveillance-in-bengaluru/>); the data is © OpenStreetMap
contributors, ODbL 1.0.

The Bengaluru Safe City Project tender transcription linked from that project (a view-only Google
Sheet: 2 745 proposed-location rows summing the tender's "approximately 3 000" locations, 742
existing-camera rows of 1 100 stated installed) is registered in the source registry as
`reference_only` and **not imported**: its coordinates are place-name geocodes (2 087 distinct for
2 745 rows; 554 for 742) and it states no licence, so no row can be placed reliably or matched to an
OSM record, and a proposed location is never an installed camera.

## External traffic-signal lists (`data/raw/osm/*.csv`)

Any CSV of OSM `highway=traffic_signals` nodes dropped into `data/raw/osm/` is cross-checked by
`build-intersections.ts` (columns: `osm_id`/`@id`, `latitude`/`lat`, `longitude`/`lon`, optional
`name`, `traffic_signals`, `direction`, `crossing`, `source`). Rules, in order:

1. node id already a source node → **present**; the extract's coordinate is kept (it carries the way
   geometry). A listed coordinate > 5 m away is reported as `moved`, never applied.
2. unknown id within 60 m of an intersection → **attached** as `seed_node_ids` on that intersection;
   id, geometry and approaches untouched, so plan links and reviewer decisions stay valid.
3. unknown id farther than 60 m → **added** at exactly the listed coordinate as a location-only
   `unresolved` intersection (no approaches, `cluster_confidence` 0.45, `review_needed`, `seed_source`
   = file). Its id is the builder's own sha1(node id), so a later Overpass refresh keeps it stable.

The result is written to `meta.reconciliation[]` and shown in the Signal Map footer and the admin
data-sources table. `bengaluru_traffic_signals_osm_2026-09-07.csv` (1 369 rows): 1 369 present, 0
attached, 0 added, 0 moved, 0 tag differences (the file's `direction` column is OSM's
`traffic_signals:direction`); the extract holds 23 further signals the file does not list (12 outside
its bbox, 11 inside).

## data.gov.in "Bangalore: Traffic Lights" (location only)

Registered as a location-only seed source (`signal_sources.source_type = 'government_seed'`; never a
timing source). Probe on 2026-09-06 via the OGD `lists`/`resource` API: the catalog (nid 602922725)
exposes no per-location resource — the only matching resource (`d0637ff8-…`, "Traffic lights") is a
city-level count table and returned 0 rows for Bangalore. If a compatible location-level CSV is
published, transform it to the OSM-style signal-list schema above and place it under `data/raw/osm/`.
The existing builder will reconcile listed nodes and report unmatched points; never treat that file as
timing.

## Secondary and live sources

- Local, gitignored files under `data/raw/historical/` can hold pdfplumber text from the BBMP CTMP
  Final Feasibility Report (December 2024, 628 pages, sha256 c6a0b8b0…) and the JICA ITS Master Plan
  appendices (12235198_04, 27 April 2015, 369 pages, sha256 a3f8ab9f…). Neither contains a
  junction-level timing table; the public output keeps page-referenced factual mentions but not
  source prose or full text.
- A local, gitignored file under `data/raw/live/` can hold the MapmyIndia press release text
  (25 Sep 2025) used to verify the public claim of 125+ smart signals with live timers in Bengaluru.
  The public repository keeps the source URL and hash, not the article text. theTraffic. does not
  scrape the Mappls app or call private APIs; the adapter contract is `web/src/lib/timing/live.ts`.
