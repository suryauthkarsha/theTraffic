import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BottomSheet, FULL_GAP_PX, SNAP_ORDER, snapAfterDrag, snapHeights, stepSnap, toggleSnap } from "./BottomSheet";

describe("bottom sheet geometry", () => {
  const g = snapHeights(760, 120, 0.5);

  it("derives peek / half / full heights from the container, leaving a strip of map above a full sheet", () => {
    expect(g).toEqual({ peek: 120, half: 380, full: 760 - FULL_GAP_PX });
  });

  it("never lets half or peek exceed full on very short containers", () => {
    const short = snapHeights(140, 120, 0.5);
    expect(short.full).toBe(128);
    expect(short.half).toBe(120); // clamped to the peek, never below it
    expect(short.peek).toBe(120);
  });

  it("a slow release rests on the nearest allowed snap", () => {
    expect(snapAfterDrag(390, 0, g, SNAP_ORDER)).toBe("half");
    expect(snapAfterDrag(150, 0, g, SNAP_ORDER)).toBe("peek");
    expect(snapAfterDrag(700, 0, g, SNAP_ORDER)).toBe("full");
  });

  it("a fling carries the sheet past the nearest snap in its direction", () => {
    // released just above half, flung upwards fast: lands on full
    expect(snapAfterDrag(400, 2.4, g, SNAP_ORDER)).toBe("full");
    // released just below half, flung downwards: lands on peek
    expect(snapAfterDrag(360, -1.6, g, SNAP_ORDER)).toBe("peek");
  });

  it("ignores snaps a screen has disabled (a screen may drop the peek snap)", () => {
    expect(snapAfterDrag(130, -3, g, ["half", "full"])).toBe("half");
    expect(stepSnap("half", -1, ["half", "full"])).toBe("half");
    expect(stepSnap("half", 1, ["half", "full"])).toBe("full");
  });

  it("steps and toggles inside the allowed order", () => {
    expect(stepSnap("peek", 1, SNAP_ORDER)).toBe("half");
    expect(stepSnap("full", 1, SNAP_ORDER)).toBe("full");
    expect(stepSnap("peek", -1, SNAP_ORDER)).toBe("peek");
    expect(toggleSnap("peek", SNAP_ORDER)).toBe("half");
    expect(toggleSnap("half", SNAP_ORDER)).toBe("full");
    expect(toggleSnap("full", SNAP_ORDER)).toBe("half");
  });
});

describe("bottom sheet markup", () => {
  it("is a labelled region with a keyboard-operable grip and a scrollable body", () => {
    const html = renderToStaticMarkup(
      <BottomSheet snap="half" onSnapChange={() => {}} label="Signal map controls" header={<span>Summary</span>}>
        <p>content</p>
      </BottomSheet>,
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Signal map controls"');
    expect(html).toContain('data-snap="half"');
    expect(html).toContain('aria-label="Expand panel"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("height:50%");
    expect(html).toContain("sheet-grip"); // touch-action: none lives on this class
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("Summary");
  });

  it("hides overflow at peek and offers to collapse when full", () => {
    const peek = renderToStaticMarkup(
      <BottomSheet snap="peek" onSnapChange={() => {}} label="x">
        <p>c</p>
      </BottomSheet>,
    );
    expect(peek).toContain("overflow-hidden");
    expect(peek).toContain('aria-expanded="false"');
    expect(peek).toContain("height:120px");
    const full = renderToStaticMarkup(
      <BottomSheet snap="full" onSnapChange={() => {}} label="x">
        <p>c</p>
      </BottomSheet>,
    );
    expect(full).toContain('aria-label="Collapse panel"');
    expect(full).toContain(`height:calc(100% - ${FULL_GAP_PX}px)`);
  });
});
