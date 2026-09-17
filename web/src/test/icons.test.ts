import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

/**
 * The icon set (user request 2026-09-13: "add an icon to the app — I don't want it to be empty").
 *
 * A search result or a browser tab shows an empty globe when the icon it is told about is missing,
 * the wrong size, or not a real image. This guard reads the files a browser or a crawler would fetch
 * and checks each one is what the <head>, the manifest and the structured data say it is: a square PNG
 * of the declared size, an .ico that really holds its three frames, and the mark's colours — black and
 * orange, nothing else (.rork/DESIGN.md).
 */
const WEB = path.resolve(__dirname, "../..");
const PUBLIC = path.join(WEB, "public");
const html = readFileSync(path.join(WEB, "index.html"), "utf8");

/** Width and height from a PNG's IHDR chunk — the bytes a browser reads before it decides to draw it. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString("hex"), `${path.basename(file)} is a PNG`).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The pixels of an 8-bit RGB, non-interlaced PNG — what the build script writes — decoded by hand so
 * the test needs no image library: the IDAT stream inflated, then each scanline's filter undone.
 */
function pngPixels(file: string): { width: number; height: number; rgb: Uint8Array } {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]], `${path.basename(file)}: 8-bit RGB, not interlaced`).toEqual([8, 2, 0]);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp;
  const rgb = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rgb[y * stride + x - bpp]! : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? rgb[(y - 1) * stride + x - bpp]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rgb[y * stride + x] = (line[x]! + predicted) & 0xff;
    }
  }
  return { width, height, rgb };
}

/** The frame sizes an ICO directory declares (0 in the header means 256). */
function icoFrames(file: string): number[] {
  const buf = readFileSync(file);
  expect(buf.readUInt16LE(0), "reserved").toBe(0);
  expect(buf.readUInt16LE(2), "type: icon").toBe(1);
  const count = buf.readUInt16LE(4);
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const w = buf.readUInt8(entry) || 256;
    const h = buf.readUInt8(entry + 1) || 256;
    expect(w, `frame ${i} is square`).toBe(h);
    const offset = buf.readUInt32LE(entry + 12);
    const bytes = buf.readUInt32LE(entry + 8);
    expect(offset + bytes, `frame ${i} lies inside the file`).toBeLessThanOrEqual(buf.length);
    sizes.push(w);
  }
  return sizes.sort((a, b) => a - b);
}

/** Every `<link rel="icon" | "apple-touch-icon">` in index.html with its href and declared sizes. */
function iconLinks(): { rel: string; href: string; sizes: string[] }[] {
  return [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"([^>]*)>/g)].map(([, rel, attrs]) => ({
    rel,
    href: /href="([^"]+)"/.exec(attrs)?.[1] ?? "",
    sizes: (/sizes="([^"]+)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean),
  }));
}

describe("the icon set", () => {
  const links = iconLinks();

  it("declares the sizes browsers and search engines look for: 16, 32, 48 and 192 px, and a touch icon", () => {
    const declared = new Set(links.filter((l) => l.rel === "icon").flatMap((l) => l.sizes));
    for (const s of ["16x16", "32x32", "48x48", "192x192"]) expect(declared.has(s), s).toBe(true);
    expect(links.filter((l) => l.rel === "apple-touch-icon").map((l) => l.sizes)).toEqual([["180x180"]]);
    for (const l of links) expect(l.href, `${l.rel} is a same-origin absolute path`).toMatch(/^\/[a-z0-9.-]+\.(ico|png)$/);
  });

  it("ships every declared PNG at exactly its declared size, square", () => {
    for (const l of links.filter((l) => l.href.endsWith(".png"))) {
      const file = path.join(PUBLIC, l.href.slice(1));
      expect(existsSync(file), `${l.href} exists`).toBe(true);
      const [w, h] = l.sizes[0]!.split("x").map(Number);
      expect(pngSize(file), l.href).toEqual({ width: w, height: h });
      expect(w).toBe(h);
    }
  });

  it("ships an .ico whose frames are the sizes the link declares", () => {
    const ico = links.find((l) => l.href.endsWith(".ico"));
    expect(ico, "one .ico link").toBeDefined();
    const file = path.join(PUBLIC, ico!.href.slice(1));
    expect(icoFrames(file)).toEqual(ico!.sizes.map((s) => Number(s.split("x")[0])).sort((a, b) => a - b));
  });

  it("matches the manifest's icons and the structured data's logo to real files of the stated size", () => {
    const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
      icons: { src: string; sizes: string; type: string }[];
    };
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC, icon.src.slice(1));
      expect(existsSync(file), `${icon.src} exists`).toBe(true);
      expect(icon.type).toBe("image/png");
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(file), icon.src).toEqual({ width: w, height: h });
    }
    const logo = /"logo":\s*"https:\/\/www\.thetraffic\.in(\/[^"]+)"/.exec(html)?.[1];
    expect(logo, "Organization.logo names a file of ours").toBeDefined();
    expect(existsSync(path.join(PUBLIC, logo!.slice(1)))).toBe(true);
  });

  it("is the mark in the product's two colours at tab sizes: black canvas, orange route, nothing else", () => {
    for (const name of ["favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png"]) {
      const { width, height, rgb } = pngPixels(path.join(PUBLIC, name));
      let orange = 0;
      let black = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        const [r, g, b] = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
        // every pixel is t × #FF8A2B for some t in [0, 1]: a flat blend of the two colours, no other hue
        const t = r / 255;
        expect(Math.abs(g - t * 0x8a), `${name} pixel ${i / 3} green`).toBeLessThanOrEqual(8);
        expect(Math.abs(b - t * 0x2b), `${name} pixel ${i / 3} blue`).toBeLessThanOrEqual(8);
        if (r === 0xff && g === 0x8a && b === 0x2b) orange++;
        if (r === 0 && g === 0 && b === 0) black++;
      }
      expect(orange, `${name} has solid orange`).toBeGreaterThan(0);
      expect(black, `${name} has canvas`).toBeGreaterThan(orange);
      const centre = ((height >> 1) * width + (width >> 1)) * 3;
      expect([...rgb.subarray(centre, centre + 3)], `${name} centre is a junction`).toEqual([0xff, 0x8a, 0x2b]);
      expect([...rgb.subarray(0, 3)], `${name} top-left corner is canvas`).toEqual([0, 0, 0]);
    }
  });
});
