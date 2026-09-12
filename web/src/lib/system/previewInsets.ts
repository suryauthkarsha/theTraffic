/**
 * Safe-area insets when the site runs framed inside the Rork preview.
 *
 * The preview shows the site in an iframe with a phone drawn around it — status bar (time, signal,
 * battery) and home indicator included. Inside an iframe `env(safe-area-inset-*)` is always 0px,
 * because the browser has no notch to report, so the drawn status bar would sit on top of our top
 * bar. When the page is framed and phone-sized we publish the drawn phone's insets as CSS
 * variables (`--gw-preview-top` / `--gw-preview-bottom`); `index.css` takes the larger of the real
 * environment value and the fallback, so real phones — top level in a browser, or installed to the
 * home screen — are never affected, and desktop or tablet frames (no status bar over the page) get
 * nothing.
 */

export interface Insets {
  top: number;
  bottom: number;
}

/** The drawn phone is an iPhone with a Dynamic Island: 59 px status area, 34 px home indicator. */
export const PREVIEW_INSETS: Insets = { top: 59, bottom: 34 };

export const NO_INSETS: Insets = { top: 0, bottom: 0 };

/** Widest viewport that still counts as a phone frame; wider frames draw no chrome over the page. */
export const PHONE_FRAME_MAX_WIDTH = 600;

/** Fallback insets for a page: only when framed and phone-sized. Pure. */
export function previewInsets(framed: boolean, viewportWidth: number): Insets {
  return framed && viewportWidth > 0 && viewportWidth < PHONE_FRAME_MAX_WIDTH ? PREVIEW_INSETS : NO_INSETS;
}

/** The identity slice of `window`: `self` and `top` compared by reference, never inspected. */
export interface FrameIdentity {
  readonly self: unknown;
  readonly top: unknown;
}

/** True when the page is not the top-level document. A cross-origin `top` we cannot read counts as framed. */
export function isFramed(win: FrameIdentity): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** The slice of `window` the installer touches — a test can hand in a fake. */
export interface InsetHost extends FrameIdentity {
  readonly innerWidth: number;
  readonly document: { documentElement: { style: { setProperty(name: string, value: string): void } } };
  addEventListener(type: "resize", listener: () => void): void;
}

/** Writes the fallback insets for the current frame state to `<html>`; returns what was applied. */
export function applyPreviewInsets(win: InsetHost): Insets {
  const insets = previewInsets(isFramed(win), win.innerWidth);
  const style = win.document.documentElement.style;
  style.setProperty("--gw-preview-top", `${insets.top}px`);
  style.setProperty("--gw-preview-bottom", `${insets.bottom}px`);
  return insets;
}

/** Applies once before the first paint and again whenever the frame is resized. */
export function installPreviewInsets(win: InsetHost = window): void {
  applyPreviewInsets(win);
  win.addEventListener("resize", () => applyPreviewInsets(win));
}
