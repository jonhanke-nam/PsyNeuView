/**
 * Keyboard focus for dialogs (#415): into the dialog when it opens, kept
 * inside a modal one while it is open, and back to where it was when it
 * closes.
 *
 * Every dialog draws its header with DialogHeader, which calls
 * `useDialogFocus`; no dialog manages its own focus. The header finds the
 * `role="dialog"` element around it and:
 *
 *  - **On open** remembers what had the focus, then moves it in: to a control
 *    the dialog already focused itself (an `autoFocus`, a search box it
 *    focuses on mount), else one marked `data-autofocus`, else the first text
 *    field, else the dialog itself (it is labelled by its title, so a screen
 *    reader reads that). A dialog of buttons gets the focus on itself rather
 *    than on its first button, so Enter never answers a question by accident.
 *  - **While open**, if it is modal (`aria-modal="true"`), Tab and Shift+Tab
 *    cycle through its controls and never reach the page behind the scrim.
 *    Only the dialog opened last traps: a dialog over Settings has the keys,
 *    Settings gets them back when it closes. A panel that is not modal
 *    (History, Advanced Graph View Options) takes the focus but does not
 *    trap; the page beside it stays reachable.
 *  - **On close**, gives the focus back to what had it — or, if that has gone
 *    (a menu item that opened the dialog, and closed with its menu), to the
 *    most recent thing focused before it that is still there (the menu's
 *    button). It does this only when the focus would otherwise be lost: a
 *    click outside that put the focus on another control leaves it there.
 *
 * Menus (role="menu"/"listbox") do not use this: they keep their own rule,
 * listed in docs/dialog-inventory.md. Notices take no focus.
 *
 * The logic is plain code over a few DOM methods, so dialogFocus.test.ts can
 * drive it without a browser, as useDismiss.test.ts does the Escape stack.
 */

import { useEffect, type RefObject } from "react";

/** What this needs of an element. An HTMLElement, or a stand-in in tests. */
export interface FocusEl {
  focus(options?: { preventScroll?: boolean }): void;
  contains(other: FocusEl | null): boolean;
  readonly isConnected: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): FocusEl | null;
  querySelectorAll(selector: string): ArrayLike<FocusEl>;
  matches(selector: string): boolean;
  getClientRects(): { length: number };
}

/** What this needs of the document. */
export interface FocusDoc {
  readonly activeElement: FocusEl | null;
  readonly body: FocusEl | null;
}

/** Everything Tab can land on. */
export const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(", ");

/** A field the user types into: the first one is where a dialog starts. */
const TEXT_FIELD = [
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]):not([type="file"])',
  "textarea:not([disabled])",
].join(", ");

function visible(el: FocusEl): boolean {
  return el.getClientRects().length > 0 && !el.matches("[inert], [inert] *");
}

/** The controls Tab moves through inside `container`, in document order. */
export function tabbables(container: FocusEl): FocusEl[] {
  return Array.from(container.querySelectorAll(TABBABLE)).filter(visible);
}

// ── What had the focus ─────────────────────────────────────────────────────
//
// A short history of focused elements, so that when the dialog's opener has
// gone (a menu item) the focus can go to what was focused before it. Kept by
// one focusin listener on the document, for the life of the page.

const HISTORY = 20;
const history: FocusEl[] = [];

export function recordFocus(el: FocusEl | null): void {
  if (!el) return;
  const i = history.indexOf(el);
  if (i >= 0) history.splice(i, 1);
  history.push(el);
  if (history.length > HISTORY) history.shift();
}

/** For tests. */
export function clearFocusHistory(): void {
  history.length = 0;
}

if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => recordFocus(e.target as unknown as FocusEl), true);
}

// ── The open dialogs ───────────────────────────────────────────────────────

interface Open {
  container: FocusEl;
  modal: boolean;
}

/** Open dialogs, the last opened last. Only the top modal one traps Tab. */
const open: Open[] = [];

export function openDialogCount(): number {
  return open.length;
}

function topModal(): Open | undefined {
  for (let i = open.length - 1; i >= 0; i--) if (open[i].modal) return open[i];
  return undefined;
}

/** The shape of a keydown this needs: a KeyboardEvent, or a stand-in in tests. */
export interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault: () => void;
}

/**
 * The window listener: Tab at either end of the top modal dialog wraps round,
 * and Tab with the focus outside it (on the scrim, lost to the body) brings it
 * back in. Anything that already handled Tab (the shortcut recorder) wins.
 */
export function handleTab(e: TabKeyEvent, doc: FocusDoc = document as unknown as FocusDoc): void {
  if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const top = topModal();
  if (!top) return;
  const list = tabbables(top.container);
  const active = doc.activeElement;
  if (list.length === 0) {
    // Nothing to move to: stay on the dialog itself.
    e.preventDefault();
    focusDialogItself(top.container);
    return;
  }
  const at = active ? list.indexOf(active) : -1;
  const inside = !!active && top.container.contains(active);
  // Outside the dialog, or on the dialog itself: in from the near end. On
  // something inside that Tab skips (a row with tabindex -1), the browser
  // moves on by itself.
  const offList = at === -1 && (!inside || active === top.container);
  let next: FocusEl | null = null;
  if (e.shiftKey) {
    if (at === 0 || offList) next = list[list.length - 1];
  } else if (at === list.length - 1 || offList) {
    next = list[0];
  }
  if (!next) return;
  e.preventDefault();
  next.focus();
}

function listen(): Pick<Window, "addEventListener" | "removeEventListener"> | null {
  return typeof window === "undefined" ? null : window;
}

const onKeydown = (e: KeyboardEvent) => handleTab(e);

function focusDialogItself(container: FocusEl): void {
  if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
  container.focus({ preventScroll: true });
}

/** Where the focus goes when a dialog opens. */
export function initialFocus(container: FocusEl, doc: FocusDoc): FocusEl {
  const active = doc.activeElement;
  if (active && active !== container && container.contains(active)) return active;
  const marked = container.querySelector("[data-autofocus]");
  if (marked && visible(marked)) return marked;
  const field = Array.from(container.querySelectorAll(TEXT_FIELD)).find(visible);
  if (field) return field;
  return container;
}

/**
 * A dialog has opened in `container`. Moves the focus in, and traps Tab if it
 * is modal. Returns the function to call when it closes, which gives the
 * focus back.
 */
export function openDialogFocus(container: FocusEl, doc: FocusDoc = document as unknown as FocusDoc): () => void {
  const active = doc.activeElement;
  const opener = active && active !== doc.body && !container.contains(active) ? active : null;
  const entry: Open = { container, modal: container.getAttribute("aria-modal") === "true" };
  open.push(entry);
  if (open.length === 1) listen()?.addEventListener("keydown", onKeydown);

  const target = initialFocus(container, doc);
  if (target === container) focusDialogItself(container);
  else if (target !== active) target.focus();

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const i = open.indexOf(entry);
    if (i >= 0) open.splice(i, 1);
    if (open.length === 0) listen()?.removeEventListener("keydown", onKeydown);
    restoreFocus(container, opener, doc);
  };
}

/** Gives the focus back after `container` closed, if it was lost. */
export function restoreFocus(container: FocusEl, opener: FocusEl | null, doc: FocusDoc): void {
  const now = doc.activeElement;
  const lost = !now || now === doc.body || !now.isConnected || container.contains(now);
  if (!lost) return;
  // A dialog still open under this one: the focus goes back into it, never
  // to the page behind both.
  const under = topModal()?.container ?? null;
  const candidates = [opener, ...history.slice().reverse()];
  for (const el of candidates) {
    if (!el || el === doc.body || !el.isConnected || container.contains(el) || el === container) continue;
    if (under && !under.contains(el)) continue;
    if (!visible(el)) continue;
    el.focus({ preventScroll: true });
    if (doc.activeElement === el) return;
  }
  if (under) focusDialogItself(under);
}

/**
 * Focus for the dialog whose header is `headerRef`: called by DialogHeader,
 * so every dialog gets it. Runs once, when the dialog opens.
 */
export function useDialogFocus(headerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = headerRef.current?.closest('[role="dialog"]') as HTMLElement | null;
    if (!container) return;
    return openDialogFocus(container as unknown as FocusEl);
  }, [headerRef]);
}
