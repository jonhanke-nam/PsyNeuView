/**
 * Which parts of the layout are the user's, and which are computed (#1163).
 *
 * The layout is two kinds of thing and the canvas never says which is which:
 *
 *   recorded — a node placed, an edge shaped, a port moved. Never moves on its
 *              own.
 *   derived  — everything else. Recomputed each render, deterministic, and it
 *              *follows* the recorded things.
 *
 * Both are stable while nothing changes, so "not recorded" does not mean
 * "unreliable". The difference shows when the model changes: recorded things
 * stay, derived things adapt — which is what you want, and is surprising when
 * you cannot tell them apart. A node added in an IDE can push an unrelated edge
 * onto a new route; nothing the user touched moved, but the picture did.
 *
 * Kept pure so the question has one answer wherever it is asked.
 */

export type LayoutOrigin = "placed" | "automatic";

/** Whether this node's position came from the sidecar rather than the engine. */
export function nodeOrigin(
  node: { id: string; data?: { varName?: string } | unknown },
  savedPositions: Record<string, unknown> | null | undefined,
): LayoutOrigin {
  if (!savedPositions) return "automatic";
  const varName = (node.data as { varName?: string } | undefined)?.varName;
  const key = varName && savedPositions[varName] !== undefined ? varName : node.id;
  return savedPositions[key] !== undefined ? "placed" : "automatic";
}

/**
 * Whether this edge's route was shaped by hand.
 *
 * Reads the shaped marks rather than the waypoints: grabbing a handle on an
 * auto-routed edge materialises the router's corners before any movement
 * (#951/#1162), so having waypoints is not evidence that anyone shaped it.
 */
export function edgeOrigin(
  edgeId: string,
  shaped: Record<string, true> | null | undefined,
): LayoutOrigin {
  return shaped?.[edgeId] ? "placed" : "automatic";
}

/** Short label for the inspector. */
export function originLabel(origin: LayoutOrigin, kind: "node" | "edge"): string {
  if (origin === "placed") return kind === "node" ? "placed by you" : "shaped by you";
  return kind === "node" ? "placed automatically" : "routed automatically";
}

/** The sentence explaining what that means for the thing selected. */
export function originHint(origin: LayoutOrigin, kind: "node" | "edge"): string {
  if (origin === "placed") {
    return kind === "node"
      ? "Its position is saved and will not change when the model does."
      : "Its route is saved. The ends follow their nodes; the bends stay where you put them.";
  }
  return kind === "node"
    ? "Its position is computed from the graph, so it can move when the model changes. Drag it to fix it in place."
    : "Its route is computed around the nodes in the way, so it can change when they do. Drag it to shape it.";
}
