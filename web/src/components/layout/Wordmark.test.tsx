// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BRAND_CITY, BRAND_NAME, BRAND_WORD } from "@/lib/system/brand";

import { Wordmark } from "./Wordmark";

// Every source file under src/, so a stale brand string fails here rather than on a visitor's screen.
const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

describe("the wordmark (user decision 2026-09-09: theTraffic. with a red full stop)", () => {
  it("is theTraffic with a bold red full stop and the muted city tag — no leading dot", () => {
    expect(BRAND_NAME).toBe("theTraffic.");
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe(`${BRAND_WORD}.${BRAND_CITY}`);
    const stop = container.querySelector(".text-gw-mark");
    expect(stop?.textContent).toBe(".");
    expect(stop?.className).toContain("font-bold");
    expect(stop?.parentElement?.className).toContain("text-gw-text"); // the stop sits inside the name's span, so it never wraps away from it
    expect(container.querySelector(".bg-gw-orange")).toBeNull();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });

  it("the previous name appears in no source file (lowercase machine ids such as the schema id are not the brand)", () => {
    // Built without the literal so this file cannot match itself.
    const previous = new RegExp(["Green", "Wave"].join("\\s?"));
    const stale = Object.entries(sources)
      .filter(([, code]) => previous.test(code))
      .map(([file]) => file);
    expect(stale).toEqual([]);
    expect(Object.keys(sources).length).toBeGreaterThan(50); // the glob really covered the tree
  });
});
