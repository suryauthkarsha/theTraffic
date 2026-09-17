/**
 * bun test functions/tests
 * How a page of the board is named for its memories, which pages a post or a removal refreshes, and
 * how the memory that keeps pages stays small and short-lived.
 */
import { describe, expect, test } from "bun:test";

import { canonicalCursor, firstPages, LIST_CACHE_CONTROL, LIST_CACHE_SECONDS, listQuery, listSearch, PAGE_MEMO_MAX, PageMemo } from "../_lib/cache";
import { PAGE_DEFAULT, PAGE_MAX } from "../_lib/validate";

const key = (search: string): string => listSearch(listQuery(new URLSearchParams(search)));

describe("the board's page key", () => {
  test("two ways of asking for the same page share one key; junk, unknown and out-of-range parameters fall away", () => {
    expect(key("")).toBe(`?limit=${PAGE_DEFAULT}`);
    expect(key("limit=30&kind=&before=")).toBe(key(""));
    expect(key("limit=999")).toBe(`?limit=${PAGE_MAX}`); // the cap, not a new entry per number
    expect(key("limit=0")).toBe(key(""));
    expect(key("limit=abc")).toBe(key(""));
    expect(key("kind=pothole&limit=30")).toBe("?limit=30&kind=pothole");
    expect(key("before=42&kind=water")).toBe("?limit=30&before=42&kind=water");
    expect(key("kind=complaint")).toBe(key("")); // an unknown kind reads as every kind, as the board does
    expect(key("before=-1&fresh=123&utm_source=x")).toBe(key("")); // a cache-buster is not a page
  });

  test("a cursor past the newest row is the first page — a reader cannot mint pages by counting upward", () => {
    expect(canonicalCursor(null, 10)).toBeNull();
    expect(canonicalCursor(11, 10)).toBeNull();
    expect(canonicalCursor(9_007_199_254_740_991, 10)).toBeNull();
    expect(canonicalCursor(10, 10)).toBe(10); // "before the newest" is a real page
    expect(canonicalCursor(5, 10)).toBe(5);
    expect(canonicalCursor(1, 0)).toBeNull(); // an empty board has one page
  });

  test("a post or a removal refreshes the first page of the board and of its kind — the pages the site reads", () => {
    expect(firstPages("pothole")).toEqual([
      { limit: PAGE_DEFAULT, before: null, kind: null },
      { limit: PAGE_DEFAULT, before: null, kind: "pothole" },
    ]);
    expect(firstPages(null)).toEqual([{ limit: PAGE_DEFAULT, before: null, kind: null }]);
  });

  test("a page may be kept for seconds, not minutes — the board stays live", () => {
    expect(LIST_CACHE_SECONDS).toBeGreaterThanOrEqual(2);
    expect(LIST_CACHE_SECONDS).toBeLessThanOrEqual(30);
    expect(LIST_CACHE_CONTROL).toBe(`public, max-age=${LIST_CACHE_SECONDS}`);
    expect(LIST_CACHE_CONTROL).not.toContain("no-store");
  });
});

describe("the memory of pages", () => {
  test("keeps a page for its lifetime, then lets it go; forgets on request", () => {
    const memo = new PageMemo<string>(10_000);
    memo.set("?limit=30", '{"items":[]}', 1_000);
    expect(memo.get("?limit=30", 1_000)).toBe('{"items":[]}');
    expect(memo.get("?limit=30", 10_999)).toBe('{"items":[]}');
    expect(memo.get("?limit=30", 11_000)).toBeNull(); // the lifetime is over
    expect(memo.size).toBe(0); // and the entry is gone, not merely hidden
    memo.set("?limit=30", "a", 20_000);
    memo.set("?limit=30&kind=pothole", "b", 20_000);
    memo.forget(["?limit=30"]);
    expect(memo.get("?limit=30", 20_001)).toBeNull();
    expect(memo.get("?limit=30&kind=pothole", 20_001)).toBe("b");
    memo.clear();
    expect(memo.size).toBe(0);
  });

  test("is bounded: the oldest page leaves when a new one arrives at the limit, and a lifetime of Infinity never expires", () => {
    const memo = new PageMemo<number>(Number.POSITIVE_INFINITY, 3);
    memo.set("a", 1, 1);
    memo.set("b", 2, 2);
    memo.set("c", 3, 3);
    memo.set("d", 4, 4);
    expect(memo.size).toBe(3);
    expect(memo.get("a", 1_000_000_000)).toBeNull(); // the oldest left
    expect(memo.get("b", 1_000_000_000)).toBe(2); // nothing expires on its own
    memo.set("b", 5, 5); // refreshing a page makes it the newest…
    memo.set("e", 6, 6);
    expect(memo.get("c", 7)).toBeNull(); // …so the next to leave is the one not touched
    expect(memo.get("b", 7)).toBe(5);
    expect(PAGE_MEMO_MAX).toBeGreaterThanOrEqual(64);
    expect(PAGE_MEMO_MAX).toBeLessThanOrEqual(1024);
  });
});
