/**
 * One click listener for the whole page (#177): a button, a tab or a menu
 * item pressed anywhere goes in the activity log, without a call at each of
 * the hundreds of places a button is made. Installed once by
 * `installDiagnostics` (utils/diagnostics.ts), in the capture phase, so it
 * sees the click before anything handles it or re-renders the target away.
 *
 * What is recorded is the control's label — its `aria-label`, its text, or
 * its `title` when the text is only a symbol (↩, ⚙) — and where it is: the
 * nearest ancestor marked `data-pnv-menu="Open"` (a menu; the entry is a
 * `menu`, "Open › Open from path…") or `data-pnv-where="Toolbar"` (an area;
 * the entry is a `click`, "Toolbar › Save"). A control nowhere marked is
 * recorded by its label alone.
 *
 * Never recorded: text typed into a field (an input is not a control here;
 * a change to a setting is recorded by its store), a model's source, or a
 * file's contents. A label is a name or a verb, which the log may hold.
 * Nor the button that opens a menu (`aria-haspopup="menu"`): the menu
 * records its own opening, and one click shouldn't be two entries.
 */

import { record } from "./activityLog";

/** What counts as a control. */
const CLICKABLE = "button, [role='menuitem'], [role='tab'], [role='button'], a[href], summary";
const MARKED = "[data-pnv-menu], [data-pnv-where]";
const MAX_LABEL = 80;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function collapse(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/** A control's label, or "" when it has none worth recording. */
export function clickLabel(item: Element): string {
  const aria = collapse(item.getAttribute("aria-label"));
  if (aria) return aria.slice(0, MAX_LABEL);
  const text = collapse(item.textContent);
  const title = collapse(item.getAttribute("title"));
  // "↩" says nothing; its tooltip "Undo: Moved node a (⌘Z)" does.
  const label = LETTER_OR_DIGIT.test(text) ? text : title || text;
  return label.slice(0, MAX_LABEL);
}

export interface ClickDescription {
  kind: "menu" | "click";
  /** "Open › Open from path…", "Toolbar › Save", or the label alone. */
  text: string;
  where: string | null;
  label: string;
}

/** What a click on `target` is, or null when it isn't on a control. */
export function describeClick(target: EventTarget | null): ClickDescription | null {
  const el = target as Element | null;
  const item = el?.closest?.(CLICKABLE) ?? null;
  if (!item || item.getAttribute("aria-haspopup") === "menu") return null;
  const label = clickLabel(item);
  if (!label) return null;
  const marked = item.closest(MARKED);
  const menu = marked?.getAttribute("data-pnv-menu") || null;
  const where = menu ?? (marked?.getAttribute("data-pnv-where") || null);
  return { kind: menu ? "menu" : "click", text: where ? `${where} › ${label}` : label, where, label };
}

/** Record the click `e` is, if it is on a control. */
export function recordClick(e: { target: EventTarget | null }): void {
  const d = describeClick(e.target);
  if (d) record(d.kind, d.text, d.where ? { where: d.where } : undefined);
}

/** Listen for every click on `root`, in the capture phase. Returns the uninstall. */
export function installClickLogging(root: Pick<Document, "addEventListener" | "removeEventListener"> = document): () => void {
  const listener = (e: Event) => recordClick(e);
  root.addEventListener("click", listener, true);
  return () => root.removeEventListener("click", listener, true);
}
