/**
 * Recovery from a stale build.
 *
 * Every deploy renames the hashed chunks under /assets. A tab opened before a deploy keeps the old
 * `index.html`, and the first screen it opens afterwards asks for a chunk that no longer exists — the
 * browser reports that as a failed dynamic import, which would otherwise surface as a render failure
 * ("Something broke on this screen") though nothing is broken: the tab is merely behind. Here the
 * failure is recognised for what it is and the tab reloads itself once; the fresh `index.html` names
 * the chunks that exist. A one-line mark in sessionStorage (this tab only, gone when it closes) stops
 * a second reload for the same chunk, so a real outage falls through to the panel instead of looping.
 *
 * Pure apart from `recoverFromStaleBuild`, which takes the window slice it touches so a test can hand
 * in a fake.
 */

export interface ReloadMark {
  /** The chunk that failed, or the page path when the browser did not name it. */
  url: string;
  /** When the reload was started (ms since the epoch). */
  at: number;
}

/** A second failure of the same chunk inside this window is an outage, not a stale tab. */
export const RELOAD_WINDOW_MS = 60_000;
export const MARK_KEY = "gw.reload";

/**
 * What browsers say when a module chunk cannot be fetched: Chrome / Edge, Firefox, Safari, Vite's
 * CSS preload helper, and the "served HTML instead of a script" case of a host with a catch-all
 * rewrite.
 */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script|Loading (?:CSS )?chunk \S+ failed/i;

/** True when the error is a chunk that could not be loaded — a stale tab or a network failure, never a bug in a screen. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && CHUNK_ERROR.test(message);
}

/** The chunk's URL when the message names it (Chrome, Firefox and Vite do; Safari does not). */
export function chunkUrl(message: string): string | null {
  const m = /https?:\/\/\S+|\/assets\/\S+/.exec(message);
  return m ? m[0].replace(/[.,;:)]+$/, "") : null;
}

/** Reload unless the very same chunk already sent this tab through a reload moments ago. */
export function shouldReload(failedUrl: string, now: number, previous: ReloadMark | null): boolean {
  if (!previous) return true;
  return !(previous.url === failedUrl && now - previous.at < RELOAD_WINDOW_MS);
}

export function readMark(raw: string | null): ReloadMark | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReloadMark> | null;
    return v && typeof v.url === "string" && typeof v.at === "number" ? { url: v.url, at: v.at } : null;
  } catch {
    return null;
  }
}

/** The slice of `window` the recovery touches. */
export interface RecoveryHost {
  readonly location: { readonly pathname: string; reload(): void };
  readonly sessionStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/**
 * Reloads the tab for a chunk-load failure it has not already reloaded for; returns whether it did.
 * False for any other error, for a repeat failure inside the window, and when storage is refused (no
 * guard, so no automatic reload — the panel's own Reload button remains).
 */
export function recoverFromStaleBuild(error: unknown, host: RecoveryHost = window, now: number = Date.now()): boolean {
  if (!isChunkLoadError(error)) return false;
  const failed = chunkUrl(String((error as { message: string }).message)) ?? host.location.pathname;
  try {
    if (!shouldReload(failed, now, readMark(host.sessionStorage.getItem(MARK_KEY)))) return false;
    const mark: ReloadMark = { url: failed, at: now };
    host.sessionStorage.setItem(MARK_KEY, JSON.stringify(mark));
  } catch {
    return false;
  }
  host.location.reload();
  return true;
}
