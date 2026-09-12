/**
 * JPEG inspection for uploaded photos. Pure, dependency-free.
 *
 * The browser re-encodes every photo through a canvas, which already drops the camera's metadata — but
 * the server trusts nothing it did not check itself: the bytes must parse as a baseline or progressive
 * JPEG, the frame header gives the true dimensions, and every metadata segment (EXIF, XMP, IPTC, ICC,
 * comments) is removed before the bytes are stored. What comes out is pixels and the tables that decode
 * them, nothing else.
 */
export interface JpegInfo {
  width: number;
  height: number;
  /** The same image without any APPn or COM segment. */
  bytes: Uint8Array;
}

/** The largest frame accepted — a decompression bomb hiding in a small file is refused here. */
export const MAX_EDGE = 2000;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

/** Start-of-frame markers (SOF0–SOF15, minus DHT 0xC4, JPG 0xC8 and DAC 0xCC, which share the range). */
const isSOF = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/** Application segments APP0–APP15 and comments may all carry arbitrary payloads. */
const isMetadata = (m: number): boolean => (m >= 0xe0 && m <= 0xef) || m === COM;

/**
 * Parse and strip. Returns null when the bytes are not a JPEG we accept: no SOI, a truncated or
 * malformed segment, no frame header before the scan, an unsupported component count, or a frame
 * larger than `MAX_EDGE` on either side.
 */
export function inspectJpeg(input: Uint8Array): JpegInfo | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) return null;
  const kept: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let pos = 2;
  let sawScan = false;
  while (pos < input.length) {
    if (input[pos] !== 0xff) return null;
    while (pos < input.length && input[pos] === 0xff) pos++; // marker fill bytes
    if (pos >= input.length) return null;
    const marker = input[pos++];

    if (marker === EOI) {
      if (!sawScan || width === 0 || height === 0 || pos !== input.length) return null;
      kept.push(new Uint8Array([0xff, EOI]));
      return { width, height, bytes: concat(kept) };
    }
    if (marker === SOI || marker === 0x00) return null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) return null; // valid only inside entropy-coded data
    if (pos + 2 > input.length) return null;
    const length = (input[pos] << 8) | input[pos + 1];
    if (length < 2 || pos + length > input.length) return null;

    if (isSOF(marker)) {
      if (length < 8) return null;
      const nextHeight = (input[pos + 3] << 8) | input[pos + 4];
      const nextWidth = (input[pos + 5] << 8) | input[pos + 6];
      const components = input[pos + 7];
      if (nextWidth < 1 || nextHeight < 1 || nextWidth > MAX_EDGE || nextHeight > MAX_EDGE) return null;
      if (components !== 1 && components !== 3) return null;
      if ((width && width !== nextWidth) || (height && height !== nextHeight)) return null;
      width = nextWidth;
      height = nextHeight;
    }

    if (marker === SOS) {
      if (width === 0 || height === 0) return null;
      sawScan = true;
      kept.push(new Uint8Array([0xff, SOS]), input.subarray(pos, pos + length));
      pos += length;
      const entropyStart = pos;
      let foundNextMarker = false;
      while (pos < input.length) {
        if (input[pos] !== 0xff) {
          pos++;
          continue;
        }
        const markerStart = pos;
        while (pos < input.length && input[pos] === 0xff) pos++;
        if (pos >= input.length) return null;
        const inScanMarker = input[pos];
        if (inScanMarker === 0x00 || (inScanMarker >= 0xd0 && inScanMarker <= 0xd7) || inScanMarker === 0x01) {
          pos++;
          continue;
        }
        kept.push(input.subarray(entropyStart, markerStart));
        pos = markerStart;
        foundNextMarker = true;
        break;
      }
      if (!foundNextMarker) return null;
      continue;
    }

    if (!isMetadata(marker)) kept.push(new Uint8Array([0xff, marker]), input.subarray(pos, pos + length));
    pos += length;
  }
  return null;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
