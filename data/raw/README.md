# Local source material

This directory contains reproducible OpenStreetMap extracts and source metadata that can be redistributed with clear terms.

Full text extracted from third-party PDFs and press releases is intentionally not committed. Some source pages do not state resource-specific redistribution terms, and some reports contain additional restrictions. The following paths are ignored:

- `opencity/text/`
- `historical/*.txt`
- `live/*.txt`

To regenerate the structured outputs, download the source documents from the URLs and identifiers recorded in `web/public/data/source_registry.v1.json`, `web/public/data/historical_sources.v1.json`, or `data/raw/opencity/package_show_*.json`, then place local text extracts at the paths expected by the scripts.

Do not commit those extracts. Preserve source URLs, publisher, document and retrieval dates, hashes, page references, licence information, and transformation notes in generated outputs.
