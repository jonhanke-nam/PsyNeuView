/**
 * The one listener. (#1112)
 *
 * Replaces four independent handlers that each guessed at the same questions.
 * Registered in capture phase so it sees an event before CodeMirror's own
 * keymap, which is what lets the model-wide undo take precedence over the
 * editor's text undo.
 */

import { useEffect } from "react";

import { record } from "@/utils/activityLog";
import { isMac, matchesEvent } from "./binding";
import type { ResolvedShortcut } from "./registry";
import { allowedInTarget, classifyTarget } from "./target";

export function useShortcuts(shortcuts: ResolvedShortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A keystroke that is still composing a character (any dead key, any IME)
      // is not a shortcut. Without this, typing an accented character can fire
      // one.
      if (e.isComposing) return;

      const mac = isMac();
      const target = classifyTarget(e.target);
      for (const shortcut of shortcuts) {
        if (!matchesEvent(shortcut.binding, e, mac)) continue;
        if (!allowedInTarget(shortcut.scope, target)) continue;
        if (!shortcut.run) continue;
        // Run before consuming. A shortcut that matched may still decline the
        // key (returning false) when it has nothing to do, and the event then
        // has to continue to whatever else is listening — otherwise claiming a
        // shared key here silently disables every other handler for it (#1263).
        if (shortcut.run() === false) continue;
        // A shortcut that did something is a command, for the activity log (#1287).
        record("menu", `Shortcut: ${shortcut.label}`, { id: shortcut.id, shortcut: true });
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [shortcuts]);
}
