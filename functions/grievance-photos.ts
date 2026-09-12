// functions/grievance-photos.ts — the photo bytes behind the grievance board.
//
// Photos are sharded across 256 Durable Object instances by the first two hex digits of the grievance
// id, so a busy day never funnels every image through one object and no shard approaches its 1 GB
// storage limit (at the 400 KB cap that is over 600 000 photos across the shards).
// A row is the stripped JPEG (see _lib/jpeg.ts: no EXIF, XMP, ICC or comment segment survives) and its
// facts; there is nothing here about who took it.

import { DurableObject } from "cloudflare:workers";

import { errorResponse, jpegResponse, jsonResponse } from "./_lib/http";
import { PHOTO_MAX_BYTES, UUID } from "./_lib/validate";

/** Shard key for an id: its first two hex digits (256 shards). */
export function photoShard(id: string): string {
  return `photos-${id.slice(0, 2)}`;
}

type Env = Record<string, never>;

export class GrievancePhotos extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      bytes BLOB NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      stored_at INTEGER NOT NULL
    )`);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.pathname.split("/")[2] ?? "";
    if (!UUID.test(id)) return errorResponse("not found", 404);
    try {
      if (request.method === "PUT") {
        const width = Number(request.headers.get("X-Photo-Width"));
        const height = Number(request.headers.get("X-Photo-Height"));
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength < 4 || bytes.byteLength > PHOTO_MAX_BYTES || !Number.isInteger(width) || !Number.isInteger(height)) return errorResponse("bad photo", 400);
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO photos (id, bytes, width, height, stored_at) VALUES (?, ?, ?, ?, ?)", id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), width, height, Date.now());
        return jsonResponse({ ok: true }, { status: 201 });
      }
      if (request.method === "GET") {
        const row = this.ctx.storage.sql.exec<{ bytes: ArrayBuffer }>("SELECT bytes FROM photos WHERE id = ?", id).toArray()[0];
        if (!row) return errorResponse("not found", 404);
        return jpegResponse(row.bytes, null, `thetraffic-grievance-${id.slice(0, 8)}.jpg`);
      }
      if (request.method === "DELETE") {
        this.ctx.storage.sql.exec("DELETE FROM photos WHERE id = ?", id);
        return jsonResponse({ ok: true });
      }
      return errorResponse("method not allowed", 405);
    } catch (e) {
      console.error("[grievance-photos]", (e as Error).message);
      return errorResponse("The photo store is not answering right now.", 500);
    }
  }
}
