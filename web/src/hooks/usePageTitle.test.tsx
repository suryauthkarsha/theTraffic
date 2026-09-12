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

afterEach(() => {
  delete win.dataLayer;
  delete win.gtag;
  document.querySelectorAll("script").forEach((s) => s.remove());
  installAnalytics(""); // "" = off; `undefined` would read the build's configured id
  document.title = "";
});

describe("usePageTitle", () => {
  it("brands every title, gives the lander the city, and leaves a pending title alone", () => {
    document.title = "before";
    const { rerender, unmount } = render(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Titled title={undefined} />
      </MemoryRouter>,
    );
    expect(document.title).toBe("before"); // still loading: nothing announced
    rerender(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Titled title="Silk Board Junction" />
      </MemoryRouter>,
    );
    expect(document.title).toBe("Silk Board Junction · theTraffic.");
    rerender(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Titled title={null} />
      </MemoryRouter>,
    );
    expect(document.title).toBe("theTraffic. · Bengaluru");
    unmount();
    expect(document.title).toBe("before");
  });

  it("counts a page view once the title is known — never while it is pending, never for the same page twice", () => {
    installAnalytics("G-TEST123456");
    const queue = win.dataLayer ?? [];
    expect(queue).toHaveLength(2); // js + config
    window.history.replaceState(null, "", "/intersection/gw-1");

    const { rerender } = render(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Routes>
          <Route path="/intersection/:id" element={<Titled title={undefined} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(queue).toHaveLength(2); // pending: not a view yet

    rerender(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Routes>
          <Route path="/intersection/:id" element={<Titled title="Silk Board Junction" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(queue).toHaveLength(3);
    expect(Array.from(queue[2] as IArguments)).toEqual(["event", "page_view", { page_title: "Silk Board Junction · theTraffic.", page_location: "http://localhost:3000/intersection/gw-1" }]);

    rerender(
      <MemoryRouter initialEntries={["/intersection/gw-1"]}>
        <Routes>
          <Route path="/intersection/:id" element={<Titled title="Silk Board Junction (renamed)" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(queue).toHaveLength(3); // a new title on the same page is not a second visit
  });
});
