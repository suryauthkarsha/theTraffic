import { describe, expect, it } from "vitest";

import { frameToHtml, frameToText, KNOT_H, KNOT_RAMP, KNOT_W, knotFrame, safeColor } from "./trefoil";

describe("trefoil knot renderer", () => {
  it("renders an 80×40 grid whose glyphs all come from the brightness ramp", () => {
    const text = frameToText(knotFrame(0.9, 0.6));
    const lines = text.split("\n");
    expect(lines).toHaveLength(KNOT_H);
    for (const line of lines) expect(line).toHaveLength(KNOT_W);
    const glyphs = text.replace(/[\s\n]/g, "");
    expect(glyphs.length).toBeGreaterThan(400); // the knot covers a good part of the grid
    for (const ch of new Set(glyphs)) expect(KNOT_RAMP).toContain(ch);
  });

  it("is lit: bright and dark glyphs both appear in one frame", () => {
    const text = frameToText(knotFrame(0.3, 1.1));
    expect(text).toMatch(/[#$@]/);
    expect(text).toMatch(/[.,-]/);
  });

  it("rotation changes the frame", () => {
    expect(frameToText(knotFrame(0, 0))).not.toBe(frameToText(knotFrame(0.5, 0.25)));
  });

  it("colour mode groups runs into spans that cycle the palette and never emit markup for blanks", () => {
    const frame = knotFrame(0.9, 0.6);
    const html = frameToHtml(frame, ["#e8eef0", "#32d583"]);
    expect(html).toContain('<span style="color:#e8eef0">');
    expect(html).toContain('<span style="color:#32d583">');
    const stripped = html.replace(/<span style="color:#[0-9a-f]{6}">|<\/span>/g, "");
    expect(stripped).toBe(frameToText(frame));
    expect(html.split("\n")).toHaveLength(KNOT_H);
  });

  it("an empty palette falls back to plain text and unsafe colours are neutralised", () => {
    const frame = knotFrame(0.9, 0.6);
    expect(frameToHtml(frame, [])).toBe(frameToText(frame));
    expect(safeColor('"><img src=x onerror=alert(1)>')).toBe("inherit");
    expect(safeColor("rgb(50, 213, 131)")).toBe("rgb(50, 213, 131)");
    expect(frameToHtml(frame, ['"><b>'])).toContain('style="color:inherit"');
    expect(frameToHtml(frame, ['"><b>'])).not.toContain("<b>");
  });
});
