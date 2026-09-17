/// <reference types="vite/client" />

/** Build stamp injected by vite.config.ts (`define`). */
declare const __GW_BUILD__: string;

/**
 * Every environment value the browser may read. Reference keys one at a time
 * (`import.meta.env.VITE_SUPPORT_EMAIL`) — never `import.meta.env` as a whole object, which would
 * inline every VITE_ value the build machine holds. vite.config.ts fails the build if that happens.
 */
interface ImportMetaEnv {
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_SATELLITE_TILE_URL?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
  readonly VITE_LIVE_TIMING_PROVIDER?: string;
  /** Google Analytics 4 measurement id (`G-XXXXXXXXXX`); absent = no analytics at all. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** The grievance board's Worker origin; absent = the project's own Worker (`lib/grievance/api.ts`). */
  readonly VITE_GRIEVANCE_API_URL?: string;
  /** The canonical public origin, for canonical links and the sitemap; absent = the site's own domain, `https://www.thetraffic.in` (`lib/system/seo.ts`). */
  readonly VITE_SITE_URL?: string;
}
