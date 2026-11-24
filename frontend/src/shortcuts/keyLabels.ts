/**
 * Key names for text the UI shows, this platform's way (#409).
 *
 * A shortcut from the registry reads through `useShortcutKeys`, which follows
 * any rebinding. These are for the rest: a key named in a sentence that is not
 * a registered shortcut (window zoom, Option-click), and walkthrough text that
 * names a registered shortcut by its id. Hard-coding "⌘Z" or "Option-drag"
 * showed Mac keys to Windows and Linux users, and "Ctrl+S" showed the wrong
 * key on a Mac.
 */

import { displayBinding, isMac } from "./binding";
import type { ResolvedShortcut } from "./registry";

/** Cmd (Ctrl off the Mac) plus a key: "⌘Z" on a Mac, "Ctrl+Z" elsewhere. */
export function modLabel(key: string, mac: boolean = isMac()): string {
  return displayBinding({ mod: true, alt: false, shift: false, option: false, key: key.toLowerCase() }, mac);
}

/** The Option key's name: "Option" on a Mac, "Alt" elsewhere. Same key, same `altKey`. */
export function optionKeyName(mac: boolean = isMac()): string {
  return mac ? "Option" : "Alt";
}

/**
 * The window's own zoom keys: "⌘+ / ⌘−" on a Mac, "Ctrl+Plus / Ctrl+Minus"
 * elsewhere (where "Ctrl++" would read as a typo).
 */
export function windowZoomKeys(mac: boolean = isMac()): string {
  return mac ? "⌘+ / ⌘−" : "Ctrl+Plus / Ctrl+Minus";
}

/**
 * Fill `{key:<shortcut id>}` in walkthrough text with that shortcut's key as
 * it is now, this platform's way: "Press Undo (or {key:history.undo})" reads
 * "(or ⌘Z)" on a Mac and "(or Ctrl+Z)" elsewhere. An unknown id is left as
 * written, so a typo shows rather than vanishing.
 */
export function fillShortcutKeys(text: string, resolved: ResolvedShortcut[], mac: boolean = isMac()): string {
  return text.replace(/\{key:([\w.]+)\}/g, (whole, id: string) => {
    const s = resolved.find((r) => r.id === id);
    return s ? displayBinding(s.binding, mac) : whole;
  });
}
