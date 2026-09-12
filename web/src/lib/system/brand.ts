/**
 * The product name (user decision 2026-09-09): "theTraffic." — the full stop is part of the name, and
 * the wordmark paints it red (`components/layout/Wordmark`). Every place the name is *read* takes it
 * from here: document titles, the support e-mail subject and report header, the headers.
 *
 * Machine identifiers keep the project's original codename and are not branding: `gw-` junction ids,
 * `gw.` storage keys, `--gw-` CSS variables, the `gw` colour tokens and the
 * `greenwave.surveillance_cameras.v1` schema id are data contracts — renaming them would change the
 * shape of files and URLs for no visitor-facing gain.
 */
export const BRAND_WORD = "theTraffic";
export const BRAND_NAME = `${BRAND_WORD}.`;
export const BRAND_CITY = "Bengaluru";
