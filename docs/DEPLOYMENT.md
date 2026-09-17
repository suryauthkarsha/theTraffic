# Deployment

## Pieces

| Piece | Where | Notes |
| --- | --- | --- |
| `web/` | static Vite build (`bun run build` → `dist/`); public host `https://www.thetraffic.in` (Vercel, since 2026-09-12 — the apex `thetraffic.in` redirects to it), also served on the Rork host | MapLibre + OpenFreeMap; reads eight `VITE_*` values at build time; talks to one server of ours — the grievance board's Worker — to DataFast, and to Google Analytics when configured |
| `functions/` | Cloudflare Worker + two Durable Object classes | the grievance board (since 2026-09-11): `GET/POST /grievances`, `GET /grievances/:id`, `GET /grievances/:id/photo`, moderation routes; `GET /ping`; `410 Gone` on the former gateway routes (`/mapbox/*`, `/tomtom/*`). Reads two env values (`GRIEVANCE_ADMIN_KEY`, `GRIEVANCE_ALLOWED_ORIGINS`); stores grievances and their photos in Durable Object SQLite — see **The Worker** |

The web app plus the Worker are the whole deployment — Rork publishes both today, and the web app
deploys to Vercel as-is (see **Vercel** below) while the Worker stays on Rork (or any Cloudflare
account — it is vanilla Cloudflare). There is no database of visitors, no authentication and no route
planner: every dataset the site shows is a versioned JSON under `web/public/data`, built by `scripts/`;
the one store is the grievance board, which holds what people choose to post without requesting an
account or identity. Visible words, photos, places and times may still identify someone. (The Supabase project, edge functions and `services/model-api` scaffold of 2026-09-07 were
removed on 2026-09-08, the planner and its gateway client the same day, and the gateway Worker itself
on 2026-09-09. The `EXPO_PUBLIC_SUPABASE_*`, `VITE_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`,
`ADMIN_REVIEWER_EMAILS`, `TOMTOM_*` and `VITE_MAPBOX_ACCESS_TOKEN` values still present in the project
environment are read by nothing and should be deleted — the build fails if any of their values reaches
a chunk.)

## Tabs left open across a deploy

Every build renames the hashed chunks under `/assets`, and both hosts serve `index.html` with
`no-cache`, so a fresh visit always gets the current build. A tab opened *before* a deploy keeps the
old `index.html`; the first screen it opens afterwards asks for a chunk that no longer exists
(`Failed to fetch dynamically imported module …`) — the "build failures" a long-lived preview tab
seems to show while the site is being worked on. The error boundary recognises this case
(`web/src/lib/system/staleBuild.ts`): it shows **update · A newer version of the site is ready** rather
than a failure, and reloads the tab once by itself, keyed on the failing chunk in `sessionStorage` (this
tab only), so an actual outage of the asset host falls through to the panel's own Reload instead of
looping. Nothing else is stored.

## Vercel

`web/vercel.json` deploys only the static frontend. The built site still calls the separately deployed
grievance Worker at `VITE_GRIEVANCE_API_URL` or the default Rork Worker origin, cross-origin — so the
Worker must grant the site's host by name (see **Domain** below).

**Project settings** — Vercel → Add New → Project → import the GitHub repository:

- **Root Directory: `web`.** The repository is a monorepo; without this Vercel finds no `package.json`
  and does not read `web/vercel.json`.
- Framework preset **Vite** (detected). Install `bun install` (detected from `bun.lock`), build
  `vite build`, output `dist` — leave all three on their defaults. Node 22 or newer (Vite 8 needs it;
  Vercel's current default qualifies).
- Environment variables, for Production and Preview: `VITE_GA_MEASUREMENT_ID` (Google Analytics —
  without it the site measures nothing, see Analytics) and `VITE_SUPPORT_EMAIL` (the Support page's
  mailbox — without it the page offers the clipboard alone). Optional: the basemap values and
  `GW_CSP_EXTRA_ORIGINS` from `.env.example`. Add no other `VITE_` value — the hygiene gate under
  Environment fails the build when one reaches the output. All are read at build time: changing one
  means redeploying.

**What `web/vercel.json` does:**

- `rewrites` — every path that is not a file is answered with `index.html`, so a direct link to
  `/signals` or `/intersection/…` reaches the router (this is the rule the 2026-09-09 GitHub commit
  added). `/assets/` and `/data/` are excluded on purpose: a missing chunk or dataset answers 404, not
  the HTML page, and `lib/data/dataset.ts` reports `Failed to load … 404` instead of a JSON parse error.
- `headers` — the set `web/public/_headers` gives Cloudflare Pages / Netlify (Vercel does not read
  that file; `security.test.ts` keeps the two identical): `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy` (`geolocation=(self)` since 2026-09-11 — the Grievance page's “Use my location”
  button asks for the device position at the press; camera, microphone, payment and USB stay off — the
  Grievance photo comes through the operating system's file picker, never a live camera), COOP. Plus the clickjacking rule a `<meta>` policy cannot carry and the Rork
  preview frame forbids elsewhere: `X-Frame-Options: DENY` and a header policy
  `Content-Security-Policy: frame-ancestors 'none'`, which sits beside the `<meta>` policy (browsers
  enforce both). HSTS is not repeated — Vercel sends it on every response (`max-age=63072000`); a
  second value would only shorten it. Hashed build output under `/assets/` is cached `immutable` for
  a year; datasets and `index.html` keep Vercel's revalidate-on-every-load default, so a new deploy is
  seen at once.
- The `<meta>` Content Security Policy is tighter on Vercel: `vite.config.ts` sees `VERCEL=1` in the
  build environment (`SERVED_AS_BUILT`) and emits `script-src 'self' https://datafa.st` — plus the Google
  tag loader when Google Analytics is configured — with no `'unsafe-inline'` and no unpkg allowance, because nothing injects
  scripts into the served HTML there. One consequence: the Vercel Toolbar (a script from `vercel.live`
  on preview deployments) is blocked by the policy. Switch it off under Settings → Vercel Toolbar or
  ignore the console line; it is not part of the site.
- The build stamp on the error panel and in support mails carries the short commit
  (`2026-09-09 10:15Z · a1b2c3d`, from `VERCEL_GIT_COMMIT_SHA`), so a report names the deployment.

**Verify after the first deploy:** `curl -sI https://<deployment>/console` shows the headers above with
`content-type: text/html`; `curl -sI https://<deployment>/data/nothing.json` is `404`; the browser
console shows no `Refused to …` line while roads, imagery and signal dots load; the DataFast dashboard
shows the visit within a few minutes, and with a measurement id set so does the GA4 Realtime report.

**Domain.** `www.thetraffic.in` is the public host (Vercel → Settings → Domains, 2026-09-12); the apex
`thetraffic.in` answers `308` to it, Vercel's redirect for the second domain. Two things had to know
the name:

- The Worker grants browser origins by name, so a page served from a host it does not know gets
  `403 origin not allowed` with no CORS grant, and the board can only say "could not be reached" —
  which is what the domain got for its first hours. `https://www.thetraffic.in` and the apex are built
  in as exact origins (`DEFAULT_ORIGINS` in `functions/_lib/http.ts`, pinned by
  `functions/tests/http.test.ts` together with the look-alikes `evilthetraffic.in` and
  `thetraffic.in.evil.example`; no suffix wildcard, so a sibling on a multi-tenant host is never
  granted). `GRIEVANCE_ALLOWED_ORIGINS` is for a *further* exact origin and needs no redeploy.
- Search engines see more than one copy of the site (this domain, the Rork host, every Vercel
  preview). Every copy names `https://www.thetraffic.in` as the one address: the canonical link, Open
  Graph / Twitter URLs and JSON-LD in every pre-rendered page, the sitemap line in `robots.txt`, the
  sitemap's own entries, and the per-route canonicals `usePageTitle` writes (`DEFAULT_SITE_URL` in
  `lib/system/routeMeta.ts` and `vite.config.ts`). `VITE_SITE_URL` overrides all of them for a further domain.

## Search pages

User request 2026-09-13 ("improve SEO"). A single-page app answers every address with one `index.html`,
so a crawler that runs no script — and every link preview — saw the home page's title, description
and canonical link at `/signals`, on the board and on each of the 579 junction pages: every screen a
duplicate of the home page to it. The build now writes **one HTML file per screen and per junction**
(`lib/system/prerender.ts`, the `thetraffic:search-pages` plugin in `vite.config.ts`): after Vite has
finished `index.html` — policy injected, chunks hashed — the plugin copies it to `signals/index.html`,
`grievances/index.html`, `intersection/<id>/index.html`, … with that page's own `<title>`, description,
robots directive, canonical link, Open Graph / Twitter tags and a JSON-LD graph (`WebPage`,
`BreadcrumbList`; a junction as a `Place` with its coordinates and OpenStreetMap nodes; on `/signals`,
`/surveillance` and `/research` the two ODbL datasets as `Dataset` records built from each file's own
`meta` — counts, base date, licence, download URL — never written in). Nothing executable is added: the
pages are the template byte for byte outside those tags, and the hygiene gate scans every one of them.
`sitemap.xml` comes from the same table (`STATIC_ROUTES` in `lib/system/routeMeta.ts` plus the dataset),
so it never names a page the build does not write; junction entries carry the dataset's OSM base date
as `lastmod`, the screens carry none rather than the build's date. The root `index.html` stays the home
page and the rewrite fallback for unknown paths (404 → `noindex`).

Where it takes effect: Vercel — the public host — gives the filesystem precedence over rewrites and
serves `foo/index.html` for `/foo` (the way every static-site generator's directory output is served
there), so `/signals` answers the Signal Map's own head and the rewrite catches only addresses no file
answers. `"trailingSlash": false` in `web/vercel.json` answers `/signals/` with a `308` to `/signals`,
so each page has one address (without it a page with a folder behind it is reachable both ways and
Search Console reports duplicates). The Rork host is different: its route map answers an extensionless
path with the root `index.html` before it looks for a folder's index (`/signals` → the home page's head;
`/signals/index.html` → the Signal Map's), so on `*.rork.live` the per-page head still arrives only
once the script runs, as before — and that copy is never the indexed one, because every page's
canonical link names `www.thetraffic.in`. On both hosts the tab shows the same title the crawler
downloads from Vercel: `usePageTitle` sets `document.title` from the same table ("Signal Map ·
Bengaluru traffic signals & timing · theTraffic."; a junction page: "<name> · signal timing,
Bengaluru · theTraffic.") and rewrites the head tags in place once the screen mounts.

Verify after a deploy: `curl -s https://www.thetraffic.in/signals | grep -E '<title>|canonical'` shows
the Signal Map's title and `https://www.thetraffic.in/signals`; `curl -sI https://www.thetraffic.in/signals/`
is `308` to `/signals`; `curl -s https://www.thetraffic.in/sitemap.xml | grep -c '<url>'` is the screen
count plus the junction count (589 with the 2026-09-05 dataset); Google's Rich Results Test on a
junction address finds `BreadcrumbList` and `Place`. Search Console: submit `sitemap.xml` once; after a
deploy that changes titles, request indexing of the home page — results follow the recrawl (days to
weeks), never the deploy.

Verify: `curl -s -D - -o /dev/null -H 'Origin: https://www.thetraffic.in' https://greenwave-bengaluru-backend.rork.app/grievances?limit=1`
shows `200` and `access-control-allow-origin: https://www.thetraffic.in`; `curl -s https://www.thetraffic.in/ | grep canonical`
names the domain.

## Environment

See `.env.example`. The web app needs nothing to run. `VITE_SUPPORT_EMAIL` is the support mailbox
(printed on `/support` — public by design, so the hygiene gate below exempts that one value); it is
the only place the address exists, there is no built-in default since the 2026-09-09 audit, and a
build without it offers the clipboard alone. Optional: `VITE_MAP_STYLE_URL` / `VITE_SATELLITE_TILE_URL`
(+ `VITE_SATELLITE_ATTRIBUTION`) if you want a different basemap; `VITE_GA_MEASUREMENT_ID` (a GA4
`G-XXXXXXXXXX` id) switches Google Analytics on — see Analytics below; `VITE_GRIEVANCE_API_URL` points
the board at a self-hosted Worker (default: the project's own, `https://greenwave-bengaluru-backend.rork.app`;
the CSP `connect-src` / `img-src` follow the value); `VITE_SITE_URL` is the public origin written into
the sitemap and canonical links (default: the site's own domain, `https://www.thetraffic.in` — set it
only for a further domain). Build-time only: `GW_BUILD` (the stamp on
the error panel; by default the build's date and time, on Vercel followed by the short commit) and
`GW_CSP_EXTRA_ORIGINS` (see below). Scripts only: `GW_CONTACT`, the e-mail address or URL the Overpass
sync puts in its `User-Agent`. Worker only (project settings, never in source): `GRIEVANCE_ADMIN_KEY`
(the moderator passphrase, at least 20 characters — without it the moderation routes answer 503 and
nothing can be removed) and `GRIEVANCE_ALLOWED_ORIGINS` (extra exact https origins for a further
site or preview, space or comma separated; wildcards are rejected — `www.thetraffic.in`, the apex,
the public Rork host, this project's preview and localhost are built in).

Modules read env values one key at a time (`import.meta.env.VITE_SUPPORT_EMAIL`). Never read
`import.meta.env` as a whole object: Vite then inlines every `VITE_*` value the build machine holds,
which is how a Mapbox token and a retired Supabase key once reached the bundle. `vite.config.ts`
(`envHygiene`) fails the build when a `VITE_` key name, or the value of any variable whose name looks
like a credential (`KEY`, `TOKEN`, `SECRET`, `SUPABASE`, `MAPBOX`, …), appears in any emitted text
file — chunks, CSS, the finished `index.html`, JSON, SVG (since 2026-09-09; before that chunks only).

## Content Security Policy

The host sets no response headers for us, so the policy is a `<meta http-equiv>` tag injected into
`index.html` at build time (`csp` plugin in `vite.config.ts`; the dev server is exempt because HMR
and Fast Refresh inject inline scripts):

- `script-src 'self' 'unsafe-inline' https://unpkg.com/react-grab@0.2.0/ https://datafa.st` on Rork — our build emits no
  inline script (the MapLibre worker is a same-origin chunk), but the Rork host injects its own inline
  scripts into every served page (preview bridge, runtime-log forwarding over a same-origin `/__logs`
  WebSocket, the “Built with Rork” badge on published builds) and a `react-grab` script tag for the
  editor preview's element picker. Their contents change with the platform, so they cannot be hashed;
  inline stays allowed and the protection comes from the directives below, which bound what any script
  can reach. The unpkg allowance names react-grab's version directory, not the CDN (`REACT_GRAB_SRC`
  in `vite.config.ts`): when the host moves to a newer version the picker stops loading inside the
  preview — the site is unaffected — and the constant follows. On Vercel the directive is
  `script-src 'self' https://datafa.st` (plus the Google tag loader when configured): the build sees
  `VERCEL=1` and emits neither allowance, because the HTML is served exactly as built (see Vercel above).
- `style-src 'self' 'unsafe-inline'`, `font-src 'self'` — IBM Plex is bundled (`@fontsource`, imported in
  `main.tsx`), so no stylesheet or font comes from Google Fonts any more (2026-09-09).
- `connect-src` / `img-src` — this origin (the JSON datasets) plus the origins of `VITE_MAP_STYLE_URL`
  and `VITE_SATELLITE_TILE_URL` (defaults: `tiles.openfreemap.org`, `server.arcgisonline.com`); data can
  be sent nowhere else. A custom style JSON that references further hosts needs them in
  `GW_CSP_EXTRA_ORIGINS` (space-separated origins) or its tiles will be blocked. `connect-src` alone
  also carries `https://datafa.st`, DataFast's page-view endpoint (it sends no pixel, so `img-src`
  does not).
- `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `https://datafa.st` in `script-src` and `connect-src` on every build (`DATAFAST_ORIGIN`, 2026-09-13):
  DataFast's loader and its `/api/events` endpoint. No key and no setting — the website id lives in
  `lib/system/analytics.ts`, and `security.test.ts` pins the loader's origin to the policy's.
- Only when `VITE_GA_MEASUREMENT_ID` holds a GA4 id: `https://www.googletagmanager.com` joins
  `script-src`, and `https://*.google-analytics.com https://*.analytics.google.com
  https://www.googletagmanager.com` join `connect-src` / `img-src` (Google's documented set for the
  Google tag). The ads / Google-signals hosts are left out on purpose.

Verify after a deploy: the page loads roads, imagery and signal dots with no `Refused to …` line in
the browser console. If Rork's host ever stops injecting scripts, drop the two allowances there as
well (the Vercel build already shows what the policy looks like without them).

### Security headers

A `<meta>` policy cannot carry `frame-ancestors`, and Rork's static host sets only
`strict-transport-security` and `x-content-type-options` for us. `web/public/_headers` holds the
headers a Cloudflare Pages or Netlify deployment would add (`Referrer-Policy`, `Permissions-Policy`,
HSTS for a year, COOP); Rork ignores the file today, so on `*.rork.live` it is a no-op. Vercel adds
`X-Frame-Options: DENY` and `frame-ancestors 'none'`. As a defense in depth for hosts that cannot set
those response headers, `lib/system/frame.ts` disables grievance posting and moderator actions when
the app detects that it is embedded. Read-only maps and the board may still render in an editor frame.

## Security

Audit of 2026-09-09 (user request: “remove all sensitive details … fix every single vulnerability”).
What the repository now enforces, and what only the owner can do.

**In the repository (done, guarded by `web/src/test/security.test.ts`):**

- No credential, personal mailbox or personal phone number in any committed file; the test scans
  source, scripts, docs, data and public assets for JWTs, `pk.`/`sk_` tokens, cloud keys, private-key
  blocks, Supabase project URLs, Gmail addresses and Indian mobile numbers.
- The support mailbox exists only as `VITE_SUPPORT_EMAIL`; the Overpass contact only as `GW_CONTACT`.
- `.gitignore` (root, `web/`, `functions/`) ignores every env variant (`.env`, `.env.*`, `*.local`,
  `.dev.vars`) except `.env.example`, all of `.rork/` except `DESIGN.md`, and Python bytecode (the
  committed `__pycache__` files were removed).
- Fonts bundled; CSP `style-src` / `font-src` are `'self'`; the only CDN allowance is react-grab's
  pinned version directory.
- Every `target="_blank"` link is `rel="noopener noreferrer"`; Support pre-fill from links is capped
  (`detail` 300, `ref` 120 characters; `from` must be a same-site path).
- The Worker answers with JSON-only headers (`nosniff`, `no-store`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `default-src 'none'`, HSTS) and grants CORS only to the exact public
  site origins (`https://www.thetraffic.in` and the apex since 2026-09-12, the public Rork host, this
  project's preview), localhost development origins, and exact https origins in
  `GRIEVANCE_ALLOWED_ORIGINS`. Multi-tenant wildcards are rejected; credentials are never allowed.
  The rules are guarded by `functions/tests` and the web security test.
- `scripts/ingest_opencity_timing.py` refuses a portal resource id that is not a UUID before it
  becomes a file name.
- `bun audit`: 0 known vulnerabilities.

**Repository settings (owner only — the repository's Settings, not files; 2026-09-13):**

What the tree carries: `.github/dependabot.yml` (weekly version bumps for the web app's `bun.lock`, the
Worker's `package-lock.json`, `requirements-dev.txt` and the workflows' actions — minor and patch
versions grouped, one pull request per manifest), `.github/workflows/codeql.yml` (code scanning of the
TypeScript, the Python and the workflows on push, pull request and weekly), every action pinned to a
commit, `permissions: contents: read` at the top of every workflow, no workflow secret and no
`pull_request_target`; `security.test.ts` fails if any of that loosens. What only the owner can switch
on, under **Settings → Code security**:

- **Secret scanning** and **push protection** — GitHub refuses a push that carries a known credential
  shape, which is the one guard that acts before a secret is in the history. (Public repositories get
  scanning free; push protection is a switch.)
- **Dependabot alerts** and **Dependabot security updates** — the alerts are what turn a vulnerable
  transitive dependency into a pull request; `dependabot.yml` alone schedules version bumps.
- **Code scanning** — with `codeql.yml` in the tree, choose *Advanced* setup (or delete the workflow
  and keep *Default*; GitHub refuses results from both at once).
- **Private vulnerability reporting** — already on (`SECURITY.md` points there).
- **Branch protection / a ruleset for `main`** — require the `Web` and `Worker and data pipelines`
  checks to pass and forbid force pushes and deletion, so a failing security test cannot be merged
  around. Require a pull request if anyone else ever gets write access.
- **Actions → General**: leave the workflow permissions at *Read repository contents* (the files ask
  for exactly that) and keep *Allow GitHub Actions to create and approve pull requests* off.

**Public-release safety:**

- Before the first public release, the default branch was rebuilt from a reviewed source snapshot so
  old development commits and personal contact details were not exposed. The public tree contains no
  tracked environment file or Rork session transcript. The ignore rules and security test keep them out.
- Credentials used by retired integrations should still be rotated or deleted in their provider
  dashboards. A history rewrite cannot protect a value that reached a deployment, log, or third party.
- Delete dead Rork environment variables such as the former Supabase, Mapbox and TomTom credentials.
  Nothing reads them, and build machines should not receive unnecessary secrets.
- Set `VITE_SUPPORT_EMAIL` only if the Support page should expose a mailbox, and set `GW_CONTACT` only
  if the Overpass sync should identify an operator contact.

## Analytics

DataFast, added 2026-09-13 (user request: the pasted snippet). `installDataFast` in
`web/src/lib/system/analytics.ts` inserts DataFast's script into `<head>` as an element carrying the
snippet's `data-website-id` (`dfid_…` — public by design, it can only receive page views, so it lives
in source rather than the environment) and `data-domain` (`thetraffic.in`), the way DataFast's own
React Router guide installs it; `index.html` stays free of remote scripts (`security.test.ts`).
Nothing to configure and no env value: it is on for every build and every host. DataFast counts on
its own — a page view on load and one per route change (it wraps `history.pushState`) — and by its
own rules stays silent on localhost and inside an embedded frame, so the Rork editor preview sends
nothing; a browser sending Global Privacy Control gets no script, by ours. Verify on the DataFast
dashboard, where the first page views appear within a few minutes; a `Refused to load the script
'https://datafa.st/js/script.js'` line in the console would mean the policy lost its origin.

Google Analytics 4, added 2026-09-09 (user request). `web/src/lib/system/analytics.ts` inserts the
Google tag as a script element (no inline snippet, so no nonce) when `VITE_GA_MEASUREMENT_ID` is a
well-formed id and the visitor sends no Global Privacy Control signal; a malformed id logs one
warning and loads nothing. The id is read at build time, so it must exist wherever the site is built:
in the Rork project environment for the Rork build, under Settings → Environment Variables for a
Vercel build (then redeploy). Copy it from GA4 Admin → Data streams → your web stream → Measurement ID. The tag is configured with `send_page_view: false`; the site sends one
`page_view` per path from `usePageTitle`, after the screen has set its final title, with the page's
path and no query string. Because the site sends page views itself, switch off **Page changes based
on browser history events** in the property (Admin → Data streams → your stream → Enhanced
measurement → Page views → advanced) — otherwise every route change is counted twice. Verify with
the Realtime report or DebugView while clicking through the site. What is sent and why is written
up for visitors in `docs/PRIVACY.md` and in Support FAQ 4.

## Reviewer decisions

`web/public/data/review_decisions.v1.json` decides which published timing blocks the predictions may use.
It is edited by reviewers outside the app and shipped with the build; changing it is a deploy of the
web app, nothing else.

## The Worker

`functions/` is the grievance board's API (user request 2026-09-11) — the one server of ours the
browser talks to, for the one thing that needs one: grievances are stored so they can be read back
together on `/grievances`. Rork: run the build tool on the `functions` app; logs are available through
`rork-agent logs backend`. Standard Cloudflare deployment is declared in `functions/wrangler.jsonc`.
The entrypoint supports both Rork's `DO` adapter and the `GRIEVANCE_BOARD` / `GRIEVANCE_PHOTOS`
Durable Object bindings. Verify and bundle it with:

```bash
cd functions
npm ci
npm run typecheck
npm run build          # wrangler dry-run
npx wrangler deploy    # real deployment
```

Set `GRIEVANCE_ADMIN_KEY` with `npx wrangler secret put`; list each extra frontend as an exact https
origin in `GRIEVANCE_ALLOWED_ORIGINS`.

**Layout.** `index.ts` routes and validates; `grievance-board.ts` is one Durable Object (`bengaluru-2`)
holding every grievance row in SQLite and applying the rate limits; `grievance-photos.ts` is 256
shards (by the first two hex digits of the id) holding the JPEG bytes; `_lib/validate.ts` is the
schema, `_lib/jpeg.ts` the JPEG gate, `_lib/http.ts` headers and origins, `_lib/cache.ts` how a page
of the board is named and kept. Pure modules are tested with `bun test functions/tests` (28 tests).

**Identity is not requested.** The schema has no identity or contact field, and phone-number and
e-mail patterns are refused in the browser and server. That does not remove names, addresses, faces,
vehicle plates or other identifiers visible in submitted words or pixels. Every grievance carries a
photo (user decision 2026-09-13): a POST without one is refused with `400 Add a photo — every
grievance needs one.` in the Worker before the words or the place are judged, and the board object
refuses a photo-less row again on insert, so no caller of the store can add one; the place and the
words are optional. Photos are shrunk and re-encoded in the browser, then parsed as JPEGs with APPn /
COM metadata stripped before storage.
There is no account cookie or user token. Application logs exclude request bodies and network
addresses, though the hosting provider may process request metadata under its own policies. The
caller's address is hashed at the edge and salted again in the board with a random per-day salt
(dropped with the day) before it is counted for rate limits, so the stored counters cannot be turned
back into an address. Filing time is kept to
the minute. Rows: kind · words · place (lng, lat, source, accuracy, nearest junction) · photo facts ·
filed_at. That is all.

**Abuse limits.** Body capped at ~412 KB before it is read (the stream is stopped, Content-Length is
not trusted); JSON part ≤ 8 KB; photo ≤ 400 KB and ≤ 2000 px on a side; words ≤ 2 000 characters;
per caller 20 / hour and 60 / day (generous on purpose: Indian mobile networks put many phones behind
one address); everyone together 120 / minute and 10 000 / day; failed passphrase attempts 10 / hour
per caller. Honeypot field. Browser CORS grants exact origins only (never `*`), but CORS is not
authentication: originless command-line clients can use the public write endpoint and remain subject
to the same validation and rate limits.

**Cost under load** (2026-09-12). A POST asks the board object for its rate-limit verdict *before a
byte of the body is read* (`GET /allowance` inside the Worker, keyed on the same daily-salted hash),
so a caller over a limit costs a few indexed counts — no JPEG parse, no photo write, no row, no
cleanup. The pre-check is read-only and admits nothing by itself: the board repeats it in the same
turn as its insert. The words and the place are judged before the photo is parsed, so any refused
submission — including one without its photo — skips the JPEG walk. A GET of a page is kept three ways, each keyed on the *effective*
page (`limit`, `before`, `kind` after validation, a cursor past the newest row read as the first
page — so `?limit=999&fresh=1` is not a new page and a reader cannot mint pages by counting upward):
the board object keeps every page it has served until the next post or removal (exact, never stale)
and keeps the whole-board counts in memory, so a repeated page is a lookup and a new one is one
indexed query, never a scan; each Worker isolate keeps its pages for 5 seconds in a bounded memory
(128 pages), so a burst asks the object once per distinct page per isolate; and the data centre's
cache does the same where the platform provides one (a custom domain — on the Rork host the Cache
API has no effect, which is why the first two layers exist). A post or a removal clears the object's
pages and forgets the first page of the board and of its kind in the isolate and data centre that
handled it — the poster's next read finds the post — and elsewhere those pages age out within the 5
seconds. `X-Board-Page` on a page names the layer that answered — `memo` (the isolate), `cached` (the
data centre), `kept` (the board object's memory, no query) or `queried` (one indexed query) — so two
requests in a row show it working. Every response: `nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `default-src 'none'`, HSTS; photos get an
image-only CSP with `sandbox` and one-hour caching. A failure no route expected (the platform's
object dispatch, say) still answers as JSON — `502`, `Retry-After: 60`, the caller's CORS grant — so
the browser can read it and the page says "the board is not answering" rather than "could not be
reached", which is what a bare platform error page (no CORS header) produces.

**When the page says the board could not be reached.** The browser got no answer it may read. In
order of likelihood: the tab is offline (the page says so separately); the tab was opened before a
deploy and holds an older policy or bundle (reload); the page is served from an origin the Worker does
not grant, which answers `403 origin not allowed` with no CORS header — add that exact https origin
to `GRIEVANCE_ALLOWED_ORIGINS` (`www.thetraffic.in`, the apex, the public Rork host, this project's
preview and localhost are built in; `www.thetraffic.in` was in this state for its first hours on
2026-09-12, until the Worker learned the name); the Worker is being redeployed (seconds). The failing call is noted in the browser console
(`[thetraffic] board call failed: <name> <message> <path>` — never a header or a body) and reaches
`rork-agent logs runtime`.

**Moderation.** `GRIEVANCE_ADMIN_KEY` in the project settings (≥ 20 characters). On `/grievances`
press **Moderator** at the foot of the page, type the passphrase (kept in memory for the visit only),
then **Remove** on any card — the row and its photo are deleted for good. The passphrase travels as
`Authorization: Bearer` over https, is compared in constant time, and is never written anywhere by
the site. Without the variable the moderation routes answer 503 and the board is append-only.

**Fresh board.** `BOARD_ID` in `index.ts` names the board instance; bumping the suffix opens an empty
board (the smoke-test rows of the first deploys live in the retired `bengaluru` and `bengaluru-1`
instances and are reachable by nothing).

**The passphrase and the agent.** Rork writes project environment values into `web/.env` on the build
machine. That file is gitignored, the build scans for leaked values, and the web code does not read the
moderator passphrase. Agent or CI logs may still persist anything explicitly printed, so never print a
passphrase. If one appears in any transcript or log, rotate it in project settings (≥ 20 characters)
and treat the old value as public; the Worker reads the replacement on the next request.

## Basemap and imagery

Vector tiles come from OpenFreeMap (keyless). The **Satellite** toggle on the city map slots an XYZ
imagery source under the same vector roads and labels; it defaults to Esri World Imagery (attribution
required, rendered automatically). Set `VITE_SATELLITE_TILE_URL` (+ `VITE_SATELLITE_ATTRIBUTION`) to
use Mapbox Satellite, Maxar or any other raster provider — the CSP follows the value. The junction page's
map is pinned to satellite with dimmed imagery. Signal markers are rendered client-side by MapLibre
from the bundled GeoJSON — no extra requests.

## Dependencies

`cd web && bun audit` reports 0 known vulnerabilities (2026-09-09). Keep `vitest`,
`@vitest/browser-playwright` and `playwright` on matching pinned versions; everything else floats
within its caret range. A regenerated lockfile (`rm bun.lock && bun install`) picks up transitive fixes.
