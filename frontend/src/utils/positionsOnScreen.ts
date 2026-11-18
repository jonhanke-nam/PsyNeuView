/**
 * Where each node on the canvas is, keyed the way a saved layout keys it.
 *
 * A layout file names a node by its PsyNeuLink variable name (the node id when
 * it has none). A CIM's name carries a number PsyNeuLink changes on every
 * load, so it is keyed without it. The flat view's composition frames are
 * rebuilt on every load and are never kept.
 *
 * Used both to save a layout and, on a reload, to keep the nodes where they
 * are on screen (#164).
 */
import type { Node } from "@xyflow/react";

export type Positions = Record<string, { x: number; y: number }>;

export function positionsOnScreen(nodes: readonly Node[]): Positions {
  const positions: Positions = {};
  for (const node of nodes) {
    if (node.id.startsWith("cluster::")) continue;
    let key = (node.data as { varName?: string } | undefined)?.varName || node.id;
    if (node.type === "cimNode") key = key.replace(/-\d+\s/, " ");
    positions[key] = { x: node.position.x, y: node.position.y };
  }
  return positions;
}
