/**
 * Keep a context menu inside the window (#109), the way macOS does: a menu
 * opened near the bottom edge opens upward from the pointer, and near the
 * right edge it opens to the left of it. Without this a node's menu opened
 * on a node near the bottom of the canvas (the input row, where inputs sit
 * by convention) ran off the window, its items out of reach.
 *
 * `x`, `y` are the pointer's window coordinates; the result is where the
 * menu's top-left corner goes. Measured before paint, so the menu never
 * flashes in the wrong place.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

/** A menu keeps this far from the window's edge. */
const EDGE = 4;

/** Where a menu of size `w`×`h`, opened at the pointer (x, y), fits. */
export function placeInWindow(x: number, y: number, w: number, h: number, winW: number, winH: number) {
  let left = x;
  let top = y;
  if (left + w > winW - EDGE) left = Math.max(EDGE, x - w);
  if (top + h > winH - EDGE) top = Math.max(EDGE, Math.min(y - h, winH - EDGE - h));
  return { left, top };
}

export function useMenuInWindow(ref: RefObject<HTMLElement | null>, x: number, y: number) {
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const next = placeInWindow(x, y, r.width, r.height, window.innerWidth, window.innerHeight);
      setPos((p) => (p.left === next.left && p.top === next.top ? p : next));
    };
    place();
    // The menu can change size while open (Rename… turns a row into a field).
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref, x, y]);
  return pos;
}
