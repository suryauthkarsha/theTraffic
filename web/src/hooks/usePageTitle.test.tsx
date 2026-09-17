// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { installAnalytics } from "@/lib/system/analytics";

import { usePageTitle } from "./usePageTitle";

type Win = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
const win = window as Win;

function Titled({ title }: { title: string | null | undefined }) {
  usePageTitle(title);
  return null;
}

const at = (path: string, title: string | null | undefined) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<Titled title={title} />} />
      <Route path="/signals" element={<Titled title={title} />} />
      <Route path="/intersection/:id" element={<Titled title={title} />} />
    </Routes>
  </MemoryRouter>
);

afterEach(() => {
  delete win.dataLayer;
  delete win.gtag;
  document.querySelectorAll("script").forEach((s) => s.remove());
  installAnalytics(""); // "" = off; `undefined` would read the build's configured id
  document.title = "";
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((el) => el.remove());
});

describe("usePageTitle", () => {
  it("shows the screen's search title in the tab — a junction's name on its page — and leaves a pending title alone", () => {
    document.title = "before";
    const { rerender, unmount } = render(at("/intersection/gw-1", undefined));
    expect(document.title).toBe("before"); // still loading: nothing announced
    rerender(at("/intersection/gw-1", "Silk Board Junction"));
    expect(document.title).toBe("Silk Board Junction · signal timing, Bengaluru · theTraffic.");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://www.thetraffic.in/intersection/gw-1");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow, max-image-preview:large");
    rerender(at("/intersection/gw-1", null)); // the junction is not on file
    expect(document.title).toBe("Junction not found · theTraffic.");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    unmount();
    expect(document.title).toBe("before");
  });

  it("gives the lander and the screens the same titles a crawler downloads for their addresses", () => {
    const lander = render(at("/", null));
    expect(document.title).toBe("theTraffic. · Bengaluru traffic signals, junction by junction");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://www.thetraffic.in/");
    lander.unmount(); // a MemoryRouter keeps its first history, so each address is a fresh render
    const signals = render(at("/signals", "Signal Map"));
    expect(document.title).toBe("Signal Map · Bengaluru traffic signals & timing · theTraffic.");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://www.thetraffic.in/signals");
    signals.unmount();
  });

  it("counts a page view once the title is known — never while it is pending, never for the same page twice", () => {
    installAnalytics("G-TEST123456");
    const queue = win.dataLayer ?? [];
    expect(queue).toHaveLength(2); // js + config
    window.history.replaceState(null, "", "/intersection/gw-1");

    const { rerender } = render(at("/intersection/gw-1", undefined));
    expect(queue).toHaveLength(2); // pending: not a view yet

    rerender(at("/intersection/gw-1", "Silk Board Junction"));
    expect(queue).toHaveLength(3);
    expect(Array.from(queue[2] as IArguments)).toEqual(["event", "page_view", { page_title: "Silk Board Junction · signal timing, Bengaluru · theTraffic.", page_location: "http://localhost:3000/intersection/gw-1" }]);

    rerender(at("/intersection/gw-1", "Silk Board Junction (renamed)"));
    expect(queue).toHaveLength(3); // a new title on the same page is not a second visit
  });
});
