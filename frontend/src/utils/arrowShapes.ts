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
 *  - It is one History step, named, that Undo takes back. Undo also puts the
 *    layout back to Auto when the reshape took it to Custom.
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

/** What the canvas does when an arrow starts to move, and once it is shaped. */
export interface ArrowShapeCommit {
  /**
   * Before anything changes: History's last step must hold the nodes where
   * they are on screen, so that undoing the reshape moves no node. (A layout
   * fitted after a load, or a node moved by hand, may not be in it yet.)
   */
  before: () => void;
  /**
   * The reshape is done: one named History step, and saved. `fromAuto` says
   * the reshape took the layout from Auto to Custom, so Undo goes back to Auto.
   */
  done: (description: string, fromAuto: boolean) => void;
}
let commit: ArrowShapeCommit | null = null;

/** The reshape under way took the layout from Auto to Custom. */
let leftAuto = false;

/** The canvas says what a reshape does. Returns the unregister. */
export function registerArrowShapeCommit(handle: ArrowShapeCommit): () => void {
  commit = handle;
  return () => {
    if (commit === handle) commit = null;
  };
}

/**
 * A gesture on an arrow has started to move it. In Auto, the layout becomes
 * Custom where it stands; nothing is laid out again.
 */
export function startShapingArrow(): void {
  commit?.before();
  const store = useModelStore.getState();
  if (store.autoLayout) {
    store.setAutoLayout(false);
    leftAuto = true;
  }
}

/** A reshape is done: record it in History and save it. */
export function arrowShaped(description: string): void {
  const fromAuto = leftAuto;
  leftAuto = false;
  commit?.done(description, fromAuto);
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
