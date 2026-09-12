// functions/grievance-board.ts — the one Durable Object that owns the grievance board's rows.
//
// One instance ("bengaluru") holds every grievance's words, kind, place and photo facts in its SQLite
// storage, and is the single authority on what may be posted: it applies the per-caller and global
// rate limits, assigns the sequence the board pages by, and answers moderation. Photo bytes live in
// the GrievancePhotos shards (grievance-photos.ts) so this object stays small and fast to read.
//
// Account-free by construction: a row has no account or contact column. Its words, photo, place and
// filing time can still identify people or private locations. Rate limits key on a hash of the caller's
// address salted with a random value drawn fresh each day and discarded with it, so stored counters
// cannot be turned back into an address. Filing time is kept to the minute.

import { DurableObject } from "cloudflare:workers";

import { bearerToken, errorResponse, jsonResponse, secretsEqual } from "./_lib/http";
import { KINDS, kindFilter, pageCursor, pageLimit, UUID, type Kind, type Submission } from "./_lib/validate";

type Env = {
  /** Moderator passphrase; without it the moderation routes answer 503. */
  GRIEVANCE_ADMIN_KEY?: string;
};

/**
 * How many grievances one caller may post: per rolling hour and per calendar day (UTC). Generous on
 * purpose — Indian mobile networks put hundreds of phones behind one shared address, so a tight
 * per-address limit would lock out honest people before it slowed a flood; the global caps do that.
 */
export const LIMIT_PER_CLIENT_HOUR = 20;
export const LIMIT_PER_CLIENT_DAY = 60;
/** Everyone together — a ceiling on storage growth and on what a flood can do, not a quota anyone should meet. */
export const LIMIT_GLOBAL_MINUTE = 120;
export const LIMIT_GLOBAL_DAY = 10_000;
/** Failed passphrase checks tolerated per caller per hour before the moderation routes go quiet for them. */
export const LIMIT_AUTH_FAILURES_HOUR = 10;
export const MIN_ADMIN_KEY_LENGTH = 20;

interface GrievanceRow {
  [column: string]: string | number | null;
  seq: number;
  id: string;
  kind: string;
  words: string;
  lng: number | null;
  lat: number | null;
  source: string | null;
  accuracy_m: number | null;
  junction_id: string | null;
  junction_name: string | null;
  junction_distance_m: number | null;
  photo_w: number | null;
  photo_h: number | null;
  photo_bytes: number | null;
  filed_at: number;
}

/** What the board publishes for one grievance. */
export interface PublicGrievance {
  id: string;
  kind: Kind;
  words: string;
  place: { lng: number; lat: number; source: string; accuracyM: number | null; junction: { id: string; name: string; distanceM: number } | null } | null;
  photo: { width: number; height: number; bytes: number } | null;
  filedAt: number;
}

export interface SubmitBody {
  id: string;
  submission: Submission;
  photo: { width: number; height: number; bytes: number } | null;
  /** sha256 of the caller's address, or null when the platform passed none. */
  client: string | null;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function toPublic(r: GrievanceRow): PublicGrievance {
  return {
    id: r.id,
    kind: r.kind as Kind,
    words: r.words,
    place:
      r.lng !== null && r.lat !== null && r.source !== null
        ? {
            lng: r.lng,
            lat: r.lat,
            source: r.source,
            accuracyM: r.accuracy_m,
            junction: r.junction_id && r.junction_name ? { id: r.junction_id, name: r.junction_name, distanceM: r.junction_distance_m ?? 0 } : null,
          }
        : null,
    photo: r.photo_w && r.photo_h && r.photo_bytes ? { width: r.photo_w, height: r.photo_h, bytes: r.photo_bytes } : null,
    filedAt: r.filed_at,
  };
}

export class GrievanceBoard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS grievances (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      words TEXT NOT NULL,
      lng REAL, lat REAL, source TEXT, accuracy_m INTEGER,
      junction_id TEXT, junction_name TEXT, junction_distance_m INTEGER,
      photo_w INTEGER, photo_h INTEGER, photo_bytes INTEGER,
      filed_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE INDEX IF NOT EXISTS grievances_kind_seq ON grievances (kind, seq)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS client_posts (day TEXT NOT NULL, client TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS client_posts_lookup ON client_posts (day, client, at)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS global_posts (at INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS global_posts_at ON global_posts (at)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS auth_failures (day TEXT NOT NULL, client TEXT NOT NULL, at INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS auth_failures_lookup ON auth_failures (day, client, at)`);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET" && path === "/list") return this.list(url);
      if (request.method === "GET" && path.startsWith("/item/")) return this.item(path.slice("/item/".length));
      if (request.method === "POST" && path === "/submit") return this.submit((await request.json()) as SubmitBody);
      if (request.method === "GET" && path === "/moderation") return this.checkModerator(request);
      if (request.method === "DELETE" && path.startsWith("/item/")) return this.remove(request, path.slice("/item/".length));
      return errorResponse("not found", 404);
    } catch (e) {
      console.error("[grievance-board]", (e as Error).message);
      return errorResponse("The board is not answering right now.", 500);
    }
  }

  /** Newest first, `limit` at a time, `before` = the seq of the oldest item already shown. */
  private list(url: URL): Response {
    const sql = this.ctx.storage.sql;
    const limit = pageLimit(url.searchParams.get("limit"));
    const before = pageCursor(url.searchParams.get("before"));
    const kind = kindFilter(url.searchParams.get("kind"));
    const where: string[] = [];
    const args: unknown[] = [];
    if (kind) {
      where.push("kind = ?");
      args.push(kind);
    }
    if (before !== null) {
      where.push("seq < ?");
      args.push(before);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = sql.exec<GrievanceRow>(`SELECT * FROM grievances ${clause} ORDER BY seq DESC LIMIT ?`, ...args, limit + 1).toArray();
    const page = rows.slice(0, limit);
    const total = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM grievances${kind ? " WHERE kind = ?" : ""}`, ...(kind ? [kind] : [])).one().n;
    const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
    for (const r of sql.exec<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM grievances GROUP BY kind").toArray()) if (r.kind in byKind) byKind[r.kind as Kind] = r.n;
    return jsonResponse({ items: page.map(toPublic), next: rows.length > limit ? page[page.length - 1].seq : null, total, byKind });
  }

  private item(id: string): Response {
    if (!UUID.test(id)) return errorResponse("not found", 404);
    const row = this.ctx.storage.sql.exec<GrievanceRow>("SELECT * FROM grievances WHERE id = ?", id).toArray()[0];
    return row ? jsonResponse(toPublic(row)) : errorResponse("not found", 404);
  }

  /** The caller's daily key: sha256(day-salt + client hash). The salt lives one day and is then dropped. */
  private async dailyKey(client: string, now: number): Promise<string> {
    const sql = this.ctx.storage.sql;
    const day = utcDay(now);
    let salt = sql.exec<{ salt: string }>("SELECT salt FROM salts WHERE day = ?", day).toArray()[0]?.salt;
    if (!salt) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      salt = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      sql.exec("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)", day, salt);
      salt = sql.exec<{ salt: string }>("SELECT salt FROM salts WHERE day = ?", day).one().salt;
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${client}`));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** Salts, counters and failure marks older than yesterday leave: nothing derived from a caller's address lives past two days. */
  private prune(now: number): void {
    const sql = this.ctx.storage.sql;
    const keep = utcDay(now - 86_400_000);
    sql.exec("DELETE FROM salts WHERE day < ?", keep);
    sql.exec("DELETE FROM client_posts WHERE day < ?", keep);
    sql.exec("DELETE FROM auth_failures WHERE day < ?", keep);
    sql.exec("DELETE FROM global_posts WHERE at < ?", now - 86_400_000);
  }

  /**
   * The rate-limit verdict for a caller: null to proceed, or the seconds to wait. Synchronous on
   * purpose — the caller's daily key is computed before, so the checks and the insert that follows
   * share one turn of the object and two simultaneous posts cannot both slip under a limit.
   */
  private postAllowance(key: string | null, now: number): number | null {
    const sql = this.ctx.storage.sql;
    const minuteCount = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM global_posts WHERE at > ?", now - MINUTE).one().n;
    if (minuteCount >= LIMIT_GLOBAL_MINUTE) return 60;
    const dayCount = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM global_posts WHERE at > ?", now - 86_400_000).one().n;
    if (dayCount >= LIMIT_GLOBAL_DAY) return 3600;
    if (key === null) return null;
    const day = utcDay(now);
    const hour = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM client_posts WHERE day = ? AND client = ? AND at > ?", day, key, now - HOUR).one().n;
    if (hour >= LIMIT_PER_CLIENT_HOUR) return 3600;
    const today = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM client_posts WHERE day = ? AND client = ?", day, key).one().n;
    if (today >= LIMIT_PER_CLIENT_DAY) return 3600 * 6;
    return null;
  }

  private async submit(body: SubmitBody): Promise<Response> {
    const sql = this.ctx.storage.sql;
    if (!body || typeof body.id !== "string" || !UUID.test(body.id) || !body.submission) return errorResponse("The grievance could not be read.", 400);
    const now = Date.now();
    const key = body.client === null ? null : await this.dailyKey(body.client, now);
    this.prune(now);
    const wait = this.postAllowance(key, now);
    if (wait !== null) return errorResponse("Too many grievances from here for now — try again later.", 429, null, { "Retry-After": String(wait) });
    const s = body.submission;
    const p = s.place;
    const filedAt = Math.floor(now / MINUTE) * MINUTE;
    sql.exec(
      `INSERT INTO grievances (id, kind, words, lng, lat, source, accuracy_m, junction_id, junction_name, junction_distance_m, photo_w, photo_h, photo_bytes, filed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      body.id,
      s.kind,
      s.words,
      p?.lng ?? null,
      p?.lat ?? null,
      p?.source ?? null,
      p?.accuracyM ?? null,
      p?.junction?.id ?? null,
      p?.junction?.name ?? null,
      p?.junction?.distanceM ?? null,
      body.photo?.width ?? null,
      body.photo?.height ?? null,
      body.photo?.bytes ?? null,
      filedAt,
    );
    sql.exec("INSERT INTO global_posts (at) VALUES (?)", now);
    if (key !== null) sql.exec("INSERT INTO client_posts (day, client, at) VALUES (?, ?, ?)", utcDay(now), key, now);
    const row = sql.exec<GrievanceRow>("SELECT * FROM grievances WHERE id = ?", body.id).one();
    return jsonResponse(toPublic(row), { status: 201 });
  }

  /** 204 when the bearer token is the configured passphrase; 401 otherwise; 503 with no passphrase configured; 429 after repeated failures. */
  private async authorize(request: Request): Promise<Response | null> {
    const key = this.env.GRIEVANCE_ADMIN_KEY?.trim() ?? "";
    if (key.length < MIN_ADMIN_KEY_LENGTH) return errorResponse("Moderation is not configured on this board.", 503);
    const now = Date.now();
    this.prune(now);
    const client = request.headers.get("X-Grievance-Client");
    const sql = this.ctx.storage.sql;
    const day = utcDay(now);
    const dayKey = client ? await this.dailyKey(client, now) : null;
    if (dayKey !== null) {
      const failures = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM auth_failures WHERE day = ? AND client = ? AND at > ?", day, dayKey, now - HOUR).one().n;
      if (failures >= LIMIT_AUTH_FAILURES_HOUR) return errorResponse("Too many attempts — try again in an hour.", 429, null, { "Retry-After": "3600" });
    }
    const token = bearerToken(request);
    if (token !== null && (await secretsEqual(token, key))) return null;
    if (dayKey !== null) sql.exec("INSERT INTO auth_failures (day, client, at) VALUES (?, ?, ?)", day, dayKey, now);
    return errorResponse("That passphrase is not right.", 401);
  }

  private async checkModerator(request: Request): Promise<Response> {
    return (await this.authorize(request)) ?? jsonResponse({ ok: true });
  }

  /** Removes the row for good and tells the caller whether a photo went with it (the shard deletes the bytes). */
  private async remove(request: Request, id: string): Promise<Response> {
    const refused = await this.authorize(request);
    if (refused) return refused;
    if (!UUID.test(id)) return errorResponse("not found", 404);
    const sql = this.ctx.storage.sql;
    const row = sql.exec<GrievanceRow>("SELECT * FROM grievances WHERE id = ?", id).toArray()[0];
    if (!row) return errorResponse("not found", 404);
    sql.exec("DELETE FROM grievances WHERE id = ?", id);
    return jsonResponse({ removed: id, hadPhoto: row.photo_bytes !== null });
  }
}
