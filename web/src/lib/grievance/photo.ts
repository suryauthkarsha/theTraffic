import { PHOTO_INPUT_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_QUALITY_MIN, PHOTO_QUALITY_START, PHOTO_TARGET_BYTES, type GrievancePhoto } from "./grievance";

/**
 * Shrink a picked or captured photo in the browser: decoded with its orientation applied, scaled to
 * `PHOTO_MAX_EDGE` on the long side, re-encoded as JPEG at a quality stepped down until the file fits
 * under the board's cap. The re-encode carries no metadata, so the camera's own position tags never
 * travel — the place in a grievance is only ever the one the visitor marks. Nothing here touches a live
 * camera: the photo arrives through the operating system's picker.
 */
export class PhotoError extends Error {}

type Decoded = { source: ImageBitmap | HTMLImageElement; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older engines reject some encodings here; the <img> path below reads them.
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new PhotoError("That photo could not be read."));
    el.src = url;
  }).finally(() => URL.revokeObjectURL(url));
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
}

const encode = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** The quality steps tried, highest first, until the JPEG fits `PHOTO_TARGET_BYTES`. Pure. */
export function qualityLadder(start: number = PHOTO_QUALITY_START, min: number = PHOTO_QUALITY_MIN, step = 0.08): number[] {
  const out: number[] = [];
  for (let q = start; q >= min - 1e-9; q -= step) out.push(Number(q.toFixed(2)));
  if (out[out.length - 1] !== min) out.push(min);
  return out;
}

/** The scale that fits an image inside `maxEdge` without ever enlarging it. Pure. */
export function fitScale(width: number, height: number, maxEdge: number = PHOTO_MAX_EDGE): number {
  return Math.min(1, maxEdge / Math.max(width, height));
}

export async function shrinkPhoto(file: File): Promise<GrievancePhoto> {
  if (!file.type.startsWith("image/")) throw new PhotoError("That file is not a photo.");
  if (file.size > PHOTO_INPUT_MAX_BYTES) throw new PhotoError(`That photo is over ${Math.round(PHOTO_INPUT_MAX_BYTES / 1_048_576)} MB.`);
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch (e) {
    throw e instanceof PhotoError ? e : new PhotoError("That photo could not be read.");
  }
  try {
    if (decoded.width < 1 || decoded.height < 1) throw new PhotoError("That photo could not be read.");
    const scale = fitScale(decoded.width, decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("This browser cannot resize the photo.");
    ctx.drawImage(decoded.source, 0, 0, width, height);
    let blob: Blob | null = null;
    for (const q of qualityLadder()) {
      blob = await encode(canvas, q);
      if (!blob) throw new PhotoError("This browser cannot resize the photo.");
      if (blob.size <= PHOTO_TARGET_BYTES) break;
    }
    if (!blob) throw new PhotoError("This browser cannot resize the photo.");
    if (blob.size > PHOTO_TARGET_BYTES) throw new PhotoError("That photo stays too detailed to post — try a plainer one.");
    return { blob, width, height, bytes: blob.size, originalBytes: file.size };
  } finally {
    decoded.release();
  }
}

/** The sentence shown for a failed pick. */
export function photoErrorMessage(e: unknown): string {
  return e instanceof PhotoError ? e.message : "That photo could not be read.";
}
