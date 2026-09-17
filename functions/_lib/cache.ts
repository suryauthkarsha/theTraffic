/**
 * How a page of the board is named, how long it may be kept, and the small memory that keeps it.
 * Pure: `bun test functions/tests` covers it.
 *
 * Every read of the board is a call to the one board object, so a burst of readers — or a flood of
 * them — would queue there. Instead a page is kept three ways, each exact or short-lived:
 *   - the board object keeps every page it has served until the next post or removal, so a repeated
 *     page is a lookup, not a query, and never stale (grievance-board.ts);
 *   - each Worker isolate keeps the pages it served for LIST_CACHE_SECONDS, so a burst asks the object
 *     once per distinct page per isolate (index.ts);
 *   - the data centre's cache keeps them for the same seconds where the platform provides one (custom
 *     domains; on a *.workers.dev or Rork host the Cache API has no effect).
 * The key is the *effective* page (`limit`, `before`, `kind` after the validation rules), so
 * `?limit=999&utm=x` and `?limit=60` are one entry, not two; a cursor past the newest row is the first
 * page; and every memory is bounded, so a reader who varies the cursor cannot grow it without end.
 * A post or a removal forgets the first pages it changes (see `firstPages`).
 */
import { kindFilter, PAGE_DEFAULT, pageCursor, pageLimit, type Kind } from "./validate";

/** How old a page of the board may be. Long enough to absorb a burst, short enough that the board stays live. */
export const LIST_CACHE_SECONDS = 5;
export const LIST_CACHE_CONTROL = `public, max-age=${LIST_CACHE_SECONDS}`;
/** The most distinct pages one memory keeps; the oldest leaves first. */
export const PAGE_MEMO_MAX = 128;

export interface ListQuery {
  limit: number;
  before: number | null;
  kind: Kind | null;
}

/** The page a query string asks for, after the validation rules — the only thing the board object is asked. */
export function listQuery(params: URLSearchParams): ListQuery {
  return { limit: pageLimit(params.get("limit")), before: pageCursor(params.get("before")), kind: kindFilter(params.get("kind")) };
}

/** The canonical query string of a page: what the board object is asked and what every memory is keyed on. */
export function listSearch(q: ListQuery): string {
  const p = new URLSearchParams();
  p.set("limit", String(q.limit));
  if (q.before !== null) p.set("before", String(q.before));
  if (q.kind) p.set("kind", q.kind);
  return `?${p.toString()}`;
}

/** A cursor past the newest row selects the same rows as no cursor: the first page, one entry. */
export function canonicalCursor(before: number | null, newestSeq: number): number | null {
  return before !== null && before > newestSeq ? null : before;
}

/**
 * The pages a new or removed grievance of `kind` changes first: the top of the board and the top of
 * its kind, at the default page size — the pages the site reads (web/src/pages/GrievancesPage.tsx asks
 * for PAGE_DEFAULT-sized pages). Deeper pages and other sizes refresh within LIST_CACHE_SECONDS.
 */
export function firstPages(kind: Kind | null): ListQuery[] {
  const pages: ListQuery[] = [{ limit: PAGE_DEFAULT, before: null, kind: null }];
  if (kind) pages.push({ limit: PAGE_DEFAULT, before: null, kind });
  return pages;
}

/**
 * A bounded memory of pages, each kept for `ttlMs` (Infinity: until forgotten). Insertion order is
 * age: when the bound is reached the oldest entry leaves. Holds page answers only — nothing about a caller.
 */
export class PageMemo<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs: number = LIST_CACHE_SECONDS * 1000,
    private readonly max: number = PAGE_MEMO_MAX,
  ) {}

  get(key: string, now: number): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, now: number): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: now, value });
  }

  forget(keys: readonly string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
