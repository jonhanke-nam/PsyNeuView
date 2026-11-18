/**
 * Why the last visible panel can't be hidden, said the same way everywhere (#213).
 *
 * PsyNeuView keeps at least one of the graph, the code editor and the
 * Inspector panel on screen (see `layoutStore`). The store just refuses; this
 * is the one place that explains the refusal, so the keyboard shortcuts, the
 * Layout menu and the bottom panel's collapse button all say the same thing.
 *
 * The notice names the panel that stays and the two that could replace it,
 * with their real keys: read from the shortcut registry with the person's own
 * rebindings applied, so a changed key shows up here too.
 *
 * With Settings ▸ Appearance ▸ Allow a blank screen on (#215) the store never
 * refuses, so none of this runs; layout/BlankScreen.tsx is the hint then.
 */

import { useLayoutStore, type AnyPanel, type LayoutPanel } from "@/stores/layoutStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { displayBinding } from "./binding";
import { resolveShortcuts } from "./registry";
import { loadOverrides } from "./storage";

/** One notice at a time: a repeated try restarts the same notice, never stacks a second one. */
export const LAST_PANEL_NOTICE_KEY = "layout.lastPanel";

/** Long enough to read two sentences (#213); other info notices scale with length up to 8s. */
export const LAST_PANEL_NOTICE_MS = 6000;

const PANEL_NAMES: Record<LayoutPanel, string> = {
  graph: "the graph",
  code: "the code editor",
  bottom: "the Inspector panel",
};

const SHORTCUT_IDS: Record<LayoutPanel, string> = {
  graph: "layout.toggleGraph",
  code: "layout.toggleCode",
  bottom: "layout.toggleBottom",
};

const ALL_PANELS: LayoutPanel[] = ["graph", "code", "bottom"];

/** Each panel's shortcut as it reads on this platform, with rebindings applied. */
export function panelKeys(): Record<LayoutPanel, string> {
  const { resolved } = resolveShortcuts(loadOverrides());
  const keys = {} as Record<LayoutPanel, string>;
  for (const panel of ALL_PANELS) {
    const s = resolved.find((x) => x.id === SHORTCUT_IDS[panel]);
    keys[panel] = s ? displayBinding(s.binding) : "";
  }
  return keys;
}

/**
 * The message for refusing to hide `panel`, the last one showing. Plain
 * English: why nothing happened, and what to do instead.
 */
export function lastPanelMessage(panel: LayoutPanel, keys: Record<LayoutPanel, string> = panelKeys()): string {
  const others = ALL_PANELS.filter((p) => p !== panel).map((p) =>
    keys[p] ? `${PANEL_NAMES[p]} (${keys[p]})` : PANEL_NAMES[p],
  );
  return (
    `One panel has to stay open, so PsyNeuView can't hide ${PANEL_NAMES[panel]}. ` +
    `Show ${others[0]} or ${others[1]} first, with its key or from the Layout menu.`
  );
}

/** Tell the person why `panel` stayed on screen. */
export function explainLastPanel(panel: LayoutPanel): void {
  useNotificationStore.getState().addNotification("info", lastPanelMessage(panel), {
    durationMs: LAST_PANEL_NOTICE_MS,
    key: LAST_PANEL_NOTICE_KEY,
  });
}

/**
 * Show or hide a panel; when the store refuses because it is the last one
 * showing, say why. Returns whether anything changed.
 */
export function setPanelVisibleOrExplain(panel: LayoutPanel, visible: boolean): boolean {
  if (useLayoutStore.getState().setPanelVisible(panel, visible)) return true;
  explainLastPanel(panel);
  return false;
}

/** Toggle a panel, explaining a refusal. The Components panel never refuses. */
export function togglePanelOrExplain(panel: AnyPanel): boolean {
  if (useLayoutStore.getState().togglePanel(panel)) return true;
  if (panel !== "palette") explainLastPanel(panel);
  return false;
}
