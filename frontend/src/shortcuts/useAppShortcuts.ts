/**
 * Wiring the declared shortcuts to what they actually do. (#1112)
 *
 * The registry describes; this connects. Keeping them apart means the set can
 * be listed, checked for conflicts and rendered in Settings without dragging
 * every action's dependencies along with it.
 */

import { useEffect, useMemo, useState } from "react";

import { applyHistoryStep } from "@/hooks/useUndoRedo";
import { useModelStore } from "@/stores/modelStore";
import { runCommand } from "./commands";
import { OVERRIDES_CHANGED, loadOverrides } from "./storage";
import { resolveShortcuts, type ResolvedShortcut } from "./registry";
import { useShortcuts } from "./useShortcuts";

/** Actions by shortcut id. Anything not listed simply does nothing. */
function buildActions(): Record<string, () => void> {
  return {
    "history.undo": () => void applyHistoryStep(false),
    "history.redo": () => void applyHistoryStep(true),

    // Saving belongs to the editor and deleting belongs to the canvas. Both
    // register themselves while mounted; if neither is on screen the shortcut
    // does nothing, which is the right answer.
    "model.save": () => void runCommand("model.save"),

    "graph.deleteSelection": () => {
      // The precondition lives with the action, not the registry: the registry
      // should not have to know what a selected node is.
      const { selectedNodeId, filePath } = useModelStore.getState();
      if (!selectedNodeId || !filePath) return;
      runCommand("graph.deleteSelection");
    },

    // The bottom panel is App's own state, so App registers this one.
    "inspector.focus": () => void runCommand("inspector.focus"),

    "gesture.cancel": () => {
      const store = useModelStore.getState();
      const pending =
        store.pendingConditionGesture !== null || store.pendingProjectionGesture !== null;
      // Nothing to abandon: decline, so Escape still reaches the menu, popover
      // or modal that is open. Those handle Escape themselves, and consuming it
      // here would mean nothing on screen could be dismissed (#1263).
      if (!pending) return false;
      store.setPendingConditionGesture(null);
      store.setPendingProjectionGesture(null);
      return true;
    },
  };
}

/** Install the app's shortcuts. Call once, high in the tree. */
export function useAppShortcuts(): ResolvedShortcut[] {
  // Re-read on the custom event the Settings panel fires, so a rebinding takes
  // effect immediately rather than at the next reload.
  const [overrides, setOverrides] = useState<Record<string, string>>(loadOverrides);
  useEffect(() => {
    const refresh = () => setOverrides(loadOverrides());
    window.addEventListener(OVERRIDES_CHANGED, refresh);
    return () => window.removeEventListener(OVERRIDES_CHANGED, refresh);
  }, []);

  const shortcuts = useMemo(() => {
    const actions = buildActions();
    const { resolved, errors } = resolveShortcuts(overrides);
    if (errors.length) {
      // Loud enough to find, quiet enough not to block startup: a bad override
      // already falls back to its default, so the app still works.
      console.warn("[shortcuts] ignoring unusable bindings:", errors);
    }
    return resolved.map((s) => ({ ...s, run: actions[s.id] }));
  }, [overrides]);

  useShortcuts(shortcuts);
  return shortcuts;
}
