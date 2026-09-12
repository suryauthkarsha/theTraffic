import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The three resting positions of the sheet, smallest first. */
export type SheetSnap = "peek" | "half" | "full";
export const SNAP_ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

export interface SnapGeometry {
  peek: number;
  half: number;
  full: number;
}

/** Gap left above a fully open sheet so a strip of map still shows it is a sheet, not a page. */
export const FULL_GAP_PX = 12;
/** A fling this fast (px/ms) carries the sheet one snap further than where it was released. */
const FLING_LOOKAHEAD_MS = 160;
/** Pointer travel under this is a tap on the grip, not a drag. */
const TAP_SLOP_PX = 6;

/** Pixel height of each snap inside a container `containerH` px tall. Pure; exported for tests. */
export function snapHeights(containerH: number, peekPx: number, halfFraction: number): SnapGeometry {
  const full = Math.max(peekPx, containerH - FULL_GAP_PX);
  const half = Math.min(full, Math.max(peekPx, Math.round(containerH * halfFraction)));
  return { peek: Math.min(peekPx, full), half, full };
}

/**
 * Where a released drag comes to rest: the allowed snap nearest to the release height, projected a
 * little along the fling velocity (px/ms, positive = upwards). Pure; exported for tests.
 */
export function snapAfterDrag(heightPx: number, velocity: number, geometry: SnapGeometry, allowed: readonly SheetSnap[]): SheetSnap {
  const projected = heightPx + velocity * FLING_LOOKAHEAD_MS;
  let best: SheetSnap = allowed[0] ?? "half";
  let bestDistance = Infinity;
  for (const s of allowed) {
    const d = Math.abs(geometry[s] - projected);
    if (d < bestDistance) {
      bestDistance = d;
      best = s;
    }
  }
  return best;
}

/** One snap up (`+1`) or down (`-1`) from `current`, limited to the allowed snaps. Pure; exported for tests. */
export function stepSnap(current: SheetSnap, direction: 1 | -1, allowed: readonly SheetSnap[]): SheetSnap {
  const order = SNAP_ORDER.filter((s) => allowed.includes(s));
  if (!order.length) return current;
  const i = Math.max(0, order.indexOf(current));
  return order[Math.min(order.length - 1, Math.max(0, i + direction))];
}

/** A tap on the grip: collapse from full, otherwise expand one step. Pure; exported for tests. */
export const toggleSnap = (current: SheetSnap, allowed: readonly SheetSnap[]): SheetSnap => stepSnap(current, current === "full" ? -1 : 1, allowed);

export interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (next: SheetSnap) => void;
  /** Accessible name of the sheet region. */
  label: string;
  children: ReactNode;
  /** Always-visible row under the grip (a one-line summary); part of the peek. Keep it non-interactive — taps here move the sheet. */
  header?: ReactNode;
  /** Snaps the user may rest on (default all three). */
  snaps?: readonly SheetSnap[];
  /** Height of the peek state in px, grip included. */
  peekHeight?: number;
  /** Fraction of the container the half state occupies. */
  halfFraction?: number;
  className?: string;
  /** Scrollable body; receives focus events so a page can expand the sheet when a field is focused. */
  bodyClassName?: string;
  onBodyFocus?: (target: HTMLElement) => void;
  /** Whenever this changes the body scrolls back to the top (new content was placed there). */
  scrollTopKey?: string | number | null;
}

interface DragState {
  startY: number;
  startH: number;
  lastY: number;
  lastT: number;
  velocity: number;
  moved: boolean;
}

/**
 * Phone layout for map screens: the map fills the viewport and this sheet owns the bottom edge.
 * Drag the grip (or the header row) between peek, half and full; a tap on the grip steps it; the
 * grip button takes the arrow keys. Heights are relative to the positioned parent, so the sheet
 * sits between the top bar and the system rail. Motion is a single height transition, none under
 * `prefers-reduced-motion`.
 */
export function BottomSheet({ snap, onSnapChange, label, children, header, snaps = SNAP_ORDER, peekHeight = 120, halfFraction = 0.5, className, bodyClassName, onBodyFocus, scrollTopKey = null }: BottomSheetProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const allowed = snaps.length ? snaps : SNAP_ORDER;
  const current: SheetSnap = allowed.includes(snap) ? snap : (allowed[0] ?? "half");
  const smallest = SNAP_ORDER.find((s) => allowed.includes(s)) ?? "peek";

  const geometry = (): SnapGeometry => snapHeights(rootRef.current?.parentElement?.clientHeight ?? (typeof window !== "undefined" ? window.innerHeight : 800), peekHeight, halfFraction);
  const clampHeight = (h: number, g: SnapGeometry): number => Math.min(g.full, Math.max(g[smallest], h));

  useEffect(() => {
    if (current === "peek") bodyRef.current?.scrollTo({ top: 0 });
  }, [current]);
  useEffect(() => {
    if (scrollTopKey !== null) bodyRef.current?.scrollTo({ top: 0 });
  }, [scrollTopKey]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: el.offsetHeight, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (!d.moved && Math.abs(dy) < TAP_SLOP_PX) return;
    d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = (d.lastY - e.clientY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragHeight(clampHeight(d.startH + dy, geometry()));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragHeight(null);
    if (!d.moved) {
      onSnapChange(toggleSnap(current, allowed));
      return;
    }
    const g = geometry();
    onSnapChange(snapAfterDrag(clampHeight(d.startH + (d.startY - e.clientY), g), d.velocity, g, allowed));
  };
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onSnapChange(stepSnap(current, 1, allowed));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onSnapChange(stepSnap(current, -1, allowed));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSnapChange(toggleSnap(current, allowed));
    }
  };

  const height = dragHeight !== null ? `${dragHeight}px` : current === "full" ? `calc(100% - ${FULL_GAP_PX}px)` : current === "half" ? `${Math.round(halfFraction * 1000) / 10}%` : `${peekHeight}px`;
  const gripLabel = current === "full" ? "Collapse panel" : "Expand panel";

  return (
    <section ref={rootRef} role="region" aria-label={label} data-snap={current} className={cn("sheet absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[8px] border-t border-gw-border bg-gw-surface", dragHeight === null && "transition-[height] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]", className)} style={{ height }}>
      <div className="sheet-grip shrink-0 border-b border-gw-border/60" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <button type="button" className="flex h-8 w-full items-center justify-center" aria-label={gripLabel} aria-expanded={current !== "peek"} onKeyDown={onGripKey}>
          <span className="h-1 w-9 rounded-full bg-gw-tick" aria-hidden />
        </button>
        {header && <div className="px-4 pb-2.5">{header}</div>}
      </div>
      <div ref={bodyRef} className={cn("sheet-body min-h-0 flex-1 px-4 pb-6 pt-3", current === "peek" && dragHeight === null ? "overflow-hidden" : "overflow-y-auto", bodyClassName)} onFocusCapture={onBodyFocus ? (e) => onBodyFocus(e.target as HTMLElement) : undefined}>
        {children}
      </div>
    </section>
  );
}
