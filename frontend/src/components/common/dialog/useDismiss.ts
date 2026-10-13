/**
 * Escape closes the innermost open overlay. (#1288, then every overlay: #1289)
 *
 * Every dialog, panel and pop-up menu closes the same ways: a × in its fixed
 * header (DialogHeader), Escape, and, where it already does, a click outside.
 * This hook is the Escape half. An overlay calls it while open; the hook keeps
 * a stack of open overlays, and Escape dismisses the one opened last, so a
 * menu inside a dialog closes before the dialog does. No overlay handles
 * Escape on its own: docs/dialog-inventory.md lists them, and
 * dialogInventory.test.ts fails when one draws an overlay without this.
 *
 * Three things keep it from fighting the handlers that already exist:
 *
 *  - It listens in the bubble phase on `window`, the last stop a key event
 *    makes. Anything that handles Escape itself and stops the event — the
 *    shortcut recorder in Settings, a pending gesture (the "gesture.cancel"
 *    shortcut, #1263) — has already run, and Escape keeps meaning what it
 *    meant there.
 *  - It ignores an event something else has already `preventDefault`ed, for
 *    the same reason.
 *  - A dismissed overlay is popped by its own effect cleanup, so a stale entry
 *    can't swallow the next Escape.
 *
 * The stack itself (`pushDismiss`, `handleEscape`) is plain code with no React
 * in it, so useDismiss.test.ts can drive it directly.
 */

import { useEffect, useRef } from "react";

interface Entry {
  onDismiss: () => void;
}

const stack: Entry[] = [];

/** The shape of a keydown this needs: a KeyboardEvent, or a stand-in in tests. */
export interface EscapeKeyEvent {
  key: string;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** The window listener: Escape dismisses the overlay opened last, if any. */
export function handleEscape(e: EscapeKeyEvent): void {
  if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.onDismiss();
}

function listenerTarget(): Pick<Window, "addEventListener" | "removeEventListener"> | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * Register an open overlay. Returns the function that unregisters it; the
 * window listener is attached with the first entry and removed with the last.
 */
export function pushDismiss(onDismiss: () => void): () => void {
  const entry: Entry = { onDismiss };
  stack.push(entry);
  if (stack.length === 1) listenerTarget()?.addEventListener("keydown", handleEscape);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) listenerTarget()?.removeEventListener("keydown", handleEscape);
  };
}

/** How many overlays are open, for the dialog sweep test (#1289). */
export function openOverlayCount(): number {
  return stack.length;
}

/**
 * While `open`, Escape calls `onDismiss` — unless something opened later is
 * still open, in which case Escape goes to that first.
 */
export function useDismiss(open: boolean, onDismiss: () => void): void {
  // The latest callback, so a re-render with a new closure doesn't re-register.
  const latest = useRef(onDismiss);
  latest.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    return pushDismiss(() => latest.current());
  }, [open]);
}
