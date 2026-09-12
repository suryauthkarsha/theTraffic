import { describe, expect, it } from "vitest";

import { applyPreviewInsets, installPreviewInsets, isFramed, NO_INSETS, PREVIEW_INSETS, previewInsets, type InsetHost } from "./previewInsets";

function fakeHost(opts: { framed: boolean; width: number }): { host: InsetHost; vars: Map<string, string>; resize: () => void } {
  const vars = new Map<string, string>();
  const listeners: (() => void)[] = [];
  const self = {};
  const host: InsetHost = {
    self,
    top: opts.framed ? {} : self,
    innerWidth: opts.width,
    document: { documentElement: { style: { setProperty: (n, v) => vars.set(n, v) } } },
    addEventListener: (_t, fn) => listeners.push(fn),
  };
  return { host, vars, resize: () => listeners.forEach((fn) => fn()) };
}

describe("preview safe-area fallback", () => {
  it("only a framed, phone-sized page gets the drawn phone's insets", () => {
    expect(previewInsets(true, 393)).toEqual(PREVIEW_INSETS);
    expect(previewInsets(false, 393)).toEqual(NO_INSETS); // a real phone at the top level reports env() itself
    expect(previewInsets(true, 1280)).toEqual(NO_INSETS); // desktop frame: nothing is drawn over the page
    expect(previewInsets(true, 0)).toEqual(NO_INSETS); // not laid out yet
  });

  it("detects a frame, treating an unreadable cross-origin top as framed", () => {
    const self = {};
    expect(isFramed({ self, top: self })).toBe(false);
    expect(isFramed({ self, top: {} })).toBe(true);
    expect(
      isFramed({
        self,
        get top(): unknown {
          throw new Error("cross-origin");
        },
      }),
    ).toBe(true);
  });

  it("publishes the insets as CSS variables and follows resizes", () => {
    const framed = fakeHost({ framed: true, width: 393 });
    expect(applyPreviewInsets(framed.host)).toEqual(PREVIEW_INSETS);
    expect(framed.vars.get("--gw-preview-top")).toBe("59px");
    expect(framed.vars.get("--gw-preview-bottom")).toBe("34px");

    const bare = fakeHost({ framed: false, width: 393 });
    installPreviewInsets(bare.host);
    expect(bare.vars.get("--gw-preview-top")).toBe("0px");
    expect(bare.vars.get("--gw-preview-bottom")).toBe("0px");

    const grows = fakeHost({ framed: true, width: 393 });
    installPreviewInsets(grows.host);
    expect(grows.vars.get("--gw-preview-top")).toBe("59px");
    (grows.host as { innerWidth: number }).innerWidth = 1024; // the user switches to the desktop frame
    grows.resize();
    expect(grows.vars.get("--gw-preview-top")).toBe("0px");
  });
});
