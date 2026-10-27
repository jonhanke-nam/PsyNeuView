/**
 * Right-click context menu for graph nodes.
 * Provides expand/collapse, inspect, and other node actions.
 * Closes like every other menu (#1289): Escape, or a click anywhere else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { toggleCompositionCollapse, renameNode } from "@/utils/nodeActions";
import { useDismiss } from "@/components/common/dialog/useDismiss";

interface Props {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function NodeContextMenu({ nodeId, nodeLabel, nodeType, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const expanded = useGraphSettings((s) => s.expandedNodes.has(nodeLabel));
  const isComposition = nodeType === "compositionNode";
  const isCollapsedComp = useGraphSettings((s) => s.collapsedCompositions.has(nodeLabel));
  // A mechanism with type "Composition" is a collapsed composition
  const isCollapsedMechComp = !isComposition && (useModelStore.getState().nodes.find(n => n.id === nodeId)?.data as any)?.type === "Composition";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  // Escape closes the menu through the shared stack (#1289) — including
  // while the rename field is open, which is the same as cancelling it.
  useDismiss(true, onClose);

  const handleExpand = useCallback(() => {
    useGraphSettings.getState().toggleExpandedNode(nodeLabel);
    onClose();
  }, [nodeLabel, onClose]);

  const handleInspect = useCallback(() => {
    useModelStore.getState().setSelectedNodeId(nodeId);
    onClose();
  }, [nodeId, onClose]);

  // Start a WhenFinished gesture (#385): arm "pick a node" mode so the user's
  // next canvas click names the node this one waits for. Completes to
  // `comp.scheduler.add_condition(thisNode, pnl.WhenFinished(picked))`.
  const handleWhenFinished = useCallback(() => {
    const node = useModelStore.getState().nodes.find((n) => n.id === nodeId);
    const varName = (node?.data as any)?.varName || nodeId;
    useModelStore.getState().setPendingConditionGesture({
      ownerNodeId: nodeId,
      ownerVarName: varName,
      ownerLabel: nodeLabel,
      conditionType: "WhenFinished",
    });
    onClose();
  }, [nodeId, nodeLabel, onClose]);

  const handleToggleComposition = useCallback(() => {
    void toggleCompositionCollapse(nodeLabel);
    onClose();
  }, [nodeLabel, onClose]);

  // In-graph rename (#737), routing to the shared rename action used by the
  // Inspector. Offered for nodes backed by a source declaration (have a varName
  // in lineMap) — not view-only nodes, mirroring the inspector's gating.
  const addNotification = useNotificationStore((s) => s.addNotification);
  const lineMap = useModelStore((s) => s.lineMap);
  const varName = (useModelStore.getState().nodes.find((n) => n.id === nodeId)?.data as { varName?: string } | undefined)?.varName;
  const canRename = !!varName && varName in lineMap;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(nodeLabel);
  const submitRename = useCallback(async () => {
    if (!varName) return;
    const err = await renameNode(varName, nodeLabel, renameValue);
    if (err) {
      addNotification("error", err);
      return; // keep the input open so the user can pick another name
    }
    onClose();
  }, [varName, nodeLabel, renameValue, addNotification, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="node-context-menu"
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-popover)",
        zIndex: 10000,
        minWidth: 160,
        padding: "4px 0",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      {renaming ? (
        <div style={{ padding: "6px 10px" }}>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
            }}
            placeholder="New name"
            style={{ width: 160, fontSize: "var(--pnv-fs-13)", padding: "3px 6px", border: "1px solid var(--pnv-primary)", borderRadius: 4 }}
          />
        </div>
      ) : (
        <>
          {!isComposition && !isCollapsedMechComp && (
            <MenuItem onClick={handleExpand}>
              {expanded ? "Collapse Node" : "Expand Node"}
            </MenuItem>
          )}
          {(isComposition || isCollapsedMechComp) && (
            <MenuItem onClick={handleToggleComposition}>
              {isComposition && !isCollapsedComp ? "Collapse Composition" : "Expand Composition"}
            </MenuItem>
          )}
          <MenuItem onClick={handleInspect}>Inspect</MenuItem>
          {canRename && (
            <MenuItem onClick={() => { setRenameValue(nodeLabel); setRenaming(true); }}>
              Rename…
            </MenuItem>
          )}
          {!isComposition && !isCollapsedMechComp && (
            <MenuItem onClick={handleWhenFinished}>Runs when… finishes</MenuItem>
          )}
        </>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 14px",
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: "var(--pnv-fs-13)",
        color: "var(--pnv-text-body)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-primary-tint)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {children}
    </button>
  );
}
