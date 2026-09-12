# Data licensing and attribution

The repository's MIT License applies to original source code and documentation. It does not override the rights or licence terms attached to third-party data, source documents, map tiles, fonts, or dependencies.

## OpenStreetMap-derived datasets

The signal geometry and surveillance snapshots are derived from OpenStreetMap and are made available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Required attribution: **© OpenStreetMap contributors**.

Relevant files include:

- `web/public/data/intersections.v1.json`;
- `web/public/data/surveillance_cameras.v1.json`;
- raw OpenStreetMap and Overpass extracts under `data/raw/osm/` where present;
- derivative geometry and reconciliation records built from those sources.

Consult the metadata inside each dataset for its query, retrieval time, OSM base timestamp, and transformation notes. `data/raw/opencity/geocode_cache.json` contains Photon geocoder results derived from OpenStreetMap; it retains the same OpenStreetMap attribution and ODbL terms.

## Bengaluru Traffic Police timing material via OpenCity

`web/public/data/published_timing_plans.v3.json` contains structured factual extractions derived from Bengaluru Traffic Police timing documents accessed through OpenCity.

OpenCity's [usage and licence FAQ](https://opencity.in/faqs/) says its data is under ODbL 1.0 unless explicitly stated. The individual traffic-signal resources currently say **No License Provided**, so the repository does not treat the source PDFs or their text as MIT material. It redistributes neither the PDFs nor OCR text, raw headers, raw timing rows, or unparsed labels. The published JSON is limited to normalized factual fields such as source references, junction identifiers, times, durations, parse results, and provenance.

Reusers must preserve the publisher, OpenCity attribution, portal URL, document dates, retrieval date, and SHA-256 provenance. The timing facts are not offered under the repository's MIT licence. Reusers should independently check the current resource metadata, applicable law, and OpenCity terms before redistribution or commercial use.

Source: <https://data.opencity.in/dataset/bengaluru-city-traffic-signal-data>

## Historical and reference sources

The source registry and historical dataset contain metadata, page references, and limited factual extractions from BBMP, JICA, Mappls/MapmyIndia, Safe City tender material, and other publishers. Full report and press-release text is not distributed in this repository. Local extracts used by the scripts are gitignored.

The underlying works retain their original rights. A registry entry, URL, hash, or factual reference is not a grant of permission.

## Basemaps, imagery, fonts, and dependencies

- OpenFreeMap and Esri imagery are loaded from their respective services and remain subject to those services' terms and attribution requirements.
- IBM Plex font files are distributed through `@fontsource` under their upstream licence.
- The project logo, icons, and social-preview image are original project assets covered by the MIT License.
- JavaScript and Python dependencies retain their own licences.

## Adding data

Every new dataset or source snapshot must include its publisher, source URL, licence or known reuse terms, retrieval date, observation date when known, and transformation method. If reuse terms are unclear, do not describe the material as open data and do not imply that MIT covers it.
