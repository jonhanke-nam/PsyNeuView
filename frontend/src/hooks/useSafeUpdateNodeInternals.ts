/**
 * React Flow's `useUpdateNodeInternals`, but safe for any node name (#1236).
 *
 * A node's id here is its PsyNeuLink name, which can be anything a Python
 * string can hold. React Flow's hook finds the node's element with
 * `.react-flow__node[data-id="${id}"]`, unescaped, so a name containing a
 * newline or a double quote is an invalid selector and the whole canvas
 * crashes. It crashed on every re-render, too, so typing such a name took the
 * app down before it could be undone.
 *
 * This is the same hook with the id escaped. It calls the same store action,
 * so what React Flow does with the element afterwards is unchanged.
 */

import { useCallback } from "react";
import { useStoreApi } from "@xyflow/react";

import { nodeSelector } from "@/utils/nodeSelector";

export function useSafeUpdateNodeInternals() {
  const store = useStoreApi();
  return useCallback(
    (id: string | string[]) => {
      const { domNode, updateNodeInternals } = store.getState();
      const updates = new Map();
      for (const nodeId of Array.isArray(id) ? id : [id]) {
        const nodeElement = domNode?.querySelector(nodeSelector(nodeId));
        if (nodeElement) updates.set(nodeId, { id: nodeId, nodeElement, force: true });
      }
      requestAnimationFrame(() => updateNodeInternals(updates, { triggerFitView: false }));
    },
    [store],
  );
}
