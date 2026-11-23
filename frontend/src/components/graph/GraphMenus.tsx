/**
 * Context menus for an arrow and for the empty canvas (#261), beside the
 * node's own (NodeContextMenu.tsx). macOS convention: a secondary click
 * (Control-click, right-click, a two-finger tap) shows the menu for what is
 * under the pointer, so everything you can click on the graph has one. Each
 * offers only actions the app already has elsewhere, so a menu is never the
 * only way to do something. They close like every other menu (#1289): Escape,
 * a click anywhere else, or a pick.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Z_MENU } from "@/constants/zLayers";
import { useMenuInWindow } from "@/components/common/useMenuInWindow";

export function GraphMenu({ "data-testid": testId, x, y, onClose, children }: {
  "data-testid": string;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // #109: opens upward / leftward near the window's edge, as macOS menus do.
  const { left, top } = useMenuInWindow(ref, x, y);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  useDismiss(true, onClose);
  return (
    <div
      ref={ref}
      role="menu"
      data-testid={testId}
      style={{
        position: "fixed",
        left,
        top,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-popover)",
        zIndex: Z_MENU,
        minWidth: 160,
        // Its own width wherever it opens, so it can be measured and moved
        // inside the window (#109) without wrapping against the edge.
        width: "max-content",
        padding: "4px 0",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      {children}
    </div>
  );
}

export function GraphMenuItem({ onClick, testId, children }: { onClick: () => void; testId?: string; children: ReactNode }) {
  return (
    <button
      role="menuitem"
      data-testid={testId}
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

/**
 * An arrow's menu (#261). A projection's: select either end, reset its shape,
 * Rename… (as double-clicking its name in the Inspector) and Delete (as the
 * Delete shortcut). A scheduling arrow's: Edit condition (its condition in
 * the Inspector) and Delete.
 */
export function EdgeContextMenu({
  x, y, shaped, name, onSelectSender, onSelectReceiver, onResetShape, onRename, onEditCondition, onDelete, onClose,
}: {
  x: number;
  y: number;
  /** Whether the arrow has a shape of its own to reset. */
  shaped: boolean;
  /** Its name, for Rename… to start from. */
  name?: string;
  onSelectSender: () => void;
  onSelectReceiver: () => void;
  onResetShape: () => void;
  /** A projection declared in the file: rename it; null, or what went wrong. */
  onRename?: (newName: string) => Promise<string | null>;
  /** A scheduling arrow: show its condition in the Inspector. */
  onEditCondition?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!onRename) return;
    const err = await onRename(value);
    if (err) setError(err);
    else onClose();
  };
  return (
    <GraphMenu data-testid="edge-context-menu" x={x} y={y} onClose={onClose}>
      {renaming ? (
        <div style={{ padding: "6px 10px" }}>
          <input
            autoFocus
            data-testid="edge-menu-rename-input"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="New name"
            style={{ width: 180, fontSize: "var(--pnv-fs-13)", padding: "3px 6px", border: "1px solid var(--pnv-primary)", borderRadius: 4 }}
          />
          {error && <div style={{ color: "var(--pnv-danger)", fontSize: "var(--pnv-fs-12)", marginTop: 4 }}>{error}</div>}
        </div>
      ) : (
        <>
          {onEditCondition && <GraphMenuItem testId="edge-menu-edit-condition" onClick={onEditCondition}>Edit condition</GraphMenuItem>}
          <GraphMenuItem testId="edge-menu-select-sender" onClick={onSelectSender}>Select sender</GraphMenuItem>
          <GraphMenuItem testId="edge-menu-select-receiver" onClick={onSelectReceiver}>Select receiver</GraphMenuItem>
          {shaped && <GraphMenuItem testId="edge-menu-reset-shape" onClick={onResetShape}>Reset shape</GraphMenuItem>}
          {onRename && <GraphMenuItem testId="edge-menu-rename" onClick={() => setRenaming(true)}>Rename…</GraphMenuItem>}
          {onDelete && <GraphMenuItem testId="edge-menu-delete" onClick={onDelete}>Delete</GraphMenuItem>}
        </>
      )}
    </GraphMenu>
  );
}

/** The empty canvas's menu (#261). */
export function CanvasContextMenu({ x, y, onSelectAll, onFit, onShowComponents, onClose }: {
  x: number;
  y: number;
  onSelectAll: () => void;
  onFit: () => void;
  onShowComponents: () => void;
  onClose: () => void;
}) {
  return (
    <GraphMenu data-testid="canvas-context-menu" x={x} y={y} onClose={onClose}>
      <GraphMenuItem testId="canvas-menu-select-all" onClick={onSelectAll}>Select All</GraphMenuItem>
      <GraphMenuItem testId="canvas-menu-fit" onClick={onFit}>Fit the graph to the window</GraphMenuItem>
      <GraphMenuItem testId="canvas-menu-components" onClick={onShowComponents}>Show Components…</GraphMenuItem>
    </GraphMenu>
  );
}
