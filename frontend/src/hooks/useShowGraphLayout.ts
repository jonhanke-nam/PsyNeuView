/**
 * Keeps the "Like show_graph" layout (#19) current. While that layout style is
 * picked, it asks show_graph for the arrangement of the graph on the canvas
 * whenever the graph changes (a model loads, a node is added), then lays the
 * canvas out again if the layout is automatic. A custom layout is left alone
 * then; picking "Like show_graph" in the menu, or "Reset Custom Layout",
 * applies it.
 */

import { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore, selectExecPath } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { applyLayout } from "@/utils/layout";
import {
  clearShowGraphPlacement,
  computeShowGraphPlacement,
  getShowGraphPlacement,
  graphSignature,
  placementKey,
  sizeSignature,
  type ShowGraphRequest,
} from "@/utils/showGraphLayout";

// Lay out the graph PsyNeuView is showing. CIMs are drawn on top of the layout
// afterwards, so show_graph leaves them out too. A nested composition folded
// to one node is drawn as one node by show_graph too; open ones as boxes.
function showGraphRequest(): ShowGraphRequest | null {
  const s = useModelStore.getState();
  const filePath = selectExecPath(s);
  const compositionName =
    s.activeComposition || s.compositionNames[s.compositionNames.length - 1] || null;
  if (!filePath || !compositionName) return null;
  const { showController, showLearning } = useGraphSettings.getState();
  const anyFolded = s.nodes.some(
    (n: Node) =>
      n.type === "mechanismNode" && (n.data as { type?: string })?.type === "Composition",
  );
  const anyOpen = s.nodes.some((n: Node) => n.type === "compositionNode");
  return {
    filePath,
    compositionName,
    options: {
      show_controller: showController,
      show_learning: showLearning,
      show_cim: false,
      show_nested: anyFolded && !anyOpen ? false : "nested",
    },
  };
}

function relayout() {
  const { nodes, edges, setNodes } = useModelStore.getState();
  const { direction } = useGraphSettings.getState();
  setNodes(applyLayout("showgraph", nodes, edges, { direction }));
}

function reportFailure(e: unknown) {
  clearShowGraphPlacement();
  useNotificationStore.getState().addNotification(
    "warning",
    `Couldn't get show_graph's layout, so the Layered layout is shown instead: ${
      e instanceof Error ? e.message : String(e)
    }`,
    { key: "showgraph-layout" },
  );
}

/** Lay the canvas out like show_graph now, fetching the layout if needed. */
export async function applyShowGraphLayoutNow(): Promise<void> {
  const req = showGraphRequest();
  if (!req) return;
  const { nodes } = useModelStore.getState();
  try {
    if (getShowGraphPlacement()?.signature !== placementKey(nodes, req)) {
      await computeShowGraphPlacement(req, nodes);
    }
  } catch (e) {
    reportFailure(e);
  }
  // Without a layout this is the Layered stand-in, which is what the notice
  // says is shown.
  relayout();
}

export function useShowGraphLayout() {
  const layoutStyle = useGraphSettings((s) => s.layoutStyle);
  const showController = useGraphSettings((s) => s.showController);
  const showLearning = useGraphSettings((s) => s.showLearning);
  const execPath = useModelStore(selectExecPath);
  const nodes = useModelStore((s) => s.nodes);
  const signature = useMemo(() => graphSignature(nodes), [nodes]);
  const sizes = useMemo(() => sizeSignature(nodes), [nodes]);

  // A new graph (or new show_graph options): fetch its layout, and apply it if
  // the layout is automatic.
  useEffect(() => {
    if (layoutStyle !== "showgraph" || !signature) return;
    const req = showGraphRequest();
    if (!req) return;
    if (getShowGraphPlacement()?.signature === placementKey(useModelStore.getState().nodes, req)) return;
    let cancelled = false;
    computeShowGraphPlacement(req, useModelStore.getState().nodes)
      .then(() => {
        if (!cancelled && useModelStore.getState().autoLayout) relayout();
      })
      .catch((e: unknown) => {
        if (!cancelled) reportFailure(e);
      });
    return () => {
      cancelled = true;
    };
  }, [layoutStyle, execPath, signature, showController, showLearning]);

  // Boxes are measured after they first render, and grow when a node is
  // expanded: re-apply the layout already fetched so the spacing fits.
  useEffect(() => {
    if (layoutStyle !== "showgraph" || !useModelStore.getState().autoLayout) return;
    // applyLayout itself declines a layout made for a different graph.
    if (!getShowGraphPlacement()) return;
    relayout();
  }, [sizes]); // eslint-disable-line react-hooks/exhaustive-deps
}
