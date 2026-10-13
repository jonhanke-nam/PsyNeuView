/**
 * Every app-level keyboard shortcut, in one place. (#1112)
 *
 * Before this there was no system: undo listened on `window`, save was a
 * CodeMirror keymap, delete was React Flow's own handler, and Escape was six
 * separate listeners. Nothing knew what anything else had claimed, which is how
 * the Mac menu came to bind Cmd+X to "Stop Services" (PsyNeuView-MacApp#123)
 * without anyone noticing it had taken Cut.
 */

import type { Binding } from "./binding";
import { parseBinding } from "./binding";

/**
 * Where a shortcut is allowed to fire.
 *
 * This is the part that actually needs care. Typing must win almost always —
 * but not quite always, and the exception is deliberate: undo is model-wide
 * here, so it takes over Cmd+Z inside the code editor too. That asymmetry
 * existed before as a comment; now it is a property.
 */
export type Scope =
  /** Never while typing, in any field or editor. */
  | "outsideText"
  /** Also inside the code editor, but not in ordinary inputs. */
  | "codeEditorToo"
  /** Everywhere, including inputs. For Escape and the like. */
  | "always";

export interface Shortcut {
  /** Stable across renames — overrides are stored against this. */
  id: string;
  label: string;
  group: "View" | "Model" | "Run" | "Edit";
  defaultBinding: string;
  scope: Scope;
  /**
   * Set at registration; the registry is a description, not a dispatcher.
   *
   * Return `false` to **decline** the key: the shortcut matched, but had
   * nothing to do, so the event should carry on to whatever else is listening.
   * Anything else (including `undefined`) means it was handled and the event is
   * consumed.
   *
   * This exists for keys that are shared rather than owned. Escape is the case:
   * it cancels a pending gesture when there is one, and otherwise has to reach
   * the menu, popover or modal that is open — all of which handle it
   * themselves. Without a way to decline, claiming Escape here silently breaks
   * every one of them (#1263).
   */
  run?: () => boolean | void;
}

export interface ResolvedShortcut extends Shortcut {
  binding: Binding;
}

/**
 * The declared set.
 *
 * Bindings here are defaults. A user override replaces the binding but never
 * the id, so improving a default still reaches anyone who has not customised
 * that particular key.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    id: "model.save",
    label: "Save model",
    group: "Model",
    defaultBinding: "Mod+s",
    // The editor is exactly where you press Cmd+S.
    scope: "codeEditorToo",
  },
  {
    id: "history.undo",
    label: "Undo",
    group: "Edit",
    defaultBinding: "Mod+z",
    // Deliberate: PsyNeuView's undo covers source, nodes, edges and layout, so
    // it takes precedence over CodeMirror's text-only undo.
    scope: "codeEditorToo",
  },
  {
    id: "history.redo",
    label: "Redo",
    group: "Edit",
    defaultBinding: "Mod+Shift+z",
    scope: "codeEditorToo",
  },
  {
    id: "graph.deleteSelection",
    label: "Delete selected node",
    group: "Model",
    defaultBinding: "Backspace",
    // Never while typing — Backspace is Backspace in a text field.
    scope: "outsideText",
  },
  {
    id: "inspector.focus",
    label: "Show Inspector",
    group: "View",
    defaultBinding: "Mod+i",
    // Works from the code editor too — reading source is exactly when you want
    // the Inspector — but not from a rename box, where it would be a surprise.
    scope: "codeEditorToo",
  },
  {
    id: "gesture.cancel",
    label: "Cancel the current gesture",
    group: "View",
    defaultBinding: "Escape",
    // Escape closes a menu or abandons a gesture wherever you are, including
    // out of a field.
    scope: "always",
  },
];

/** Parse the declared set, applying any user overrides. */
export function resolveShortcuts(
  overrides: Record<string, string> = {},
  shortcuts: Shortcut[] = SHORTCUTS
): { resolved: ResolvedShortcut[]; errors: string[] } {
  const resolved: ResolvedShortcut[] = [];
  const errors: string[] = [];
  for (const shortcut of shortcuts) {
    const spec = overrides[shortcut.id] ?? shortcut.defaultBinding;
    const parsed = parseBinding(spec);
    if (!parsed.ok) {
      // A bad override must not take the shortcut down with it: fall back to
      // the default and say so, rather than leaving the action unreachable.
      errors.push(`${shortcut.id}: ${parsed.reason}`);
      const fallback = parseBinding(shortcut.defaultBinding);
      if (fallback.ok) resolved.push({ ...shortcut, binding: fallback.binding });
      continue;
    }
    resolved.push({ ...shortcut, binding: parsed.binding });
  }
  return { resolved, errors };
}

/**
 * Bindings claimed by more than one shortcut.
 *
 * Returned rather than thrown: the rebinding UI needs to report a conflict at
 * the moment of capture, and startup needs to not explode over a stored
 * override that has since collided with a new default.
 */
export function findConflicts(resolved: ResolvedShortcut[]): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const shortcut of resolved) {
    const key = JSON.stringify(shortcut.binding);
    const owner = seen.get(key);
    if (owner && owner !== shortcut.id) {
      conflicts.push(`${shortcut.id} and ${owner} both want ${shortcut.defaultBinding}`);
      continue;
    }
    seen.set(key, shortcut.id);
  }
  return conflicts;
}
