/**
 * Wiring the declared shortcuts to what they actually do. (#1112)
 *
 * The registry describes; this connects. Keeping them apart means the set can
 * be listed, checked for conflicts and rendered in Settings without dragging
 * every action's dependencies along with it.
 */

import { useEffect, useMemo, useState } from "react";

import { applyHistoryStep } from "@/hooks/useUndoRedo";
import type { AnyPanel } from "@/stores/layoutStore";
import { useModelStore } from "@/stores/modelStore";
import { displayBinding } from "./binding";
import { runCommand } from "./commands";
import { openShortcutsReference } from "./reference";
import { togglePanelOrExplain } from "./lastPanel";
import { OVERRIDES_CHANGED, loadOverrides } from "./storage";
import { resolveShortcuts, type ResolvedShortcut } from "./registry";
import { useShortcuts } from "./useShortcuts";

// Shows or hides one panel. The store refuses to hide the last visible one;
// the key is still consumed (the browser would otherwise take it), and the
// shared notice says why nothing moved (#213).
function togglePanel(panel: AnyPanel) {
  togglePanelOrExplain(panel);
}

/** Actions by shortcut id. Anything not listed simply does nothing. */
function buildActions(): Record<string, () => boolean | void> {
  return {
    // #191: one key per panel; the choice is stored like a Layout-menu change.
    "layout.toggleGraph": () => togglePanel("graph"),
    "layout.toggleCode": () => togglePanel("code"),
    "layout.toggleBottom": () => togglePanel("bottom"),
    "layout.togglePalette": () => togglePanel("palette"),

    "history.undo": () => void applyHistoryStep(false),
    "history.redo": () => void applyHistoryStep(true),

    // Saving belongs to the editor and deleting belongs to the canvas. Both
    // register themselves while mounted; if neither is on screen the shortcut
    // does nothing, which is the right answer.
    "model.save": () => void runCommand("model.save"),

    "graph.deleteSelection": () => {
      // The precondition lives with the action, not the registry: the registry
      // should not have to know what a selected node is.
      const { selectedNodeId, selectedEdgeId, filePath } = useModelStore.getState();
      if ((!selectedNodeId && !selectedEdgeId) || !filePath) return;
      runCommand("graph.deleteSelection");
    },

    // #289: one fit, shared with the Fit button, the canvas menu and the
    // off-screen badge. The canvas registers it; with the graph hidden there
    // is nothing to fit, so the key is declined and goes on to the browser.
    "view.fitGraph": () => runCommand("graph.fit"),
    "view.fitGraphShift": () => runCommand("graph.fit"),
    "view.actualSize": () => runCommand("graph.actualSize"),

    // #292: Help ▸ Keyboard Shortcuts.
    "help.shortcuts": () => openShortcutsReference(),
    "help.shortcutsQuestion": () => openShortcutsReference(),

    // The bottom panel is App's own state, so App registers this one.
    "inspector.focus": () => void runCommand("inspector.focus"),

    // Stop the assistant's turn (#179). Declines when no turn is running, so
    // the chord still reaches whatever else wants it.
    "assistant.stop": () => runCommand("assistant.stop"),

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

/**
 * The declared shortcuts with the user's overrides applied, kept current.
 *
 * Re-read on the custom event the Settings panel fires, so a rebinding takes
 * effect immediately rather than at the next reload. Also what a menu uses to
 * show a shortcut beside its item (#191), so the two can't disagree.
 */
export function useResolvedShortcuts(): ResolvedShortcut[] {
  const [overrides, setOverrides] = useState<Record<string, string>>(loadOverrides);
  useEffect(() => {
    const refresh = () => setOverrides(loadOverrides());
    window.addEventListener(OVERRIDES_CHANGED, refresh);
    return () => window.removeEventListener(OVERRIDES_CHANGED, refresh);
  }, []);

  return useMemo(() => {
    const { resolved, errors } = resolveShortcuts(overrides);
    if (errors.length) {
      // Loud enough to find, quiet enough not to block startup: a bad override
      // already falls back to its default, so the app still works.
      console.warn("[shortcuts] ignoring unusable bindings:", errors);
    }
    return resolved;
  }, [overrides]);
}

/**
 * The keys for one or more shortcuts as they read on this platform ("⌘9 or
 * ⇧1"), current with any rebinding. For tooltips and menu rows, so what they
 * name is always what fires (#289).
 */
export function useShortcutKeys(...ids: string[]): string {
  const resolved = useResolvedShortcuts();
  return ids
    .map((id) => resolved.find((s) => s.id === id))
    .filter((s): s is ResolvedShortcut => !!s)
    .map((s) => displayBinding(s.binding))
    .join(" or ");
}

/** Install the app's shortcuts. Call once, high in the tree. */
export function useAppShortcuts(): ResolvedShortcut[] {
  const resolved = useResolvedShortcuts();
  const shortcuts = useMemo(() => {
    const actions = buildActions();
    return resolved.map((s) => ({ ...s, run: actions[s.id] }));
  }, [resolved]);

  useShortcuts(shortcuts);
  return shortcuts;
}
