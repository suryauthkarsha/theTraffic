// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Thrower({ error }: { error: Error }): never {
  throw error;
}

const STALE = new TypeError("Failed to fetch dynamically imported module: https://thetraffic.example/assets/SignalMapPage-BOwdvvID.js");
const BUG = new TypeError("Cannot read properties of undefined (reading 'phases')");

describe("the error panel's two faces", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a chunk from a replaced build reads as an update, not a failure: no error detail, no report, one reload — tried once by itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recover = vi.fn<(e: Error) => boolean>(() => true);
    const { container } = render(
      <ErrorBoundary recover={recover}>
        <Thrower error={STALE} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(container.textContent).toContain("A newer version of the site is ready");
    expect(container.textContent).toContain("reload to pick it up");
    expect(container.textContent).toMatch(/update · build/);
    expect(container.textContent).not.toMatch(/Something broke|Send the report|Failed to fetch/);
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeTruthy();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(STALE);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("build that has been replaced"), STALE.message);
  });

  it("anything else is a render failure with the message, a reload and a pre-filled report — and no automatic reload", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recover = vi.fn<(e: Error) => boolean>(() => true);
    const { container } = render(
      <ErrorBoundary recover={recover}>
        <Thrower error={BUG} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(container.textContent).toContain("Something broke on this screen");
    expect(container.textContent).toMatch(/error · build/);
    expect(container.querySelector("pre")?.textContent).toBe("TypeError: Cannot read properties of undefined (reading 'phases')");
    const report = container.querySelector<HTMLAnchorElement>('a[href^="/support"]');
    expect(report?.getAttribute("href")).toContain("topic=bug");
    expect(report?.getAttribute("href")).toContain(encodeURIComponent("TypeError: Cannot read properties"));
    expect(recover).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("render failure"), BUG.message, expect.anything());
  });

  it("renders its children when nothing has failed", () => {
    const { container } = render(
      <ErrorBoundary>
        <p>the signal map</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe("the signal map");
  });
});
