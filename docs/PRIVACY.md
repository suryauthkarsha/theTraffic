# Privacy

theTraffic. has no accounts and no visitor-profile database. The one thing the site stores is what
people choose to post on the grievance board (below, added 2026-09-11). The form does not request an
identity, and the server does not store the caller's network address, but a post's words, visible photo
content, precise place and filing time may identify a person or private location. The earlier
consented-journey design (random research identities, 7-day raw-GPS retention, k ≥ 5 public
aggregates, opt-out and delete-my-data) was removed on 2026-09-08 with the Supabase backend and
survives only as design notes in Methodology §3–§4. The route / departure planner was removed the
same day, so no place a visitor types or picks on the maps is sent anywhere unless they deliberately
post it as a grievance. The site measures its own audience with DataFast and, when configured, Google
Analytics — page views only (see Analytics).

## What leaves the browser

- **Static files only.** The app, its versioned datasets (`web/public/data/*.json`) and fonts are
  fetched from the site's own host (the IBM Plex fonts are bundled with the app since 2026-09-09;
  before that they came from Google Fonts, which saw every visitor's address). Searching for a
  junction, picking a layer, a day or a time, and tapping a signal all happen inside the page; no
  request carries what the visitor did.
- **Basemap tiles** are requested from OpenFreeMap (vector) and Esri (satellite imagery) by the
  browser directly, as any web map does. The tile host sees the map area being viewed, nothing else.
- **Support reports** are composed in the browser and either opened in the visitor's own e-mail app
  (`mailto:` to the support mailbox printed on the page — configured per deployment, never written
  into the code) or copied to the clipboard. Nothing is posted to a server.
  Attached diagnostics are build, page, dataset version, basemap state, browser and viewport — never
  a location.
- **Grievances** (`/grievance` → the public board `/grievances`, 2026-09-11) are the one thing the
  site stores, and the one request that goes to a server of ours (the project's Cloudflare Worker;
  `docs/DEPLOYMENT.md` § The Worker). What is posted is exactly: the kind (pothole, footpath, water,
  crossing, signal, light, parking, other), the shrunk photo — every grievance carries one (user
  decision 2026-09-13); the board refuses a post without it — and, when given, the words and the place
  (a point, how it was set, the nearest junction on file). The form has no identity or contact field, and phone-number
  and e-mail patterns are refused in the browser and again on the server. That filter cannot detect
  every name, postal address, face, vehicle plate, house number, or other identifying detail, so the
  person posting must remove those details before submission. The photo comes through the operating system's
  picker (there is no live camera stream and no camera permission of ours), is shrunk to 1280 px and
  re-encoded in the browser — which drops the camera's own metadata, including its position tags —
  and the server parses it as a JPEG and strips every metadata segment again before storing the
  pixels. The place is only ever the one the visitor marks. “Use my location” and the maps' locate
  button ask the browser for the device position once, at that press (the header policy allows
  `geolocation=(self)` for this reason); the answer is shown on the map, refused if it lies outside
  Bengaluru, and posted only if the visitor uses it as the place. The board keeps the filing time to
  the minute. Rate limits use a hash of the caller's address salted with a random value drawn fresh
  each day and discarded with it. The application does not store or log the raw address, and
  yesterday's counters cannot be traced back to it; the hosting provider may still process request
  metadata under its own policies. A grievance can remain public until a
  moderator removes it. Its visible content and coordinates may still reveal who or what it concerns.
  Leaving the form discards an unposted draft, its photo and its place.
- **The helmet campaign** (`/helmet`, 2026-09-12): nothing. The UPI QR code is drawn in the page from
  the campaign's payment address; the payment links open the visitor's own UPI app — on Android the one
  "Pay with a UPI app" link (`upi://pay`, answered by the system's chooser), on iOS one link per app on
  that app's own scheme (PhonePe, Google Pay, Paytm, CRED, BHIM, or the generic link for another; since
  2026-09-17, because iOS handed `upi://` to WhatsApp). The page reads the browser's own description of
  the device to decide which to show, in the page, and sends it nowhere; the amount chips only change
  the links. The site never learns that a payment was made, how much, or by whom — that stays between
  the payer's bank and the campaign's.
- **DataFast** (since 2026-09-13, on every build). For each page opened and each route change DataFast
  receives the page's address as it stands — path and query string, so a board filter (`?kind=pothole`)
  or a support topic a link pre-filled travels with it — the address of the page the visitor came
  from, viewport and screen size, browser, language and time zone, and a random visitor id and
  session id it keeps in first-party cookies (`datafast_*`). Nothing typed on the site ever enters an
  address, so nothing typed reaches it. By its own rules it does not run inside an embedded frame or
  on localhost; by ours it does not run for a browser that sends Global Privacy Control.
- **Google Analytics 4** (only when the build carries a measurement id — see Analytics). Google
  receives which page was opened and when, its title, the address of the page the visitor came from,
  screen size, browser and language, and derives a coarse location from the network address, which
  GA4 does not store. It never receives anything the visitor types, nor the site's own query
  strings (filters, support topics, references): the page address we report is the path alone.

## Public-post risk and removal

Before posting, remove names, private addresses, faces, vehicle plates, house numbers, documents, and
other identifying details. Post only a road location that is necessary to explain the civic issue.
The service strips JPEG metadata but does not blur or inspect visible pixels.

A moderator may remove a post that exposes personal information, is abusive, or is unrelated to a
road issue. Use the private mailbox shown on the site's Support page to request removal. If that
mailbox is not configured, use a contact route listed on the maintainer's GitHub profile and do not
repeat the sensitive material in a public issue. There is currently no automatic expiry schedule.

## Analytics

- **Two counters, page views only.** DataFast on every build (`web/src/lib/system/analytics.ts`,
  `installDataFast`: the pasted snippet's website id and root domain, inserted as a script element);
  Google Analytics 4 only when `VITE_GA_MEASUREMENT_ID` is set at build time — without it nothing of
  Google's is loaded or sent and the Content Security Policy names no Google host. DataFast's origin
  (`https://datafa.st`) is in the policy's `script-src` and `connect-src` on every build.
- **What each counts.** DataFast counts on its own: one page view on load and one on every route
  change, with the page address as it stands (path and query string). Google Analytics receives one
  `page_view` per screen opened, sent by the site itself once the screen's title is known
  (`web/src/hooks/usePageTitle.ts`), with the path alone — the tag's automatic page view is off. No
  custom events, no user ids, no ads or "Google signals" features — their hosts are not in the
  policy, so such requests would be blocked even if a property setting changed.
- **Global Privacy Control is honoured.** A browser sending the GPC signal gets neither script.
- **Cookies.** DataFast keeps a random visitor id (a year), a session id (half an hour) and a session
  count in first-party cookies (`datafast_visitor_id`, `datafast_session_id`, …). Google Analytics
  sets its own (`_ga`, `_ga_<id>`) to tell a returning browser from a new one. Each holds a random
  id, nothing about the person.
- The Support page says this in one sentence (FAQ 4); this file is the long form.

## What stays in the browser

- The Dark / Satellite basemap choice (`localStorage`).
- After a tab reloads itself because it was open across a deploy: which chunk failed and when
  (`sessionStorage`, this tab only, gone when it closes — it stops a second reload for the same chunk).
- The moderator passphrase, while a moderator has unlocked the board: in the page's memory for that
  visit only, never written anywhere.
- Everything else is transient page state: the junction you are looking at is only ever in the URL
  (`/intersection/<id>`), and the Signal Map's layer, filter, day and time reset on reload.
- The site never asks for the browser's location on its own; the one exception is the Grievance
  page's “Use my location” button, which asks only when pressed (see above).

## Review decisions

Which published timing links are accepted is a committed file (`web/public/data/review_decisions.v1.json`)
written outside the app. It contains junction keys, decisions, timestamps and provenance labels; the
current file explicitly identifies an AI-assisted linkage review. It contains no visitor data.
