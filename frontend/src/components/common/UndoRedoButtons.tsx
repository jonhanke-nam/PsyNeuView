/**
 * Undo/Redo buttons for the toolbar.
 * Shows clickable undo/redo with tooltips showing the action description.
 * Also shows the history depth count.
 *
 * The buttons call the same step the ⌘Z / ⌘⇧Z shortcuts run. They used to
 * fake a keydown on `window`, which the shortcut listener no longer acted on
 * (found by the orientation walkthrough's undo step, #1313): the buttons were
 * enabled, clicked, and did nothing.
 */

import { applyHistoryStep } from "@/hooks/useUndoRedo";
import { useHistoryStore } from "@/stores/historyStore";

export function UndoRedoButtons() {
  const canUndo = useHistoryStore((s) => s.past.length > 1);
  const canRedo = useHistoryStore((s) => s.future.length > 0);
  const undoDesc = useHistoryStore((s) => {
    if (s.past.length <= 1) return null;
    return s.past[s.past.length - 1]?.description;
  });
  const redoDesc = useHistoryStore((s) => {
    if (s.future.length === 0) return null;
    return s.future[0]?.description;
  });
  const historyDepth = useHistoryStore((s) => s.past.length - 1);

  const handleUndo = () => void applyHistoryStep(false);
  const handleRedo = () => void applyHistoryStep(true);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <button
        onClick={handleUndo}
        data-testid="undo-button"
        disabled={!canUndo}
        title={undoDesc ? `Undo: ${undoDesc} (⌘Z)` : "Nothing to undo"}
        style={{
          fontSize: "var(--pnv-fs-14)",
          padding: "2px 6px",
          border: "1px solid var(--pnv-border)",
          borderRadius: "4px 0 0 4px",
          background: canUndo ? "var(--pnv-surface)" : "var(--pnv-surface-sunken)",
          color: canUndo ? "var(--pnv-text-body)" : "var(--pnv-text-faint)",
          cursor: canUndo ? "pointer" : "default",
          lineHeight: 1,
        }}
      >
        ↩
      </button>
      <button
        onClick={handleRedo}
        data-testid="redo-button"
        disabled={!canRedo}
        title={redoDesc ? `Redo: ${redoDesc} (⌘⇧Z)` : "Nothing to redo"}
        style={{
          fontSize: "var(--pnv-fs-14)",
          padding: "2px 6px",
          border: "1px solid var(--pnv-border)",
          borderLeft: "none",
          borderRadius: "0 4px 4px 0",
          background: canRedo ? "var(--pnv-surface)" : "var(--pnv-surface-sunken)",
          color: canRedo ? "var(--pnv-text-body)" : "var(--pnv-text-faint)",
          cursor: canRedo ? "pointer" : "default",
          lineHeight: 1,
        }}
      >
        ↪
      </button>
      {historyDepth > 0 && (
        <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginLeft: 4 }}>
          {historyDepth}
        </span>
      )}
    </div>
  );
}
