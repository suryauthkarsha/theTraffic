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
//   POST   /grievances              multipart/form-data: `grievance` (JSON) + optional `photo` (JPEG ≤ 400 KB)
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
// origins; bodies are capped before reading; photos must parse as JPEG and lose metadata segments.
//
// Env (project settings, never in source): GRIEVANCE_ADMIN_KEY — the moderator passphrase (≥ 20 chars);
// GRIEVANCE_ALLOWED_ORIGINS — extra site origins for a custom domain, space or comma separated.

import { clientHash, errorResponse, jpegResponse, jsonResponse, originAllowed, SECURITY_HEADERS, corsHeaders } from "./_lib/http";
import { inspectJpeg } from "./_lib/jpeg";
import { JSON_MAX_BYTES, PHOTO_MAX_BYTES, parseSubmission, REQUEST_MAX_BYTES, UUID } from "./_lib/validate";
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

const BUILD = "2026-09-12.1";
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

/**
 * Read at most `max` bytes of a body; null when it runs longer. The cap does not trust Content-Length
 * (a proxy may strip it, a client may lie): the stream itself is stopped at the limit.
 */
async function readBodyCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
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

async function submit(request: Request, env: Env, origin: string | null): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) return errorResponse("The grievance could not be read.", 415, origin);
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

  const file = form.get("photo");
  let photo: { width: number; height: number; bytes: Uint8Array } | null = null;
  if (file !== null) {
    if (typeof file === "string" || file.size > PHOTO_MAX_BYTES) return errorResponse("The photo is too large — pick a smaller one.", 413, origin);
    const info = inspectJpeg(new Uint8Array(await file.arrayBuffer()));
    if (!info) return errorResponse("That photo could not be read — a JPEG from the form is expected.", 400, origin);
    photo = info;
  }

  const parsed = parseSubmission(raw, photo !== null);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status, origin);

  const id = crypto.randomUUID();
  const client = await clientHash(request);
  if (photo) {
    const stored = await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg", "X-Photo-Width": String(photo.width), "X-Photo-Height": String(photo.height) },
      body: new Uint8Array(photo.bytes).buffer,
    });
    if (!stored.ok) return errorResponse("The photo could not be stored — try again.", 502, origin);
  }
  const res = await dispatch(env, "GrievanceBoard", BOARD_ID, "/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, submission: parsed.value, photo: photo ? { width: photo.width, height: photo.height, bytes: photo.bytes.byteLength } : null, client }),
  });
  if (!res.ok && photo) await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, { method: "DELETE" }).catch(() => undefined);
  return withOrigin(res, origin);
}

async function remove(request: Request, env: Env, id: string, origin: string | null): Promise<Response> {
  const client = await clientHash(request);
  const headers: Record<string, string> = { Authorization: request.headers.get("Authorization") ?? "" };
  if (client) headers["X-Grievance-Client"] = client;

  // Prove the caller is a moderator before touching either store. Delete photo bytes first, and do
  // not report success or remove the board row if that deletion fails, so the operation is retryable.
  const authorized = await dispatch(env, "GrievanceBoard", BOARD_ID, "/moderation", { headers });
  if (!authorized.ok) return withOrigin(authorized, origin);
  const item = await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`);
  if (!item.ok) return withOrigin(item, origin);
  const publicItem = (await item.json()) as { photo?: unknown };
  if (publicItem.photo) {
    const photoRemoved = await dispatch(env, "GrievancePhotos", photoShard(id), `/photo/${id}`, { method: "DELETE" });
    if (!photoRemoved.ok) return errorResponse("The photo could not be removed — the grievance is unchanged. Try again.", 502, origin);
  }
  return withOrigin(await dispatch(env, "GrievanceBoard", BOARD_ID, `/item/${id}`, { method: "DELETE", headers }), origin);
}

/** The routes, once the caller's origin has been judged. `grant` is the origin to name in CORS, or null. */
async function route(request: Request, env: Env, url: URL, path: string, grant: string | null): Promise<Response> {
  if (path === "/ping") return jsonResponse({ ok: true, now: new Date().toISOString(), build: BUILD }, { origin: grant });

  const seg = path.split("/");
  if (seg[1] === "mapbox" || seg[1] === "tomtom") return jsonResponse({ error: "gone", detail: "The routing gateway was retired on 2026-09-09." }, { status: 410, origin: grant });

  if (seg[1] === "grievances") {
    const id = seg[2];
    const tail = seg[3];
    if (seg.length === 2) {
      if (request.method === "GET" || request.method === "HEAD") {
        const res = await dispatch(env, "GrievanceBoard", BOARD_ID, `/list${url.search}`);
        return withOrigin(res, grant);
      }
      if (request.method === "POST") return submit(request, env, grant);
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
      if (request.method === "DELETE") return remove(request, env, id, grant);
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return await route(request, env, url, path, grant);
    } catch (e) {
      // A failure no route expected — the platform's object dispatch, most likely. Still a JSON answer
      // with the caller's grant, so the browser may read it and say so, instead of the platform's bare
      // error page, which it may not (and would report as the board being unreachable).
      console.error("[grievance-api]", (e as Error).message);
      return errorResponse("The board is not answering right now — try again in a minute.", 502, grant, { "Retry-After": "60" });
    }
  },
} satisfies ExportedHandler<Env>;
