/**
 * Stacking inside the graph canvas (#250): a node is always above every
 * arrow, so anywhere in or on a node registers a click on that node.
 *
 * React Flow stacks an arrow at its ends' level when an end sits inside a
 * frame (a nested node is lifted to its frame's level + 1, the arrow with
 * it), and adds 1000 to a selected node or arrow. So an arrow to a nested
 * node rose above every top-level node, and its wide invisible grab strip
 * lay over the nodes it passed — zoomed out, over most of a small node. The
 * fix leaves React Flow's own levels alone (arrows still sit above the
 * frames they enter) and draws every node, other than an open frame, above
 * all of them; the selected one a step higher, so it stays on top of the
 * node it is dragged over.
 */
import type { Node } from "@xyflow/react";

/** Higher than any level React Flow gives an arrow (2 × 1000 + frame depth). */
export const NODE_LAYER_Z = 4000;

/** Open frames keep their own level: below the arrows that enter them. */
export function nodeLayer(node: Pick<Node, "type" | "selected">): number | undefined {
  if (node.type === "compositionNode") return undefined;
  return NODE_LAYER_Z + (node.selected ? 1 : 0);
}

/** A node as drawn: in its layer (the drawn style's zIndex wins over React Flow's). */
export function inNodeLayer<N extends Node>(node: N): N {
  const z = nodeLayer(node);
  return z === undefined ? node : { ...node, style: { ...node.style, zIndex: z } };
}
