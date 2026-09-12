import { useEffect, useRef } from "react";

import { frameToHtml, frameToText, knotFrame } from "@/lib/knot/trefoil";
import { cn } from "@/lib/utils";

/**
 * KnotAnimation
 *
 * - Animated ASCII trefoil knot with optional coloured tube segments.
 * - Pass the prop `color={true}` to enable colour; default is grayscale (inherits `color`).
 * - Pass the props `speedA` and `speedB` to control the spin speed (optional).
 *
 * Props:
 * - color?: boolean (default: false) — enable coloured tube segments
 * - speedA?: number (default: 0.04) — rotation speed around the X axis (radians per frame)
 * - speedB?: number (default: 0.02) — rotation speed around the Y axis (radians per frame)
 * - palette?: string[] — colours cycled per tube segment when `color` is on (default: DEFAULT_KNOT_PALETTE)
 * - frameMs?: number (default: 30) — minimum milliseconds between frames
 * - className?: string — merged onto the <pre> (use it to size the glyphs, e.g. `text-[9px]`)
 * - label?: string — accessible description; without one the figure is decorative (aria-hidden)
 *
 * Implementation notes: the frame is painted straight into the <pre> (textContent, or innerHTML
 * for colour) from a requestAnimationFrame loop, so nothing re-renders in React per frame. The
 * loop pauses while the element is off-screen or the tab is hidden, and `prefers-reduced-motion`
 * renders a single still frame.
 */
export const DEFAULT_KNOT_PALETTE: readonly string[] = [
  "#e53935", // red
  "#43a047", // green
  "#fbc02d", // yellow
  "#1e88e5", // blue
  "#8e24aa", // purple
  "#fb8c00", // orange
  "#00897b", // teal
  "#c0ca33", // lime
];

export interface KnotAnimationProps {
  color?: boolean;
  speedA?: number;
  speedB?: number;
  palette?: readonly string[];
  frameMs?: number;
  className?: string;
  label?: string;
}

/** Still-frame pose used when the user prefers reduced motion. */
const STILL_A = 0.9;
const STILL_B = 0.6;

export const KnotAnimation = ({ color = false, speedA = 0.04, speedB = 0.02, palette = DEFAULT_KNOT_PALETTE, frameMs = 30, className, label }: KnotAnimationProps) => {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const paint = (A: number, B: number) => {
      const frame = knotFrame(A, B);
      if (color) el.innerHTML = frameToHtml(frame, palette);
      else el.textContent = frameToText(frame);
    };

    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof requestAnimationFrame !== "function") {
      paint(STILL_A, STILL_B);
      return;
    }

    let A = 0;
    let B = 0;
    let last = 0;
    let visible = true;
    let raf = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden || t - last < frameMs) return;
      last = t;
      A += speedA;
      B += speedB;
      paint(A, B);
    };

    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    }) : null;
    io?.observe(el);

    paint(A, B);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [color, speedA, speedB, palette, frameMs]);

  return <pre ref={ref} className={cn("font-mono text-xs whitespace-pre leading-none text-center", className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
};
