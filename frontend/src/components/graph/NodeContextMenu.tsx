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
import { Z_MENU } from "@/constants/zLayers";
import { useMenuInWindow } from "@/components/common/useMenuInWindow";

interface Props {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  x: number;
  y: number;
  /**
   * #261: the multi-selection the clicked node is part of. With one, the menu
   * acts on the whole selection ("Delete 3 nodes"), as #261's table says.
   */
  selection?: { id: string; label: string; varName?: string }[];
  /** Delete these nodes, after asking (GraphCanvas's deleteNodes). */
  onDeleteNodes?: (varNames: string[]) => void;
  /** Make this node the whole selection. */
  onSelectOnly?: (nodeId: string) => void;
  onClose: () => void;
}

export function NodeContextMenu({ nodeId, nodeLabel, nodeType, x, y, selection, onDeleteNodes, onSelectOnly, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // #109: opens upward / leftward near the window's edge, as macOS menus do.
  const { left, top } = useMenuInWindow(ref, x, y);
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
        left,
        top,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-popover)",
        // A menu: above the walkthrough ring, so its pulse never covers an item.
        zIndex: Z_MENU,
        minWidth: 160,
        // Its own width wherever it opens, so it can be measured and moved
        // inside the window (#109) without wrapping against the edge.
        width: "max-content",
        padding: "4px 0",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      {selection && selection.length > 1 ? (
        <SelectionItems
          nodeId={nodeId}
          nodeLabel={nodeLabel}
          selection={selection}
          onDeleteNodes={onDeleteNodes}
          onSelectOnly={onSelectOnly}
          onClose={onClose}
        />
      ) : renaming ? (
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
          {canRename && varName && onDeleteNodes && (
            <MenuItem testId="node-menu-delete" onClick={() => { onClose(); onDeleteNodes([varName]); }}>
              Delete
            </MenuItem>
          )}
        </>
      )}
    </div>
  );
}

/** The menu for a node inside a multi-selection: about all of it (#261). */
function SelectionItems({
  nodeId,
  nodeLabel,
  selection,
  onDeleteNodes,
  onSelectOnly,
  onClose,
}: {
  nodeId: string;
  nodeLabel: string;
  selection: { id: string; label: string; varName?: string }[];
  onDeleteNodes?: (varNames: string[]) => void;
  onSelectOnly?: (nodeId: string) => void;
  onClose: () => void;
}) {
  // Only nodes with a declaration in the file can be deleted from it.
  const deletable = selection.map((s) => s.varName).filter((v): v is string => !!v);
  return (
    <>
      <div
        data-testid="node-menu-selection-count"
        style={{ padding: "4px 14px 6px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)" }}
      >
        {selection.length} nodes selected
      </div>
      {onDeleteNodes && deletable.length > 0 && (
        <MenuItem testId="node-menu-delete" onClick={() => { onClose(); onDeleteNodes(deletable); }}>
          Delete {deletable.length === 1 ? "1 node" : `${deletable.length} nodes`}
        </MenuItem>
      )}
      {onSelectOnly && (
        <MenuItem testId="node-menu-select-only" onClick={() => { onSelectOnly(nodeId); onClose(); }}>
          Select only “{nodeLabel}”
        </MenuItem>
      )}
    </>
  );
}

function MenuItem({
  onClick,
  testId,
  children,
}: {
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
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
