import { setWorkerUrl } from "maplibre-gl";
// `?worker&url` (not plain `?url`): the dist worker imports its sibling `maplibre-gl-shared.mjs`, so it
// has to go through Vite's worker pipeline to become a self-contained chunk.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

/**
 * Point MapLibre GL JS v6 at its bundled Web Worker.
 *
 * v6 ships tile parsing as a separate module file and locates it at runtime with
 * `new URL("./maplibre-gl-worker.mjs", import.meta.url)`. Inside a bundler that resolves next to
 * the hashed app chunk (`/assets/maplibre-gl-worker.mjs`), where nothing exists: the map mounts,
 * renders the style background, but never requests a tile and never fires `load` — so no roads,
 * no signal dots, no routes. This module must be imported (for effect) before the first `Map`.
 */
setWorkerUrl(maplibreWorkerUrl);

export const MAPLIBRE_WORKER_URL: string = maplibreWorkerUrl;
