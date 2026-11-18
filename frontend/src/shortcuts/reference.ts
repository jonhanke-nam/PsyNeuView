/**
 * Help ▸ Keyboard Shortcuts: what it lists, and how it is opened. (#292)
 *
 * The page itself is components/common/KeyboardShortcutsReference.tsx; this
 * is the part worth testing without a DOM — which shortcuts differ from their
 * defaults, how the summary reads, and the keys the Mac app's own menus keep.
 */

import { displayBinding, parseBinding } from "./binding";
import { defaultBindingFor, type Platform, type ResolvedShortcut } from "./registry";

/**
 * Asks for the reference. The Mac app's Help ▸ Keyboard Shortcuts sends the
 * same event, and sets `window.__pnvOpenShortcutsRequested` too, so a request
 * made while the page is still starting is picked up when the listener
 * attaches — the way ⌘, opens Settings (utils/macAppSettings.ts).
 */
export const OPEN_SHORTCUTS_EVENT = "pnv:open-shortcuts";

type FlagWindow = Window & { __pnvOpenShortcutsRequested?: boolean };

/** Open Help ▸ Keyboard Shortcuts. */
export function openShortcutsReference(): void {
  (window as FlagWindow).__pnvOpenShortcutsRequested = true;
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
}

/** Call `open` whenever something asks for the reference. Returns the unsubscribe. */
export function onOpenShortcutsReference(open: () => void): () => void {
  const w = window as FlagWindow;
  const handle = () => {
    if (!w.__pnvOpenShortcutsRequested) return;
    w.__pnvOpenShortcutsRequested = false;
    open();
  };
  // Listener first, then the flag: a request can't fall between the two.
  window.addEventListener(OPEN_SHORTCUTS_EVENT, handle);
  handle();
  return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, handle);
}

/** One row of the reference. */
export interface ReferenceRow {
  id: string;
  label: string;
  group: string;
  /** The key as it is now, this platform's way. */
  keys: string;
  /** The default, this platform's way. */
  defaultKeys: string;
  /** Rebound in Settings. */
  changed: boolean;
}

/** The registry's shortcuts as rows, marking any the user has rebound. */
export function referenceRows(
  resolved: ResolvedShortcut[],
  overrides: Record<string, string>,
  mac: boolean
): ReferenceRow[] {
  const platform: Platform = mac ? "mac" : "other";
  return resolved.map((s) => {
    const keys = displayBinding(s.binding, mac);
    const parsedDefault = parseBinding(defaultBindingFor(s, platform));
    const defaultKeys = parsedDefault.ok ? displayBinding(parsedDefault.binding, mac) : keys;
    return {
      id: s.id,
      label: s.label,
      group: s.group,
      keys,
      defaultKeys,
      // An override that happens to equal the default is not a change.
      changed: s.id in overrides && keys !== defaultKeys,
    };
  });
}

/** "2 shortcuts changed from the defaults", or null when none are. */
export function changedSummary(rows: ReferenceRow[]): string | null {
  const n = rows.filter((r) => r.changed).length;
  if (n === 0) return null;
  return `${n} shortcut${n === 1 ? "" : "s"} changed from the defaults`;
}

/** Whether a row matches the search box: its action, its keys, or its group. */
export function rowMatches(row: { label: string; keys: string; group: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.label, row.keys, row.group].some((s) => s.toLowerCase().includes(q));
}

/**
 * Keys the Mac app's native menus own, listed read-only and marked "set by
 * macOS" (#292). The menu matches these before the page sees the key, so they
 * cannot be rebound here. Kept in step with PsyNeuView-MacApp's
 * MenuShortcuts.swift; docs/keyboard-shortcuts.md lists them too.
 *
 * View ▸ Actual Size takes ⌘0 for the whole window's zoom, so inside the Mac
 * app the graph's own ⌘0 (#289) does not reach the page. Whether to move one
 * of them is an open decision; until then the reference says which one wins.
 */
export const MAC_APP_MENU_KEYS: { menu: string; label: string; keys: string; note?: string }[] = [
  { menu: "PsyNeuView", label: "Settings…", keys: "⌘,", note: "opens this app's Settings" },
  { menu: "PsyNeuView", label: "Quit PsyNeuView", keys: "⌘Q" },
  { menu: "File", label: "New Window", keys: "⌘N" },
  { menu: "File", label: "Close Window", keys: "⌘W" },
  { menu: "Edit", label: "Cut", keys: "⌘X" },
  { menu: "Edit", label: "Copy", keys: "⌘C" },
  { menu: "Edit", label: "Paste", keys: "⌘V" },
  { menu: "Edit", label: "Select All", keys: "⌘A" },
  { menu: "View", label: "Actual Size (the whole window)", keys: "⌘0", note: "takes ⌘0 before the graph sees it" },
  { menu: "View", label: "Zoom In (the whole window)", keys: "⌘+" },
  { menu: "View", label: "Zoom Out (the whole window)", keys: "⌘-" },
  { menu: "Services", label: "Start Services", keys: "⌃⌘S" },
  { menu: "Services", label: "Restart Services", keys: "⌃⌘R" },
  { menu: "Development", label: "Switch Branch…", keys: "⌘B" },
  { menu: "Development", label: "View Logs", keys: "⌘L" },
  { menu: "Window", label: "Minimize", keys: "⌘M" },
];
