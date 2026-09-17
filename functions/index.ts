// functions/index.ts — theTraffic. (Bengaluru): the grievance board's API, and nothing else.
//
// Until 2026-09-11 this Worker was a liveness stub: the routing gateway that once lived here (an open
// proxy for paid map APIs) was retired on 2026-09-09 and the site talked to no server of ours. The
// grievance board changes that deliberately, for one thing only: grievances people file about the
// road — potholes, footpaths, water, missing crossings, signals, anything — are stored here so they
// can be read back on /grievances and shown, as a collection, to the people who can act on them.
//
// Routes
//   GET    /ping                    liveness
//   GET    /grievances              newest first; ?limit= (≤ 60) ?before=<seq> ?kind=
//   POST   /grievances              multipart/form-data: `grievance` (JSON) + `photo` (JPEG ≤ 400 KB, required)
//   GET    /grievances/:id          one grievance
//   GET    /grievances/:id/photo    its stripped JPEG
//   GET    /grievances/moderation   204-style check of the moderator passphrase (Bearer)
//   DELETE /grievances/:id          remove one (Bearer passphrase)
//   ANY    /mapbox/*, /tomtom/*     410 Gone — the former gateway routes, closed for good
//   anything else                   404
//
// The API requests no account or identity field, uses no cookie, and hashes the caller's address before
// rate limiting. Submitted words, visible pixels, precise coordinates and time can still identify a
// person or place. Every response carries security headers; CORS is granted only to exact configured
// origins; bodies are capped before reading; every grievance carries a photo (user decision 2026-09-13 —
// refused here and again in the board without one), which must parse as JPEG and loses its metadata segments.
//
// Cost under load. A POST asks the board for its rate-limit verdict before a byte of the body is read,
// so a caller over a limit costs a few indexed counts — no JPEG parse, no photo write, no row, no
// cleanup. A GET of a page is kept three ways — the board object keeps every page it served until the
// next change (exact), this isolate keeps its pages for LIST_CACHE_SECONDS, and the data centre's
// cache does the same where the platform provides one — each keyed on the effective page, so a
// cache-buster is not a new page and a burst asks the one board object once per distinct page; a post
// or a removal forgets the first pages it changes here, and they age out elsewhere within those
// seconds (_lib/cache.ts).
//
// Env (project settings, never in source): GRIEVANCE_ADMIN_KEY — the moderator passphrase (≥ 20 chars);
// GRIEVANCE_ALLOWED_ORIGINS — further exact https origins the site is served from, space or comma
// separated (www.thetraffic.in, the apex, the public Rork host and this project's preview are built in;
// wildcards are rejected: _lib/http.ts).

import { firstPages, listQuery, listSearch, PageMemo, type ListQuery } from "./_lib/cache";
import { clientHash, errorResponse, jpegResponse, jsonResponse, originAllowed, SECURITY_HEADERS, corsHeaders } from "./_lib/http";
import { inspectJpeg } from "./_lib/jpeg";
import { JSON_MAX_BYTES, kindFilter, PHOTO_MAX_BYTES, PHOTO_REQUIRED, parseSubmission, REQUEST_MAX_BYTES, UUID, type Kind } from "./_lib/validate";
import { photoShard } from "./grievance-photos";

export { GrievanceBoard } from "./grievance-board";
export { GrievancePhotos } from "./grievance-photos";

type InternalFetcher = { fetch(request: Request): Promise<Response> };
type InternalNamespace = { idFromName(name: string): unknown; get(id: unknown): InternalFetcher };

type Env = {
  /** Rork's internal Durable Object dispatcher. */
  DO?: InternalFetcher;
  /** Standard Cloudflare bindings declared in wrangler.jsonc. */
  GRIEVANCE_BOARD?: InternalNamespace;
  GRIEVANCE_PHOTOS?: InternalNamespace;
  GRIEVANCE_ADMIN_KEY?: string;
  GRIEVANCE_ALLOWED_ORIGINS?: string;
};

const BUILD = "2026-09-12.4";
/** The one board. The suffix is a generation: bumping it opens a fresh, empty board (the smoke-test rows of the first deploys live in `bengaluru` and `bengaluru-1`, reachable by nothing). */
const BOARD_ID = "bengaluru-2";

/** Dispatch through Rork's adapter or standard Cloudflare Durable Object namespaces. */
function dispatch(env: Env, className: "GrievanceBoard" | "GrievancePhotos", id: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const req = new Request(`https://internal${path}`, init);
  if (env.DO) {
    req.headers.set("X-Rork-DO-Class", className);
    req.headers.set("X-Rork-DO-Id", id);
    return env.DO.fetch(req);
  }
  const namespace = className === "GrievanceBoard" ? env.GRIEVANCE_BOARD : env.GRIEVANCE_PHOTOS;
  if (!namespace) return Promise.reject(new Error(`Missing Durable Object binding for ${className}`));
  return namespace.get(namespace.idFromName(id)).fetch(req);
}

/** Re-issue a DO's response with the CORS grant for this caller (DO responses carry none). */
function withOrigin(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

/** A page as this isolate keeps it: the board's answer, serialized, with the headers it came with. Nothing about a caller. */
interface KeptPage {
  status: number;
  headers: [string, string][];
  body: string;
}

/** The pages this isolate has served, kept LIST_CACHE_SECONDS and bounded: a burst asks the board once per distinct page. */
const pages = new PageMemo<KeptPage>();

/**
 * The data centre's cache, where the platform provides one (a Worker on a custom domain; not the Rork
 * host or a *.workers.dev preview, where these calls have no effect). Null means the isolate's memory alone.
 */
function pageCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

/** The cache key of a page: this host, the board's path, the effective page — nothing a caller can vary. */
function pageKey(url: URL, q: ListQuery): Request {
  return new Request(`${url.origin}/grievances${listSearch(q)}`);
}

/**
 * Which layer answered, named in `X-Board-Page` so each can be checked from outside with two requests:
 * `memo` (this isolate) or `cached` (the data centre) set here; `kept` (the board object's memory, no
 * query) or `queried` (one indexed query) left as the object said when the page is fresh from it.
 */
function pageResponse(page: KeptPage, state?: "memo" | "cached"): Response {
  const headers = new Headers(page.headers);
  if (state) headers.set("X-Board-Page", state);
  return new Response(page.body, { status: page.status, headers });
}

/** A page of the board: this isolate's memory, then the data centre's cache, then the board object — and kept for the next reader. */
async function listPage(env: Env, url: URL, ctx: ExecutionContext | undefined): Promise<Response> {
  const q = listQuery(url.searchParams);
  const search = listSearch(q);
  const now = Date.now();
  const memo = pages.get(search, now);
  if (memo) return pageResponse(memo, "memo");
  const cache = pageCache();
  const key = pageKey(url, q);
  if (cache) {
    const kept = await cache.match(key).catch(() => undefined);
    if (kept) return pageResponse({ status: kept.status, headers: [...kept.headers], body: await kept.text() }, "cached");
  }
  const res = await dispatch(env, "GrievanceBoard", BOARD_ID, `/list${search}`);
  if (!res.ok) return res;
  const page: KeptPage = { status: res.status, headers: [...res.headers], body: await res.text() };
  pages.set(search, page, now);
  if (cache) {
    const put = cache.put(key, pageResponse(page, "cached")).catch(() => undefined);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
    else await put;
  }
  return pageResponse(page);
}

/** Forget the first pages a change of `kind` alters — in this isolate and this data centre's cache; elsewhere they age out within LIST_CACHE_SECONDS. */
async function forgetPages(url: URL, kind: Kind | null): Promise<void> {
  const first = firstPages(kind);
  pages.forget(first.map(listSearch));
  const cache = pageCache();
  if (!cache) return;
  await Promise.all(first.map((q) => cache.delete(pageKey(url, q)).catch(() => false)));
}

/** A body the caller declares larger than `max` is refused before anything is asked of the board. The stream cap below does not rely on the declaration. */
function declaredTooLarge(request: Request, max: number): boolean {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  return Number.isFinite(declared) && declared > max;
}

/**
 * Read at most `max` bytes of a body; null when it runs longer. The cap does not trust Content-Length
 * (a proxy may strip it, a client may lie): the stream itself is stopped at the limit.
 */
async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (declaredTooLarge(request, max)) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

async function submit(request: Request, env: Env, url: URL, origin: string | null): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) return errorResponse("The grievance could not be read.", 415, origin);
  if (declaredTooLarge(request, REQUEST_MAX_BYTES)) return errorResponse("The photo is too large — pick a smaller one.", 413, origin);

  // The rate-limit verdict first, before a byte of the body is read: a caller over a limit costs the
  // board a few indexed counts and this Worker nothing — no JPEG parse, no photo write, no row, no
  // cleanup. Read-only: the board repeats the check in the same turn as its insert, so this pre-check
  // never admits a post by itself; it only refuses early.
  const client = await clientHash(request);
  const allowanceHeaders: Record<string, string> = {};
  if (client) allowanceHeaders["X-Grievance-Client"] = client;
  const allowance = await dispatch(env, "GrievanceBoard", BOARD_ID, "/allowance", { headers: allowanceHeaders });
  if (!allowance.ok) return withOrigin(allowance, origin);

  const body = await readBodyCapped(request, REQUEST_MAX_BYTES);
  if (body === null) return errorResponse("The photo is too large — pick a smaller one.", 413, origin);
  if (body.byteLength === 0) return errorResponse("The grievance could not be read.", 400, origin);

  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body).buffer, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return errorResponse("The grievance could not be read.", 400, origin);
  }
  const rawJson = form.get("grievance");
  if (typeof rawJson !== "string" || rawJson.length > JSON_MAX_BYTES) return errorResponse("The grievance could not be read.", 400, origin);
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    return errorResponse("The grievance could not be read.", 400, origin);
  }

  // A text part named `photo` is not a photo: it counts as none, and the rules below say so.
  const entry = form.get("photo");
  const file = entry !== null && typeof entry !== "string" ? entry : null;
  if (file !== null && file.size > PHOTO_MAX_BYTES) return errorResponse("The photo is too large — pick a smaller one.", 413, origin);

  // The words and the place are judged before the photo is parsed, so a submission the rules refuse
  // — including one that arrived without its photo — costs no walk of the JPEG. A file that then fails
  // the JPEG gate is refused below, as before.
  const parsed = parseSubmission(raw, file !== null);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status, origin);
  if (file === null) return errorResponse(PHOTO_REQUIRED, 400, origin); // already refused above; keeps the file's type honest

  const photo = inspectJpeg(new Uint8Array(await file.arrayBuffer()));
  if (!photo) return errorResponse("That photo could not be read — a JPEG from the form is expected.", 400, origin);

  const id = crypto.randomUUID();
  const stored = await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", "X-Photo-Width": String(photo.width), "X-Photo-Height": String(photo.height) },
    body: new Uint8Array(photo.bytes).buffer,
  });
  if (!stored.ok) return errorResponse("The photo could not be stored — try again.", 502, origin);
  const res = await dispatch(env, "GrievanceBoard", BOARD_ID, "/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, submission: parsed.value, photo: { width: photo.width, height: photo.height, bytes: photo.bytes.byteLength }, client }),
  });
  if (!res.ok) await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, { method: "DELETE" }).catch(() => undefined);
  // Awaited, not deferred: the poster's next read of the board must find the post at the top.
  if (res.ok) await forgetPages(url, parsed.value.kind);
  return withOrigin(res, origin);
}

async function remove(request: Request, env: Env, url: URL, id: string, origin: string | null): Promise<Response> {
  const client = await clientHash(request);
  const headers: Record<string, string> = { Authorization: request.headers.get("Authorization") ?? "" };
  if (client) headers["X-Grievance-Client"] = client;

  // Prove the caller is a moderator before touching either store. Delete photo bytes first, and do
  // not report success or remove the board row if that deletion fails, so the operation is retryable.
  const authorized = await dispatch(env, "GrievanceBoard", BOARD_ID, "/moderation", { headers });
  if (!authorized.ok) return withOrigin(authorized, origin);
  const item = await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`);
  if (!item.ok) return withOrigin(item, origin);
  const publicItem = (await item.json()) as { photo?: unknown; kind?: string };
  if (publicItem.photo) {
    const photoRemoved = await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, { method: "DELETE" });
    if (!photoRemoved.ok) return errorResponse("The photo could not be removed — the grievance is unchanged. Try again.", 502, origin);
  }
  const removed = await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`, { method: "DELETE", headers });
  if (removed.ok) await forgetPages(url, kindFilter(publicItem.kind ?? null));
  return withOrigin(removed, origin);
}

/** The routes, once the caller's origin has been judged. `grant` is the origin to name in CORS, or null. */
async function route(request: Request, env: Env, url: URL, path: string, grant: string | null, ctx: ExecutionContext | undefined): Promise<Response> {
  if (path === "/ping") return jsonResponse({ ok: true, now: new Date().toISOString(), build: BUILD }, { origin: grant });

  const seg = path.split("/");
  if (seg[1] === "mapbox" || seg[1] === "tomtom") return jsonResponse({ error: "gone", detail: "The routing gateway was retired on 2026-09-09." }, { status: 410, origin: grant });

  if (seg[1] === "grievances") {
    const id = seg[2];
    const tail = seg[3];
    if (seg.length === 2) {
      if (request.method === "GET" || request.method === "HEAD") return withOrigin(await listPage(env, url, ctx), grant);
      if (request.method === "POST") return submit(request, env, url, grant);
      return errorResponse("method not allowed", 405, grant);
    }
    if (id === "moderation" && seg.length === 3 && request.method === "GET") {
      const client = await clientHash(request);
      const headers: Record<string, string> = { Authorization: request.headers.get("Authorization") ?? "" };
      if (client) headers["X-Grievance-Client"] = client;
      return withOrigin(await dispatch(env, "GrievanceBoard", BOARD_ID, "/moderation", { headers }), grant);
    }
    if (!id || !UUID.test(id)) return errorResponse("not found", 404, grant);
    if (seg.length === 3) {
      if (request.method === "GET" || request.method === "HEAD") return withOrigin(await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`), grant);
      if (request.method === "DELETE") return remove(request, env, url, id, grant);
      return errorResponse("method not allowed", 405, grant);
    }
    if (seg.length === 4 && tail === "photo" && (request.method === "GET" || request.method === "HEAD")) {
      // A photo is public only while its board row still exists and says it has one. This prevents an
      // orphaned blob from being read if a prior moderation operation was interrupted.
      const item = await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`);
      if (!item.ok) return errorResponse("not found", 404, grant);
      const publicItem = (await item.json()) as { photo?: unknown };
      if (!publicItem.photo) return errorResponse("not found", 404, grant);
      const res = await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`);
      if (!res.ok) return errorResponse("not found", 404, grant);
      return jpegResponse(await res.arrayBuffer(), grant, `thetraffic-grievance-${id.slice(0, 8)}.jpg`);
    }
    return errorResponse("not found", 404, grant);
  }

  return errorResponse("not found", 404, grant);
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = request.headers.get("Origin");
    const allowed = originAllowed(origin, env.GRIEVANCE_ALLOWED_ORIGINS);
    const grant = allowed && origin ? origin : null;

    if (request.method === "OPTIONS") {
      if (!allowed || !origin) return new Response(null, { status: 403, headers: SECURITY_HEADERS });
      return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(origin) } });
    }
    if (!allowed) return errorResponse("origin not allowed", 403);

    try {
      return await route(request, env, url, path, grant, ctx);
    } catch (e) {
      // A failure no route expected — the platform's object dispatch, most likely. Still a JSON answer
      // with the caller's grant, so the browser may read it and say so, instead of the platform's bare
      // error page, which it may not (and would report as the board being unreachable).
      console.error("[grievance-api]", (e as Error).message);
      return errorResponse("The board is not answering right now — try again in a minute.", 502, grant, { "Retry-After": "60" });
    }
  },
} satisfies ExportedHandler<Env>;
