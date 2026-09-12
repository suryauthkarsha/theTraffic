import { readFileSync } from "node:fs";
import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { parseMailbox } from "./src/lib/support/mailbox.ts";

/**
 * Build stamp shown on the error panel and attached to support requests: "2026-09-07 16:32Z" — on Vercel
 * followed by the short commit ("2026-09-07 16:32Z · a1b2c3d", from VERCEL_GIT_COMMIT_SHA, which every Vercel
 * build receives), so a report names the exact deployment. GW_BUILD replaces the whole stamp.
 */
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) ?? "";
const buildStamp = process.env.GW_BUILD?.trim() || new Date().toISOString().slice(0, 16).replace("T", " ") + "Z" + (commit ? ` · ${commit}` : "");

/**
 * Where the build will be served decides how wide script-src must be. Rork's host injects inline scripts
 * and a react-grab tag into every page it serves (see csp below), so both stay allowed there. Vercel sets
 * VERCEL=1 in every build environment and serves the HTML exactly as built — nothing is inline — so the
 * policy there is 'self' plus, when configured, the Google tag loader: an injected script cannot run at all.
 */
const SERVED_AS_BUILT = process.env.VERCEL === "1";

/**
 * The only environment values the browser may carry. Modules read them one key at a time
 * (`import.meta.env.VITE_SUPPORT_EMAIL`), never `import.meta.env` as a whole object — Vite would then
 * inline EVERY VITE_ value the build machine holds, which is how a Mapbox token and a retired Supabase
 * key once reached the bundle. `envHygiene` fails the build if that ever happens again.
 */
const CLIENT_ENV: readonly string[] = ["VITE_SUPPORT_EMAIL", "VITE_MAP_STYLE_URL", "VITE_SATELLITE_TILE_URL", "VITE_SATELLITE_ATTRIBUTION", "VITE_LIVE_TIMING_PROVIDER", "VITE_GA_MEASUREMENT_ID", "VITE_GRIEVANCE_API_URL", "VITE_SITE_URL"];

/** Same shape `lib/system/analytics.ts` accepts; a malformed id gets no CSP hosts, exactly as it gets no tag. */
const GA_MEASUREMENT_ID = /^G-[A-Z0-9]{6,14}$/;

/**
 * Google Analytics 4 hosts, from Google's CSP guide for the Google tag: the loader, the collection
 * endpoints (`*.google-analytics.com` covers the regional `region1.` hosts) and the pixel fallback.
 * Deliberately absent: the ads / Google-signals hosts (`*.g.doubleclick.net`, `*.google.com`) — the
 * site measures page views, nothing else, so those requests are blocked if the property ever turns
 * Google signals on.
 */
const GA_HOSTS = {
  script: ["https://www.googletagmanager.com"],
  img: ["https://*.google-analytics.com", "https://www.googletagmanager.com"],
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"],
};

/** Env names that hold credentials or vendor identifiers; their values must never appear in the output. */
const SENSITIVE_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL|SUPABASE|MAPBOX|TOMTOM|EMAIL|API)/i;

/** Emitted files whose text is scanned by the hygiene gate; images and fonts are binary and skipped. */
const TEXT_ASSET = /\.(js|mjs|css|html|json|svg|txt|xml|webmanifest|map)$/i;

/**
 * The one third-party script the Rork host injects into every served page: `react-grab`, the editor
 * preview's element picker, from unpkg. The policy names that package's version directory, not the
 * whole CDN — anything else on unpkg stays blocked. When the host moves to a newer version the picker
 * stops loading inside the preview (the site itself is unaffected) and this constant follows.
 */
const REACT_GRAB_SRC = "https://unpkg.com/react-grab@0.2.0/";

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const DEFAULT_SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
/** The grievance board's Worker (`lib/grievance/api.ts` holds the same default); `VITE_GRIEVANCE_API_URL` moves both. */
const DEFAULT_GRIEVANCE_API = "https://greenwave-bengaluru-backend.rork.app";

function originOf(url: string | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

/**
 * Content Security Policy as a <meta> tag — the host sets no response headers for us. Production
 * builds only: the dev server injects inline scripts for HMR and React Fast Refresh.
 *   script   this origin — and, on Rork only, inline plus react-grab's version directory on unpkg
 *            (REACT_GRAB_SRC). Our own build emits no inline script (the MapLibre worker is a same-origin
 *            chunk), but the Rork host injects its own inline scripts into every served page — preview
 *            bridge, runtime-log forwarding, the "Built with Rork" badge on published builds — and a
 *            react-grab script tag for the editor preview. Their contents change with the platform, so
 *            hashes are not an option; 'unsafe-inline' keeps them working there, and the protection comes
 *            from the other directives below, which bound what any script (ours, the host's, or an
 *            injected one) can reach. On Vercel (SERVED_AS_BUILT) neither allowance is emitted.
 *   style    this origin; 'unsafe-inline' for style attributes, the notification library's injected
 *            <style> and the host badge's shadow-DOM styles
 *   font     this origin only — IBM Plex is bundled (@fontsource), so no font request leaves the site
 *   connect  this origin (the JSON datasets; the host's same-origin /__logs socket) + the basemap style
 *            host + the imagery host + the grievance board's Worker (the one server of ours, since
 *            2026-09-11: VITE_GRIEVANCE_API_URL or the project default) — nowhere else can data be sent
 *   img      the same hosts plus data: / blob: for MapLibre's sprites and decoded tiles (the board's
 *            photos come from the Worker's origin)
 *   analytics  only when VITE_GA_MEASUREMENT_ID holds a GA4 id: the Google tag loader joins script-src and
 *            the GA4 collection hosts join connect-src / img-src (GA_HOSTS). No id, no Google host.
 *   frame / object / base-uri / form-action  nothing embedded, no plugins, no <base> hijack, forms post
 *            only to this origin (being framed BY the Rork preview is a header matter meta CSP cannot touch)
 * Another basemap or imagery host is allowed by pointing VITE_MAP_STYLE_URL / VITE_SATELLITE_TILE_URL at
 * it; hosts a custom style JSON references internally go in GW_CSP_EXTRA_ORIGINS (space separated).
 */
function csp(env: Record<string, string>): Plugin {
  const extra = (process.env.GW_CSP_EXTRA_ORIGINS ?? "").split(/[\s,]+/).map(originOf).filter((o): o is string => o !== null);
  const hosts = Array.from(new Set([originOf(env.VITE_MAP_STYLE_URL) ?? originOf(DEFAULT_STYLE_URL), originOf(env.VITE_SATELLITE_TILE_URL) ?? originOf(DEFAULT_SATELLITE_URL), originOf(env.VITE_GRIEVANCE_API_URL) ?? originOf(DEFAULT_GRIEVANCE_API), ...extra].filter((o): o is string => o !== null)));
  const analytics = GA_MEASUREMENT_ID.test((env.VITE_GA_MEASUREMENT_ID ?? "").trim().toUpperCase());
  const ga = (kind: keyof typeof GA_HOSTS): string => (analytics ? ` ${GA_HOSTS[kind].join(" ")}` : "");
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    `script-src 'self'${SERVED_AS_BUILT ? "" : ` 'unsafe-inline' ${REACT_GRAB_SRC}`}${ga("script")}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${hosts.join(" ")}${ga("img")}`,
    `connect-src 'self' ${hosts.join(" ")}${ga("connect")}`,
    "manifest-src 'self'",
  ].join("; ");
  return {
    name: "thetraffic:csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

/**
 * Fails the build when the output carries an environment value it must not: a `VITE_…` key NAME in a
 * chunk means some module read `import.meta.env` wholesale; the VALUE of a non-allow-listed VITE_ key
 * or of any credential-like variable means a secret reached the output by some other route. Every
 * text file the build emits is scanned — chunks, CSS, the HTML, JSON, SVG — not chunks alone, and the
 * plugin runs after Vite's own so the finished index.html is in the bundle it sees. The support
 * mailbox is exempt: it is printed on /support by design, whatever else may hold it (a stale reviewer
 * list, say).
 */
function envHygiene(env: Record<string, string>): Plugin {
  const publicValues = [parseMailbox(env.VITE_SUPPORT_EMAIL)].filter((v): v is string => v !== null);
  const forbidden = Object.entries(env).filter(([k, v]) => v.trim().length >= 8 && !CLIENT_ENV.includes(k) && !publicValues.includes(v.trim()) && (k.startsWith("VITE_") || SENSITIVE_NAME.test(k)));
  const decoder = new TextDecoder();
  return {
    name: "thetraffic:env-hygiene",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [file, out] of Object.entries(bundle)) {
        let text: string;
        if (out.type === "chunk") text = out.code;
        else if (TEXT_ASSET.test(file)) text = typeof out.source === "string" ? out.source : decoder.decode(out.source);
        else continue;
        if (out.type === "chunk") {
          const key = /\bVITE_[A-Z0-9_]+\b/.exec(text);
          if (key) throw new Error(`[thetraffic] ${file} contains the env key name ${key[0]}: a module reads import.meta.env as a whole object, which inlines every VITE_ value. Read import.meta.env.${key[0]} directly instead.`);
        }
        for (const [k, v] of forbidden) if (text.includes(v.trim())) throw new Error(`[thetraffic] ${file} contains the value of ${k}, which the browser must never receive.`);
      }
    },
  };
}

/** The public origin for the sitemap: `VITE_SITE_URL` when it is an https origin, else the project's host. */
const DEFAULT_SITE_URL = "https://greenwave-bengaluru.rork.app";
function siteOrigin(env: Record<string, string>): string {
  const o = originOf(env.VITE_SITE_URL);
  return o && o.startsWith("https://") ? o : DEFAULT_SITE_URL;
}

/** The screens a search engine should list, with how often each changes. Junction pages are added from the dataset. */
const SITEMAP_ROUTES: { path: string; changefreq: "daily" | "weekly" | "monthly"; priority: string }[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/signals", changefreq: "weekly", priority: "0.9" },
  { path: "/grievances", changefreq: "daily", priority: "0.9" },
  { path: "/grievance", changefreq: "monthly", priority: "0.7" },
  { path: "/surveillance", changefreq: "weekly", priority: "0.8" },
  { path: "/research", changefreq: "weekly", priority: "0.6" },
  { path: "/methodology", changefreq: "monthly", priority: "0.5" },
  { path: "/support", changefreq: "monthly", priority: "0.4" },
  { path: "/console", changefreq: "monthly", priority: "0.4" },
];

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * `sitemap.xml`, emitted at build from the routes above plus one entry per junction in the signal
 * dataset (the junction id is the URL; the dataset's OSM base date is every junction's lastmod), so
 * the sitemap never drifts from the pages the site actually has. Pure given the dataset text.
 */
export function buildSitemap(origin: string, datasetJson: string, today: string): string {
  let junctions: { id: string }[] = [];
  let lastmod = today;
  try {
    const data = JSON.parse(datasetJson) as { meta?: { source?: { osm_timestamp_base?: string } }; intersections?: { id: string }[] };
    junctions = (data.intersections ?? []).filter((i) => /^gw-[0-9a-f]{12}$/.test(i.id));
    const base = data.meta?.source?.osm_timestamp_base;
    if (typeof base === "string" && /^\d{4}-\d{2}-\d{2}/.test(base)) lastmod = base.slice(0, 10);
  } catch {
    /* no dataset: the static routes alone */
  }
  const rows = [
    ...SITEMAP_ROUTES.map((r) => `  <url><loc>${xmlEscape(origin + r.path)}</loc><lastmod>${today}</lastmod><changefreq>${r.changefreq}</changefreq><priority>${r.priority}</priority></url>`),
    ...junctions.map((j) => `  <url><loc>${xmlEscape(`${origin}/intersection/${j.id}`)}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

function sitemap(env: Record<string, string>): Plugin {
  return {
    name: "thetraffic:sitemap",
    apply: "build",
    generateBundle() {
      let dataset = "";
      try {
        dataset = readFileSync(path.resolve(import.meta.dirname, "public/data/intersections.v1.json"), "utf8");
      } catch {
        /* the static routes alone */
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: buildSitemap(siteOrigin(env), dataset, new Date().toISOString().slice(0, 10)) });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Every variable the build machine holds (files + process.env), for the two guards above only.
  const env = loadEnv(mode, import.meta.dirname, "");
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), csp(env), sitemap(env), envHygiene(env)],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    define: {
      __GW_BUILD__: JSON.stringify(buildStamp),
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // Stable vendor chunks: the map engine and React/Query change far less often than app code.
          manualChunks(id: string): string | undefined {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("maplibre-gl")) return "maplibre";
            if (/node_modules\/(react|react-dom|react-router|react-router-dom|@tanstack|scheduler)\//.test(id)) return "react";
            return undefined;
          },
        },
      },
    },
    // Expose VITE_* only (Vite's default). The browser talks to no server of ours, so nothing
    // Rork-managed (EXPO_PUBLIC_*) is ever inlined.
    envPrefix: ["VITE_"],
  };
});
