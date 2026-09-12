// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KNOT_H } from "@/lib/knot/trefoil";

import { KnotAnimation } from "./knot-animation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KnotAnimation", () => {
  it("paints the first frame synchronously into a decorative <pre>", () => {
    const { container, unmount } = render(<KnotAnimation />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.getAttribute("aria-hidden")).toBe("true");
    expect(pre?.textContent?.split("\n")).toHaveLength(KNOT_H);
    expect(pre?.textContent).toMatch(/[#$@]/);
    expect(pre?.querySelector("span")).toBeNull(); // grayscale: plain text only
    unmount();
  });

  it("colour mode emits inline-coloured runs from the given palette and is labelled when asked", () => {
    const { container, unmount } = render(<KnotAnimation color palette={["#32d583", "#8a97a0"]} label="Rotating trefoil knot" />);
    const pre = container.querySelector("pre");
    expect(pre?.getAttribute("role")).toBe("img");
    expect(pre?.getAttribute("aria-label")).toBe("Rotating trefoil knot");
    expect(pre?.hasAttribute("aria-hidden")).toBe(false);
    const spans = pre?.querySelectorAll("span") ?? [];
    expect(spans.length).toBeGreaterThan(10);
    const colours = new Set(Array.from(spans).map((s) => (s as HTMLElement).style.color));
    expect(colours.size).toBe(2);
    unmount();
  });

  it("renders a single still frame when the user prefers reduced motion", async () => {
    const raf = vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0));
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: true, media: "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }) });
    const { container, unmount } = render(<KnotAnimation />);
    const first = container.querySelector("pre")?.textContent;
    expect(first).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(raf).not.toHaveBeenCalled();
    expect(container.querySelector("pre")?.textContent).toBe(first);
    unmount();
  });

  it("animates through requestAnimationFrame when motion is allowed and stops on unmount", async () => {
    const raf = vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 1));
    const caf = vi.fn((id: number) => window.clearTimeout(id));
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} }) });
    const { container, unmount } = render(<KnotAnimation frameMs={0} />);
    const first = container.querySelector("pre")?.textContent;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(raf).toHaveBeenCalled();
    expect(container.querySelector("pre")?.textContent).not.toBe(first);
    unmount();
    expect(caf).toHaveBeenCalled();
  });
});
