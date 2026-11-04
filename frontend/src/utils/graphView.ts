/**
 * The view the graph is built in, as one value (#194).
 *
 * Which of the three views is showing (nested, flattened, PyTorch), which
 * composition has been entered, which are folded and which are insets. The
 * frame buttons change it and rebuild the graph; a rebuild that fails puts it
 * back; and a History step records it, so that undoing a frame button returns
 * to the view the step was made in, not just its nodes.
 */

import { useModelStore } from "@/stores/modelStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";
import { errorDetail } from "@/utils/errorDetail";

// Which of the three graph views is showing (#717): a frame button's reload
// has to carry the same flags as any other reload, or the canvas silently
// changes view (#194).
export interface ViewFlags {
  flat: boolean;
  pytorch: boolean;
}

/** Everything that decides how the open model is drawn. */
export interface GraphView extends ViewFlags {
  collapsed: string[];
  inset: string[];
  focused: string | null;
  viewBeforeEntering: ViewFlags | null;
}

// The view (flattened or PyTorch) that was showing when a composition was
// entered, so leaving it returns there. Entering shows the composition on its
// own in the nested view (the flattened views have no such thing as a single
// composition), and the view menu says so while it lasts.
let viewBeforeEntering: ViewFlags | null = null;

export function getViewBeforeEntering(): ViewFlags | null {
  return viewBeforeEntering;
}

export function setViewBeforeEntering(view: ViewFlags | null): void {
  viewBeforeEntering = view;
}

/** The view as it stands now. */
export function captureView(): GraphView {
  const gs = useGraphSettings.getState();
  return {
    flat: gs.flat,
    pytorch: gs.pytorch,
    collapsed: [...gs.collapsedCompositions].sort(),
    inset: [...gs.insetCompositions].sort(),
    focused: useModelStore.getState().focusedComposition,
    viewBeforeEntering,
  };
}

/** Put the settings back to `view`. The graph is not rebuilt here. */
export function applyView(view: GraphView): void {
  useGraphSettings.setState({
    flat: view.flat,
    pytorch: view.pytorch,
    collapsedCompositions: new Set(view.collapsed),
    insetCompositions: new Set(view.inset),
  });
  useModelStore.getState().setFocusedComposition(view.focused);
  viewBeforeEntering = view.viewBeforeEntering;
}

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Whether two views draw the model the same way. */
export function sameView(a: GraphView, b: GraphView): boolean {
  return (
    a.flat === b.flat &&
    a.pytorch === b.pytorch &&
    a.focused === b.focused &&
    sameNames(a.collapsed, b.collapsed) &&
    sameNames(a.inset, b.inset)
  );
}

// Rebuild the graph from the open file with the view settings as they now
// stand. modelStore reads collapsedCompositions, insetCompositions and
// focusedComposition at dispatch time, so flipping them isn't enough — the
// graph has to be rebuilt, and refetching /api/model/load is the cheapest way
// to do that today without caching raw modelData in the store. Returns null
// when the graph was rebuilt, else the reason it wasn't.
export async function rebuildGraph(): Promise<string | null> {
  const { filePath, setSource, loadModelFromServer } = useModelStore.getState();
  if (!filePath) return null;
  const gs = useGraphSettings.getState();
  try {
    const resp = await fetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath,
        flat: gs.flat,
        pytorch: gs.pytorch,
        ...showGraphLoadRequest(),
      }),
    });
    if (!resp.ok) return await errorDetail(resp);
    const data = await resp.json();
    setSource(data.source);
    // The labels, bundle and sidecars too: leaving them out clears the
    // sidecar's port labels on every rebuild (#611).
    loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
    return null;
  } catch (e) {
    return (e as Error).message || "the server could not be reached";
  }
}
