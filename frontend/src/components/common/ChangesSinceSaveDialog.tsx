/**
 * Changes since save: what the editor holds that the file on disk does not
 * (#1348).
 *
 * The orange dot beside the model name says there are unsaved changes; this
 * says what they are. It compares the editor's text against the file *as it
 * is on disk now*, read fresh when the dialog opens, rather than against the
 * text PsyNeuView last loaded or saved. The two are usually the same; when
 * they are not, the file changed outside PsyNeuView (PyCharm saved it, say),
 * and the dialog says so at the top, because then "unsaved changes" includes
 * undoing someone else's.
 *
 * Read only, so it works the same for a locked or protected model. It reuses
 * the diff rows LastGoodDiff draws (LineDiffView): side by side when there is
 * room, one column when the window is narrow.
 *
 * Closes the shared ways (#1289): the × in its header, Escape, a click
 * outside, and Close, which is the default button (the Close rule, #1302).
 */

import { useEffect, useMemo, useState } from "react";

import { useModelStore } from "@/stores/modelStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useChangesSinceSaveStore } from "@/stores/changesSinceSaveStore";
import { collapseUnchanged, countChanges, describeChanges, diffLines } from "@/utils/lineDiff";
import { Button } from "./Button";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { LineDiffView, MONO } from "./LineDiffView";
import { readDisk, SPLIT_MIN_WIDTH, useWindowWidth, type Disk } from "@/utils/diskSource";

/** Drawn by App; renders nothing until something opens it. */
export function ChangesSinceSaveDialog() {
  const open = useChangesSinceSaveStore((s) => s.open);
  const filePath = useModelStore((s) => s.filePath);
  if (!open || !filePath) return null;
  return <ChangesSinceSave filePath={filePath} />;
}

function ChangesSinceSave({ filePath }: { filePath: string }) {
  const hide = useChangesSinceSaveStore((s) => s.hide);
  const source = useModelStore((s) => s.source);
  const savedSource = useModelStore((s) => s.savedSource);
  // Re-read the disk when anything that could have changed it happens while
  // the dialog is open: a save here (savedSource moves), or an outside change
  // the file watcher reported (pending is set, or applied and savedSource moves).
  const pendingOutside = useExternalChangeStore((s) => s.pending);
  const [disk, setDisk] = useState<Disk>({ state: "loading" });
  const narrow = useWindowWidth() < SPLIT_MIN_WIDTH;

  useDismiss(true, hide);

  useEffect(() => {
    let cancelled = false;
    void readDisk(filePath).then((d) => {
      if (!cancelled) setDisk(d);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, savedSource, pendingOutside]);

  // Compare against disk; if the file is gone, against what was last loaded or
  // saved here, which is the best remaining idea of "the saved version".
  const base = disk.state === "read" ? disk.source : disk.state === "missing" ? savedSource : null;
  const diff = useMemo(() => (base === null ? null : diffLines(base, source)), [base, source]);
  const counts = diff ? countChanges(diff) : null;
  const rows = useMemo(() => (diff ? collapseUnchanged(diff) : []), [diff]);
  const changedOutside = disk.state === "read" && disk.source !== savedSource;
  const fileName = filePath.split("/").pop() || filePath;

  return (
    <div
      data-testid="changes-since-save-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 9000, display: "flex",
        alignItems: "center", justifyContent: "center", background: "var(--pnv-scrim)",
      }}
      onClick={hide}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changes-since-save-title"
        data-testid="changes-since-save"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1200px, 94%)", maxHeight: "86%", display: "flex", flexDirection: "column",
          background: "var(--pnv-surface)", borderRadius: 8, boxShadow: "var(--pnv-shadow-dialog)", overflow: "hidden",
        }}
      >
        <DialogHeader title="Changes since save" titleId="changes-since-save-title" onClose={hide}>
          <span style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", fontFamily: MONO }} title={filePath}>
            {fileName}
          </span>
        </DialogHeader>

        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--pnv-border-faint)", display: "flex", flexDirection: "column", gap: 8 }}>
          {changedOutside && (
            <div
              data-testid="changes-since-save-outside"
              style={{
                fontSize: "var(--pnv-fs-13)", lineHeight: 1.5, padding: "8px 12px", borderRadius: 6,
                color: "var(--pnv-text-body)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)",
              }}
            >
              <strong>The file on disk changed outside PsyNeuView</strong> since it was opened or saved here.
              This compares against the file as it is now, so saving would also undo that outside change.
            </div>
          )}
          {disk.state === "missing" && (
            <div
              data-testid="changes-since-save-missing"
              style={{
                fontSize: "var(--pnv-fs-13)", lineHeight: 1.5, padding: "8px 12px", borderRadius: 6,
                color: "var(--pnv-text-body)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)",
              }}
            >
              <strong>The file is not on disk any more.</strong> This compares against the version PsyNeuView
              last opened or saved; saving puts the editor's text back on disk.
            </div>
          )}
          <div data-testid="changes-since-save-summary" style={{ fontSize: "var(--pnv-fs-14)", fontWeight: 600, color: "var(--pnv-text)" }}>
            {disk.state === "loading" && "Reading the file on disk…"}
            {disk.state === "error" && (
              <span style={{ color: "var(--pnv-danger)" }}>Could not read the file on disk ({disk.message}).</span>
            )}
            {counts && (
              <>
                <span>{describeChanges(counts)}</span>
                <span style={{ fontWeight: 400, fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", marginLeft: 8 }}>
                  {counts.added + counts.removed === 0
                    ? "The editor matches the file on disk."
                    : "in the editor, compared with the file on disk"}
                </span>
              </>
            )}
          </div>
        </div>

        {counts && counts.added + counts.removed > 0 && (
          <div style={{ overflow: "auto", fontFamily: MONO, fontSize: "var(--pnv-fs-12_5)" }}>
            <div
              style={{
                display: "flex", position: "sticky", top: 0, zIndex: 1, background: "var(--pnv-surface-muted)",
                borderBottom: "1px solid var(--pnv-border-faint)", fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-muted)",
                fontFamily: "inherit",
              }}
            >
              {narrow ? (
                <span style={{ padding: "4px 16px" }}>− on disk  + in the editor</span>
              ) : (
                <>
                  <span style={{ flex: "1 1 0", padding: "4px 10px" }}>On disk</span>
                  <span style={{ flex: "1 1 0", padding: "4px 10px" }}>In the editor</span>
                </>
              )}
            </div>
            <div style={{ padding: "4px 0 8px" }}>
              <LineDiffView rows={rows} layout={narrow ? "unified" : "split"} />
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button kind="primary" isDefault onClick={hide} data-testid="changes-since-save-close">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
