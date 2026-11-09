/**
 * Shaping an arrow by hand, as a step of its own (#164).
 *
 * Bending an arrow, moving one of its ends, or putting its route back is the
 * user's arrangement, like moving a node:
 *
 *  - In Layout: Auto it takes the layout to Custom (shaping belongs to a
 *    custom layout, #41), rather than panning the canvas. No node moves: the
 *    layout keeps what is on screen.
 *  - It is saved to the model's layout file on its own, under the view it was
 *    made in (nested, or flattened and PyTorch), without waiting for a node
 *    to move.
 *  - It is one History step, named, that Undo takes back.
 *
 * The edge component reports the gesture; the canvas, which holds the nodes
 * as they are on screen and the save, registers what is done with it.
 */

import { useModelStore, usesFlatPositions } from "@/stores/modelStore";
import { useEdgeAttach } from "@/stores/edgeAttachStore";
import {
  hydrateRoutes,
  sameRoutes,
  serializeRoutes,
  type EdgeRouteMap,
  type RoutableEdge,
} from "@/utils/edgeRoutes";

type Commit = (description: string) => void;
let commit: Commit | null = null;

/** The canvas says what a finished reshape does. Returns the unregister. */
export function registerArrowShapeCommit(fn: Commit): () => void {
  commit = fn;
  return () => {
    if (commit === fn) commit = null;
  };
}

/**
 * A gesture on an arrow has started to move it. In Auto, the layout becomes
 * Custom where it stands; nothing is laid out again.
 */
export function startShapingArrow(): void {
  const store = useModelStore.getState();
  if (store.autoLayout) store.setAutoLayout(false);
}

/** A reshape is done: record it in History and save it. */
export function arrowShaped(description: string): void {
  commit?.(description);
}

/** History's name for a reshape of the arrow called `name`. */
export function reshapeDescription(name: string, what: "reshaped" | "reset" = "reshaped"): string {
  return what === "reset" ? `Reset the route of arrow ${name}` : `Reshaped arrow ${name}`;
}

/** The arrows shaped by hand now, as the layout file keeps them. */
export function currentRoutes(): EdgeRouteMap {
  const ea = useEdgeAttach.getState();
  return serializeRoutes(
    useModelStore.getState().edges as unknown as RoutableEdge[],
    ea.shaped,
    ea.waypoints,
    ea.overrides,
  );
}

/**
 * Undo or redo reached a step whose arrows are shaped otherwise: put them
 * back, and save them under the current view's key, as a reshape is saved.
 * Returns whether anything changed.
 */
export function restoreRoutes(routes: EdgeRouteMap, filePath: string | null): boolean {
  if (sameRoutes(currentRoutes(), routes)) return false;
  useEdgeAttach
    .getState()
    .hydrate(hydrateRoutes(useModelStore.getState().edges as unknown as RoutableEdge[], routes));
  if (filePath) {
    void fetch("/api/model/save-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        usesFlatPositions()
          ? { file_path: filePath, flatEdgeRoutes: routes }
          : { file_path: filePath, edgeRoutes: routes },
      ),
    }).catch(() => {});
  }
  return true;
}
