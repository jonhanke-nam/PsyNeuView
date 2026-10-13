/**
 * Revert the file to this save (#1349): the confirm, showing what will change.
 *
 * Opened from History, on a save the file no longer holds. It compares the
 * file *as it is on disk now* (read fresh, as Changes since save does) with
 * the saved version, in the same diff rows (LineDiffView), and says what
 * Revert does: the editor and the file both get the saved version, and what
 * the editor held stays in History, one Undo away. Nothing is written until
 * Revert the file is pressed, and then through Save (utils/revertToSave.ts).
 *
 * Closes the shared ways (#1289): the × in its header, Escape, a click
 * outside, and Cancel. Revert the file is the primary action (the Close rule,
 * #1302); it is not the default, so Return alone never writes the file.
 */

import { useEffect, useMemo, useState } from "react";

import { useEditLockStore } from "@/stores/editLockStore";
import { useModelStore } from "@/stores/modelStore";
import { isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useRevertToSaveStore, type RevertTarget } from "@/stores/revertToSaveStore";
import { readDisk, SPLIT_MIN_WIDTH, useWindowWidth, type Disk } from "@/utils/diskSource";
import { collapseUnchanged, countChanges, describeChanges, diffLines } from "@/utils/lineDiff";
import { revertToSave } from "@/utils/revertToSave";
import { formatSaveTime, revertBlock, revertBlockReason } from "@/utils/saveHistory";
import { Button } from "./Button";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { LineDiffView, MONO } from "./LineDiffView";

/** Drawn by App; renders nothing until History opens it. */
export function RevertToSaveDialog() {
  const target = useRevertToSaveStore((s) => s.target);
  const filePath = useModelStore((s) => s.filePath);
  if (!target || !filePath) return null;
  return <RevertToSave filePath={filePath} target={target} />;
}

function RevertToSave({ filePath, target }: { filePath: string; target: RevertTarget }) {
  const hide = useRevertToSaveStore((s) => s.hide);
  const source = useModelStore((s) => s.source);
  const savedSource = useModelStore((s) => s.savedSource);
  const viewOnly = useEditLockStore((s) => s.mode === "viewOnly");
  const pnlProtected = usePnlSourceStore((s) => isProtected(s.status));
  const [disk, setDisk] = useState<Disk>({ state: "loading" });
  const [reverting, setReverting] = useState(false);
  const narrow = useWindowWidth() < SPLIT_MIN_WIDTH;

  useDismiss(true, () => {
    if (!reverting) hide();
  });

  useEffect(() => {
    let cancelled = false;
    void readDisk(filePath).then((d) => {
      if (!cancelled) setDisk(d);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, savedSource]);

  const saved = target.snapshot.source;
  const base = disk.state === "read" ? disk.source : disk.state === "missing" ? "" : null;
  const diff = useMemo(() => (base === null ? null : diffLines(base, saved)), [base, saved]);
  const counts = diff ? countChanges(diff) : null;
  const rows = useMemo(() => (diff ? collapseUnchanged(diff) : []), [diff]);
  const changes = counts ? counts.added + counts.removed : 0;
  const changedOutside = disk.state === "read" && disk.source !== savedSource;
  const editorDiffers = source !== saved && source !== savedSource;
  const block = revertBlock({ filePath, viewOnly, pnlProtected });
  const when = formatSaveTime(target.mark.at, true);
  const fileName = filePath.split("/").pop() || filePath;
  const canRevert = !block && !reverting && counts !== null && changes > 0;

  const onRevert = async () => {
    setReverting(true);
    try {
      await revertToSave(target);
    } finally {
      setReverting(false);
      hide();
    }
  };

  return (
    <div
      data-testid="revert-to-save-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 9000, display: "flex",
        alignItems: "center", justifyContent: "center", background: "var(--pnv-scrim)",
      }}
      onClick={() => {
        if (!reverting) hide();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-to-save-title"
        data-testid="revert-to-save"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1200px, 94%)", maxHeight: "86%", display: "flex", flexDirection: "column",
          background: "var(--pnv-surface)", borderRadius: 8, boxShadow: "var(--pnv-shadow-dialog)", overflow: "hidden",
        }}
      >
        <DialogHeader title={`Revert the file to the save of ${when}`} titleId="revert-to-save-title" onClose={hide}>
          <span style={{ fontSize: 12, color: "var(--pnv-text-muted)", fontFamily: MONO }} title={filePath}>
            {fileName}
          </span>
        </DialogHeader>

        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pnv-border-faint)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div data-testid="revert-to-save-explain" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--pnv-text-body)" }}>
            The file on disk and the editor will both hold the version you saved at <strong>{when}</strong>
            {target.mark.kind === "auto" ? " (autosaved)" : ""}.
            {" "}What the editor holds now stays in History: Undo brings it back.
            {editorDiffers && " That includes your unsaved changes."}
          </div>
          {changedOutside && (
            <div
              data-testid="revert-to-save-outside"
              style={{
                fontSize: 13, lineHeight: 1.5, padding: "8px 12px", borderRadius: 6,
                color: "var(--pnv-text-body)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)",
              }}
            >
              <strong>The file on disk changed outside PsyNeuView</strong> since it was opened or saved here.
              Reverting asks about that first, as Save does.
            </div>
          )}
          {block && (
            <div
              data-testid="revert-to-save-blocked"
              style={{
                fontSize: 13, lineHeight: 1.5, padding: "8px 12px", borderRadius: 6,
                color: "var(--pnv-text-body)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)",
              }}
            >
              {revertBlockReason(block)}
            </div>
          )}
          <div data-testid="revert-to-save-summary" style={{ fontSize: 14, fontWeight: 600, color: "var(--pnv-text)" }}>
            {disk.state === "loading" && "Reading the file on disk…"}
            {disk.state === "error" && (
              <span style={{ color: "var(--pnv-danger)" }}>Could not read the file on disk ({disk.message}).</span>
            )}
            {counts && (
              <>
                <span>{describeChanges(counts)}</span>
                <span style={{ fontWeight: 400, fontSize: 12, color: "var(--pnv-text-muted)", marginLeft: 8 }}>
                  {changes === 0
                    ? "The file on disk already holds this version."
                    : "in the file on disk, if you revert"}
                </span>
              </>
            )}
          </div>
        </div>

        {counts && changes > 0 && (
          <div style={{ overflow: "auto", fontFamily: MONO, fontSize: 12.5 }}>
            <div
              style={{
                display: "flex", position: "sticky", top: 0, zIndex: 1, background: "var(--pnv-surface-muted)",
                borderBottom: "1px solid var(--pnv-border-faint)", fontSize: 11, color: "var(--pnv-text-muted)",
                fontFamily: "inherit",
              }}
            >
              {narrow ? (
                <span style={{ padding: "4px 16px" }}>− on disk now  + the save of {when}</span>
              ) : (
                <>
                  <span style={{ flex: "1 1 0", padding: "4px 10px" }}>On disk now</span>
                  <span style={{ flex: "1 1 0", padding: "4px 10px" }}>The save of {when}</span>
                </>
              )}
            </div>
            <div style={{ padding: "4px 0 8px" }}>
              <LineDiffView rows={rows} layout={narrow ? "unified" : "split"} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button kind="secondary" onClick={hide} disabled={reverting} data-testid="revert-to-save-cancel">
            Cancel
          </Button>
          <Button kind="primary" onClick={() => void onRevert()} disabled={!canRevert} data-testid="revert-to-save-confirm">
            {reverting ? "Reverting…" : "Revert the file"}
          </Button>
        </div>
      </div>
    </div>
  );
}
