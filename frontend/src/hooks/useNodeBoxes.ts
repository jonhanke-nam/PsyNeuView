/**
 * Re-render when any node on the canvas moves or changes size.
 *
 * An edge routes itself around the other nodes' boxes (#914), which it reads
 * from React Flow's `nodeLookup`. That Map is updated in place, so subscribing
 * to it never re-renders anything, and React Flow re-renders an edge only when
 * one of its own two ends moves. So when a node that isn't on an edge's ends
 * moved, the edge kept the route it had worked out around the node's old place,
 * and could run straight through the new one. Opening a graph does this: it is
 * drawn, then laid out again at the boxes' measured sizes (#210).
 *
 * The signature is worked out once for each update of the nodes, however many
 * edges ask for it, and it changes only with a node's place or size, so
 * selecting something re-renders no edge.
 */

import { useStore, type ReactFlowState } from "@xyflow/react";

interface Boxed {
  type?: string;
  position?: { x: number; y: number };
  measured?: { width?: number; height?: number };
  internals?: { positionAbsolute?: { x: number; y: number } };
}

/** Every node's id, type, place and size, as one string to compare. */
export function nodeBoxesSignature(lookup: Iterable<[string, Boxed]>): string {
  const parts: string[] = [];
  for (const [id, n] of lookup) {
    const at = n.internals?.positionAbsolute ?? n.position;
    parts.push(`${id}|${n.type}|${at?.x},${at?.y}|${n.measured?.width},${n.measured?.height}`);
  }
  return parts.join("\n");
}

let lastNodes: unknown;
let lastSignature = "";

function selectSignature(s: ReactFlowState): string {
  if (s.nodes !== lastNodes) {
    lastNodes = s.nodes;
    lastSignature = nodeBoxesSignature(s.nodeLookup);
  }
  return lastSignature;
}

/** Subscribes the calling component to every node's place and size. */
export function useNodeBoxes(): void {
  useStore(selectSignature);
}
