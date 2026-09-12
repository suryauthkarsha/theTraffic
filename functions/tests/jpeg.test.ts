/**
 * bun test functions/tests
 * The JPEG gate: only real JPEGs pass, dimensions come from the frame header, metadata leaves.
 */
import { describe, expect, test } from "bun:test";

import { inspectJpeg, MAX_EDGE } from "../_lib/jpeg";
import fixtures from "./fixtures.json";

const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

/** Marker list of a JPEG's segments before the scan, for asserting what survived. */
function markers(b: Uint8Array): number[] {
  const out: number[] = [];
  let i = 2;
  while (i < b.length) {
    const m = b[i + 1];
    if (m === 0xda) return out;
    out.push(m);
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return out;
}

describe("inspectJpeg", () => {
  test("reads the true dimensions of a baseline JPEG and strips application metadata and comments while keeping decoding tables and the frame", () => {
    const input = bytes(fixtures.baselineWithExif);
    expect(markers(input)).toContain(0xe1); // EXIF present in the fixture…
    expect(markers(input)).toContain(0xfe); // …and a comment
    const info = inspectJpeg(input);
    expect(info).not.toBeNull();
    expect(info?.width).toBe(12);
    expect(info?.height).toBe(8);
    const kept = markers(info!.bytes);
    expect(kept).not.toContain(0xe1);
    expect(kept).not.toContain(0xfe);
    expect(kept).not.toContain(0xe0); // even APP0 can carry arbitrary application payloads
    expect(kept).toContain(0xdb); // quantisation tables stay
    expect(kept).toContain(0xc0); // the frame header stays
    expect(kept).toContain(0xc4); // Huffman tables stay
    expect(info!.bytes.length).toBeLessThan(input.length);
    expect(Buffer.from(info!.bytes).includes(Buffer.from("Phone"))).toBe(false);
    expect(Buffer.from(info!.bytes).includes(Buffer.from("secret comment"))).toBe(false);
    // the scan and the end marker are intact
    expect(info!.bytes[info!.bytes.length - 2]).toBe(0xff);
    expect(info!.bytes[info!.bytes.length - 1]).toBe(0xd9);
    // the result still parses as the same image
    expect(inspectJpeg(info!.bytes)).toMatchObject({ width: 12, height: 8 });
  });

  test("accepts a progressive greyscale JPEG", () => {
    const info = inspectJpeg(bytes(fixtures.progressiveGray));
    expect(info).toMatchObject({ width: 9, height: 5 });
  });

  test("strips every application marker after a scan and refuses bytes after the end marker", () => {
    const original = bytes(fixtures.baselineWithExif);
    const eoi = original.length - 2;
    expect(Array.from(original.subarray(eoi))).toEqual([0xff, 0xd9]);

    for (const marker of [0xe0, 0xe1, 0xee, 0xfe]) {
      const payload = new TextEncoder().encode(`after-scan secret ${marker}`);
      const segment = new Uint8Array([0xff, marker, 0x00, payload.length + 2, ...payload]);
      const withLateMetadata = new Uint8Array(original.length + segment.length);
      withLateMetadata.set(original.subarray(0, eoi));
      withLateMetadata.set(segment, eoi);
      withLateMetadata.set(original.subarray(eoi), eoi + segment.length);

      const info = inspectJpeg(withLateMetadata);
      expect(info).not.toBeNull();
      expect(Buffer.from(info!.bytes).includes(payload)).toBe(false);
      expect(info!.bytes[info!.bytes.length - 2]).toBe(0xff);
      expect(info!.bytes[info!.bytes.length - 1]).toBe(0xd9);
    }

    const trailing = new Uint8Array(original.length + 1);
    trailing.set(original);
    trailing[trailing.length - 1] = 0x41;
    expect(inspectJpeg(trailing)).toBeNull();
  });

  test("refuses anything that is not a JPEG we accept", () => {
    expect(inspectJpeg(bytes(fixtures.png))).toBeNull();
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8]))).toBeNull(); // SOI alone
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no frame, no scan
    const truncated = bytes(fixtures.baselineWithExif).subarray(0, 60);
    expect(inspectJpeg(truncated)).toBeNull();
    // a segment claiming to run past the end
    const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00]);
    expect(inspectJpeg(bad)).toBeNull();
    // a scan before any frame header
    expect(inspectJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toBeNull();
  });

  test("refuses a frame larger than the cap — a decompression bomb hiding in a small file", () => {
    const input = bytes(fixtures.baselineWithExif);
    const forged = new Uint8Array(input);
    // find SOF0 and overwrite the width with MAX_EDGE + 1
    let i = 2;
    while (i < forged.length && forged[i + 1] !== 0xc0) i += 2 + ((forged[i + 2] << 8) | forged[i + 3]);
    const w = MAX_EDGE + 1;
    forged[i + 7] = w >> 8;
    forged[i + 8] = w & 0xff;
    expect(inspectJpeg(forged)).toBeNull();
    // and a four-component (CMYK) frame
    const cmyk = new Uint8Array(input);
    cmyk[i + 9] = 4;
    expect(inspectJpeg(cmyk)).toBeNull();
  });
});
