/**
 * Response plumbing shared by the entrypoint and the Durable Objects. Pure: `bun test` covers it.
 */

/** Every response from this Worker carries these: nothing is sniffed, framed, cached by default or given a referrer. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/**
 * Exact public origins that may read and write the board. Additional exact https origins come from
 * `GRIEVANCE_ALLOWED_ORIGINS` (space or comma separated). Multi-tenant suffix wildcards are rejected.
 * Local development servers are always allowed.
 */
export const DEFAULT_ORIGINS = new Set(["https://greenwave-bengaluru.rork.app", "https://www.thetraffic.in"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "[::]"]);

/** Whether a browser origin may read and write the board. A request without an origin is not a browser's cross-site call. */
export function originAllowed(origin: string | null, configured: string | undefined): boolean {
  if (origin === null) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) return true;
  if (url.protocol !== "https:") return false;
  if (DEFAULT_ORIGINS.has(url.origin.toLowerCase())) return true;
  for (const entry of (configured ?? "").split(/[\s,]+/).filter(Boolean)) {
    if (entry.includes("*")) continue;
    try {
      const allowed = new URL(entry);
      if (allowed.protocol !== "https:" || allowed.pathname !== "/" || allowed.search || allowed.hash || allowed.username || allowed.password) continue;
      if (allowed.origin.toLowerCase() === url.origin.toLowerCase()) return true;
    } catch {
      // Ignore malformed configuration entries rather than widening access.
    }
  }
  return false;
}

/** CORS grant for one named origin — never `*`. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export interface ResponseOptions {
  status?: number;
  /** The browser origin to grant, when allowed; null adds no CORS header. */
  origin?: string | null;
  /** `no-store` unless a route says how long a public answer may be kept. */
  cacheControl?: string;
  headers?: Record<string, string>;
}

export function jsonResponse(body: unknown, opts: ResponseOptions = {}): Response {
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": opts.cacheControl ?? "no-store",
      ...(opts.origin ? corsHeaders(opts.origin) : {}),
      ...(opts.headers ?? {}),
    },
  });
}

export function errorResponse(error: string, status: number, origin: string | null = null, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error }, { status, origin, headers });
}

/**
 * A JPEG the site embeds: cacheable for an hour, embeddable cross-origin, still never sniffed or
 * framed. Opened directly, a browser wraps the image in a document of its own, so the policy lets
 * that document show exactly one image — this one — and nothing else.
 */
export function jpegResponse(bytes: ArrayBuffer | Uint8Array, origin: string | null, filename: string): Response {
  const body = bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes;
  return new Response(body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

/** `Authorization: Bearer <token>` → the token, or null. */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

/** Constant-time equality of two secrets (both hashed first, so length says nothing). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function hex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * The caller's address, hashed — the Worker never keeps or logs the address itself, and the board
 * salts this again per day before it stores anything (see GrievanceBoard). Null when the platform
 * passes no address, in which case only the global limits apply.
 */
export async function clientHash(request: Request): Promise<string | null> {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "";
  if (!ip) return null;
  return sha256Hex(ip);
}
