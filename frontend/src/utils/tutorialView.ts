/**
 * Known graph view settings while a walkthrough runs, and the learner's own
 * back afterwards (#172).
 *
 * A walkthrough's steps were written against the graph as it opens. Leftover
 * view choices from earlier in the session (the controller hidden, a
 * composition collapsed, the graph drawn left to right, the PyTorch view) can
 * hide a step's node or push it off-screen. So a walkthrough starts with the
 * view as a fresh window has it, and the learner's choices come back when it
 * ends, finished or not.
 *
 * Only this window's in-memory view is touched: nothing here is written to
 * storage, so a second window (or a reload) starts from its own defaults.
 * Choices made in Settings (the automatic layout, port dots) are the
 * learner's preferences, not leftovers, and are left alone.
 *
 * The nested and PyTorch views change what the server sends, so they take
 * effect when the walkthrough opens its model (`applyTutorialViewModes`),
 * never under a model already on screen.
 */

import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { useCatalogOpener } from "@/stores/catalogOpenerStore";

/** View choices that apply as they change, without reloading the model. */
export const LIVE_VIEW_KEYS = [
  "showController",
  "showLearning",
  "showInactive",
  "showCIMs",
  "showExecutionOrder",
  "showNodeNames",
  "showProjectionLabels",
  "showDimensions",
  "colorByRole",
  "direction",
  "expandedNodes",
  "collapsedCompositions",
  "insetCompositions",
] as const;

/** View choices the server draws for: they take effect on the next load. */
export const MODE_VIEW_KEYS = ["flat", "pytorch"] as const;

type ViewKey = (typeof LIVE_VIEW_KEYS)[number] | (typeof MODE_VIEW_KEYS)[number];
type ViewState = Partial<Record<ViewKey, unknown>>;

/** The learner's view from before the walkthrough, while one runs. */
let before: ViewState | null = null;

function pick(keys: readonly ViewKey[], from: Record<string, unknown>): ViewState {
  const out: ViewState = {};
  for (const k of keys) {
    const v = from[k];
    out[k] = v instanceof Set ? new Set(v) : v;
  }
  return out;
}

function initial(): Record<string, unknown> {
  return useGraphSettings.getInitialState() as unknown as Record<string, unknown>;
}

function now(): Record<string, unknown> {
  return useGraphSettings.getState() as unknown as Record<string, unknown>;
}

/** A walkthrough is starting: remember the view, and show the graph as a fresh window does. */
export function applyTutorialView(): void {
  if (before === null) before = pick(LIVE_VIEW_KEYS, now());
  useGraphSettings.setState(pick(LIVE_VIEW_KEYS, initial()) as never);
  // A collapsed composition is re-seeded from its default on the next load.
  useGraphSettings.getState().resetCollapseSeed();
}

/**
 * The walkthrough is opening its own model: the nested and PyTorch views as a
 * fresh window has them, for this load and the rest of the walkthrough.
 */
export function applyTutorialViewModes(): void {
  if (before === null) before = {};
  if (!(MODE_VIEW_KEYS[0] in before)) Object.assign(before, pick(MODE_VIEW_KEYS, now()));
  useGraphSettings.setState(pick(MODE_VIEW_KEYS, initial()) as never);
}

/**
 * The walkthrough ended: the learner's view comes back. The nested and PyTorch
 * views need the model drawn again, so the open file is reloaded in them, unless
 * it has unsaved changes (a reload would ask about them) or another
 * walkthrough is starting and opens its own. Then those two stay as they are,
 * which is still how the model on screen is drawn.
 */
export function restoreTutorialView({ anotherStarting = false }: { anotherStarting?: boolean } = {}): void {
  if (before === null) return;
  const saved = before;
  before = null;
  const live: ViewState = {};
  for (const k of LIVE_VIEW_KEYS) if (k in saved) live[k] = saved[k];
  useGraphSettings.setState(live as never);

  const modes = MODE_VIEW_KEYS.filter((k) => k in saved && saved[k] !== now()[k]);
  if (modes.length === 0 || anotherStarting) return;
  const { filePath, source, savedSource } = useModelStore.getState();
  const reload = useCatalogOpener.getState().reloadView;
  if (filePath && source !== savedSource) return;
  useGraphSettings.setState(pick(modes, saved) as never);
  if (filePath && reload) void reload();
}

/** For tests: forget any remembered view. */
export function resetTutorialViewForTests(): void {
  before = null;
}
