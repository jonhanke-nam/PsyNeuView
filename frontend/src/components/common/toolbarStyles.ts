/**
 * The toolbar's own controls, on the palette. (#1302)
 *
 * Not Button kinds (docs/ui-style-conventions.md, "Not a kind"): a toolbar
 * toggle is on or off rather than an action, and a menu row is a line in a
 * list. Each keeps the size it always had; what they share is here, so the
 * main toolbar, the graph toolbar and their menus draw "on" the same way.
 *
 *   toggleColours   a toolbar toggle or menu trigger: blue-tinted with a
 *                   blue edge while on (Roles, Names, Ports; Layout ▾ while
 *                   its menu is open), white with a grey edge while off.
 *   menuRowColours  a row in a toolbar menu: blue-tinted and bold while it
 *                   is the current choice (a visible panel, the running
 *                   walkthrough, a More toggle that is on).
 *   MENU_ROW_HOVER  the grey under the pointer on a row that is not current.
 */
import type { CSSProperties } from "react";

/** The colours of a toolbar toggle (or a menu's trigger), on or off. */
export function toggleColours(on: boolean): CSSProperties {
  return on
    ? { border: "1px solid var(--pnv-primary)", background: "var(--pnv-primary-tint)", color: "var(--pnv-primary)" }
    : { border: "1px solid var(--pnv-border)", background: "var(--pnv-surface)", color: "var(--pnv-text-body)" };
}

/** The colours of a row in a toolbar menu; `current` is the chosen one. */
export function menuRowColours(current: boolean): CSSProperties {
  return {
    background: current ? "var(--pnv-primary-tint)" : "transparent",
    color: current ? "var(--pnv-primary)" : "var(--pnv-text-body)",
    fontWeight: current ? 600 : 400,
  };
}

/** A menu row's background under the pointer (set on mouseenter, cleared on leave). */
export const MENU_ROW_HOVER = "var(--pnv-surface-sunken)";
