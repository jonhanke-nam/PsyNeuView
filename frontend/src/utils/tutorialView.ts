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
 * The nested and PyTorch views, and what the graph shows (the controller,
 * learning, the interface mechanisms, inactive nodes), change what the server
 * sends, so they take effect when the walkthrough opens its model
 * (`applyTutorialViewModes`), never under a model already on screen.
 *
 * A walkthrough opens in the view it was written for (#428): its `view:`
 * (nested, flattened or PyTorch) and any `compositions:` it folds or opens.
 * One that opens no model on start (it builds one, or a step teaches opening
 * it) switches the model on screen to that view as it starts, drawing it
 * again, unless the model has unsaved changes.
 */

import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import type { Walkthrough } from "@/utils/tourStep";

/** What a walkthrough says about its view (#428). */
export type TutorialViewSpec = Pick<Walkthrough, "view" | "compositions"> | null | undefined;

/** The flat and PyTorch settings for a walkthrough's view; none when it names none. */
export function viewModesFor(spec: TutorialViewSpec): { flat: boolean; pytorch: boolean } | null {
  switch (spec?.view) {
    case "nested":
      return { flat: false, pytorch: false };
    case "flattened":
      return { flat: true, pytorch: false };
    case "pytorch":
      return { flat: false, pytorch: true };
    default:
      return null;
  }
}

/** The server-drawn view settings that decide between the nested, flattened and PyTorch graphs. */
export interface DrawnModes {
  flat: boolean;
  pytorch: boolean;
  showCIMs: boolean;
}

/** What of the model on screen decides whether two views draw it differently. */
export interface ModelShape {
  compositionOptions: { nested: boolean }[];
  compositionMeta: Record<string, { isAutodiff: boolean }>;
  /**
   * The graph drawn now. The flattened view lists no nested compositions in
   * the view menu, so a composition's frame or folded node is what shows one.
   */
  nodes: { type?: string; data?: unknown }[];
}

/**
 * Whether two views draw this model as the same graph, so switching between
 * them needs no redraw (#428; performance is a requirement). Flattened and
 * nested differ only with a nested composition, more than one composition, or
 * the interface mechanisms shown (the flattened view has none). PyTorch
 * differs only for an AutodiffComposition; elsewhere the server ignores it.
 */
export function viewsDrawAlike(a: DrawnModes, b: DrawnModes, model: ModelShape): boolean {
  if (a.showCIMs !== b.showCIMs) return false;
  const compositionDrawn = model.nodes.some(
    (n) => n.type === "compositionNode" || (n.data as { type?: string } | undefined)?.type === "Composition",
  );
  const nestedMatters =
    compositionDrawn ||
    model.compositionOptions.some((o) => o.nested) ||
    model.compositionOptions.length > 1 ||
    a.showCIMs;
  const autodiff = Object.values(model.compositionMeta).some((m) => m.isAutodiff);
  const drawn = (m: DrawnModes) => (m.pytorch && autodiff ? "pytorch" : m.flat && nestedMatters ? "flat" : "nested");
  return drawn(a) === drawn(b);
}

function drawnModes(from: Record<string, unknown>): DrawnModes {
  return { flat: !!from.flat, pytorch: !!from.pytorch, showCIMs: !!from.showCIMs };
}

/** Fold or open the compositions the walkthrough names, before its model draws (#428). */
function applyFolds(spec: TutorialViewSpec): void {
  const wanted = Object.entries(spec?.compositions ?? {});
  if (wanted.length === 0) return;
  const gs = useGraphSettings.getState();
  const collapsed = new Set(gs.collapsedCompositions);
  const inset = new Set(gs.insetCompositions);
  // Marked seen, so the nested view's fold-on-first-sight (#395) leaves them be.
  const seeded = new Set(gs.seededCollapseDefaults);
  for (const [name, fold] of wanted) {
    seeded.add(name);
    if (fold === "folded") {
      collapsed.add(name);
      inset.delete(name);
    } else {
      collapsed.delete(name);
    }
  }
  useGraphSettings.setState({ collapsedCompositions: collapsed, insetCompositions: inset, seededCollapseDefaults: seeded });
}

/** View choices that apply as they change, without reloading the model. */
export const LIVE_VIEW_KEYS = [
  "showExecutionOrder",
  "showNodeNames",
  "showFullTypes",
  "showProjectionLabels",
  "showArrowheads",
  "showDimensions",
  "colorByRole",
  "direction",
  "expandedNodes",
  "collapsedCompositions",
  "insetCompositions",
] as const;

/**
 * View choices the server draws for (the nested and PyTorch views, and what
 * the graph shows): they take effect on the next load.
 */
export const MODE_VIEW_KEYS = ["flat", "pytorch", "showController", "showLearning", "showCIMs", "showInactive"] as const;

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

/**
 * A walkthrough is starting: remember the view, and show the graph as a fresh
 * window does, in the walkthrough's own view (#428).
 *
 * `opensOnStart`: the walkthrough opens its own model now, which applies its
 * view as it loads. Otherwise the model on screen is drawn again in that view.
 */
export function applyTutorialView(spec?: TutorialViewSpec, { opensOnStart = false }: { opensOnStart?: boolean } = {}): void {
  // The walkthrough may have opened its model (and so remembered the modes) first.
  if (before === null) before = {};
  if (!(LIVE_VIEW_KEYS[0] in before)) Object.assign(before, pick(LIVE_VIEW_KEYS, now()));
  useGraphSettings.setState(pick(LIVE_VIEW_KEYS, initial()) as never);
  // A collapsed composition is re-seeded from its default on the next load.
  useGraphSettings.getState().resetCollapseSeed();
  applyFolds(spec);

  const modes = viewModesFor(spec);
  if (!modes || opensOnStart) return;
  const g = useGraphSettings.getState();
  if (g.flat === modes.flat && g.pytorch === modes.pytorch) return;
  const model = useModelStore.getState();
  const { filePath, source, savedSource } = model;
  // The same graph either way: the setting changes, and nothing is redrawn.
  const alike = viewsDrawAlike(drawnModes(now()), { ...drawnModes(now()), ...modes }, model);
  if (alike) {
    if (!(MODE_VIEW_KEYS[0] in before)) Object.assign(before, pick(MODE_VIEW_KEYS, now()));
    useGraphSettings.setState(modes);
    return;
  }
  // Drawn again only without unsaved changes, as on the way back: the view
  // menu must say how the model on screen is drawn.
  if (filePath && source !== savedSource) return;
  if (!(MODE_VIEW_KEYS[0] in before)) Object.assign(before, pick(MODE_VIEW_KEYS, now()));
  useGraphSettings.setState(modes);
  const reload = useCatalogOpener.getState().reloadView;
  if (filePath && reload) void reload();
}

/**
 * The walkthrough is opening its own model: the view choices the server draws
 * for as a fresh window has them, for this load and the rest of the walkthrough.
 */
export function applyTutorialViewModes(spec?: TutorialViewSpec): void {
  if (before === null) before = {};
  if (!(MODE_VIEW_KEYS[0] in before)) Object.assign(before, pick(MODE_VIEW_KEYS, now()));
  useGraphSettings.setState(pick(MODE_VIEW_KEYS, initial()) as never);
  // The view it was written for, not a fresh window's (#428).
  const modes = viewModesFor(spec);
  if (modes) useGraphSettings.setState(modes);
  applyFolds(spec);
}

/**
 * The walkthrough ended: the learner's view comes back. The choices the server
 * draws for need the model drawn again, so the open file is reloaded, unless
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
  const model = useModelStore.getState();
  const { filePath, source, savedSource } = model;
  // Only the view changes back, and it draws this model the same: no redraw (#428).
  const onlyView = modes.every((k) => k === "flat" || k === "pytorch");
  if (onlyView && viewsDrawAlike(drawnModes(now()), drawnModes({ ...now(), ...pick(modes, saved) }), model)) {
    useGraphSettings.setState(pick(modes, saved) as never);
    return;
  }
  const reload = useCatalogOpener.getState().reloadView;
  if (filePath && source !== savedSource) return;
  useGraphSettings.setState(pick(modes, saved) as never);
  if (filePath && reload) void reload();
}

/** For tests: forget any remembered view. */
export function resetTutorialViewForTests(): void {
  before = null;
}
