import type { BoardGrievance, GrievanceKind, GrievancePhoto, GrievanceSubmission } from "./grievance";

/**
 * The grievance board's API — the one server the site talks to, for the one thing that needs one:
 * grievances are collected so they can be read back together. The request carries the kind, words,
 * place and re-encoded photo, with no account cookie or user token. The payload has no identity or
 * contact field, but submitted content may still identify a person or private place.
 *
 * The board's origin is built in: `GRIEVANCE_API` names the project's Worker. `VITE_GRIEVANCE_API_URL`
 * overrides it for a self-hosted Worker; both are read at build time and the Content Security Policy
 * follows the value (vite.config.ts). The moderator passphrase never lives here — a moderator types it
 * on the board page and it is held in memory for that visit only.
 */
export const DEFAULT_GRIEVANCE_API = "https://greenwave-bengaluru-backend.rork.app";

/** The board's origin, without a trailing slash. */
export function grievanceApiBase(configured: string | undefined = import.meta.env.VITE_GRIEVANCE_API_URL): string {
  const v = configured?.trim().replace(/\/+$/, "");
  if (!v) return DEFAULT_GRIEVANCE_API;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : DEFAULT_GRIEVANCE_API;
  } catch {
    return DEFAULT_GRIEVANCE_API;
  }
}

export const GRIEVANCE_API = grievanceApiBase();

export class GrievanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

export interface BoardPage {
  items: BoardGrievance[];
  /** Cursor for the next (older) page, or null at the end. */
  next: number | null;
  /** Grievances on the board (of the filtered kind when one is set). */
  total: number;
  byKind: Record<GrievanceKind, number>;
}

const REQUEST_TIMEOUT_MS = 20_000;

/** The one sentence a failed call shows, from the server's own when it gave one. */
async function failure(res: Response): Promise<GrievanceApiError> {
  let message = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    /* not JSON */
  }
  const retry = Number(res.headers.get("Retry-After"));
  return new GrievanceApiError(message || (res.status >= 500 ? "The board is not answering right now — try again in a minute." : "That could not be posted."), res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
}

function withTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : init.signal, credentials: "omit", mode: "cors", cache: "no-store" };
}

/**
 * The one place the board is called. A call that never gets an answer (the connection is down, the
 * request was blocked, the board's host returned nothing the browser may read) is noted once in the
 * console for diagnosis — the error's name and message and the path, never a header or a body — and
 * rethrown for the caller's sentence (`apiErrorMessage`).
 */
async function call(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, withTimeout(init));
  } catch (e) {
    const err = e as { name?: unknown; message?: unknown } | null;
    console.warn("[thetraffic] board call failed:", String(err?.name ?? "Error"), String(err?.message ?? ""), new URL(url).pathname);
    throw e;
  }
}

/** Newest first. `before` = the cursor from the previous page; `kind` = one kind or null for all. */
export async function fetchBoard(opts: { before?: number | null; kind?: GrievanceKind | null; limit?: number } = {}, base: string = GRIEVANCE_API): Promise<BoardPage> {
  const q = new URLSearchParams();
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.before) q.set("before", String(opts.before));
  if (opts.kind) q.set("kind", opts.kind);
  const query = q.toString();
  const res = await call(`${base}/grievances${query ? `?${query}` : ""}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as BoardPage;
}

export async function fetchGrievance(id: string, base: string = GRIEVANCE_API): Promise<BoardGrievance> {
  const res = await call(`${base}/grievances/${encodeURIComponent(id)}`);
  if (!res.ok) throw await failure(res);
  return (await res.json()) as BoardGrievance;
}

/** Post a grievance: the JSON as one form field, the JPEG as another — every grievance carries one. */
export async function postGrievance(submission: GrievanceSubmission, photo: GrievancePhoto, base: string = GRIEVANCE_API): Promise<BoardGrievance> {
  const form = new FormData();
  form.set("grievance", JSON.stringify(submission));
  form.set("photo", photo.blob, "photo.jpg");
  const res = await call(`${base}/grievances`, { method: "POST", body: form });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as BoardGrievance;
}

/** The photo's address on the board (the server strips every metadata segment before storing it). */
export function photoUrl(id: string, base: string = GRIEVANCE_API): string {
  return `${base}/grievances/${encodeURIComponent(id)}/photo`;
}

/** True when the passphrase unlocks moderation; a wrong one throws with the server's sentence. The passphrase travels in the header only, never in the address. */
export async function checkModerator(passphrase: string, base: string = GRIEVANCE_API): Promise<boolean> {
  const res = await call(`${base}/grievances/moderation`, { headers: { Authorization: `Bearer ${passphrase}` } });
  if (res.ok) return true;
  throw await failure(res);
}

export async function removeGrievance(id: string, passphrase: string, base: string = GRIEVANCE_API): Promise<void> {
  const res = await call(`${base}/grievances/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${passphrase}` } });
  if (!res.ok) throw await failure(res);
}

/**
 * The plain sentence for any thrown value from this module. A call the browser could not complete
 * at all has two faces: offline (the browser says so) and blocked or unanswered — the latter is most
 * often a tab left open across a deploy, which a reload settles.
 */
export function apiErrorMessage(e: unknown, online: boolean = typeof navigator === "undefined" || navigator.onLine !== false): string {
  if (e instanceof GrievanceApiError) return e.message;
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "The board took too long to answer — check your connection and try again.";
  if (!online) return "You are offline — the board needs a connection.";
  return "The board could not be reached — reload the page and try again.";
}
