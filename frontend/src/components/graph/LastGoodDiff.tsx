/**
 * Compare the file as it stands against the version that last built (#1154).
 *
 * Read-only on purpose. The question this answers is "what did I just change",
 * asked at the moment the graph stopped updating — and the useful answer is a
 * diff against the last version that actually worked, which is often clearer
 * than the syntax error.
 *
 * It does not claim more than that. A model can build and still be wrong; this
 * only knows which source produced the picture on screen.
 *
 * Closes the shared ways (#1289): the × in its header, Escape, a click outside.
 */

import { useMemo } from "react";

import { DialogHeader } from "@/components/common/dialog/DialogHeader";
import { LineDiffView, MONO } from "@/components/common/LineDiffView";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { useModelStore } from "@/stores/modelStore";
import { collapseUnchanged, diffLines, hasChanges } from "@/utils/lineDiff";

function ago(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function LastGoodDiff({ onClose }: { onClose: () => void }) {
  const lastGoodSource = useModelStore((s) => s.lastGoodSource);
  const lastGoodAt = useModelStore((s) => s.lastGoodAt);
  const source = useModelStore((s) => s.source);

  const rows = useMemo(
    () => (lastGoodSource === null ? [] : collapseUnchanged(diffLines(lastGoodSource, source))),
    [lastGoodSource, source],
  );
  const changed = useMemo(
    () => (lastGoodSource === null ? false : hasChanges(diffLines(lastGoodSource, source))),
    [lastGoodSource, source],
  );

  useDismiss(true, onClose);

  return (
    <div
      data-testid="last-good-diff"
      style={{
        position: "absolute", inset: 0, zIndex: 20, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "var(--pnv-scrim)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="last-good-diff-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 92%)", maxHeight: "82%", display: "flex", flexDirection: "column",
          background: "var(--pnv-surface)", borderRadius: 8, boxShadow: "var(--pnv-shadow-dialog)", overflow: "hidden",
        }}
      >
        <DialogHeader title="Changes since the last version that built" titleId="last-good-diff-title" onClose={onClose}>
          {lastGoodAt !== null && (
            <span style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)" }}>that version built {ago(lastGoodAt)}</span>
          )}
        </DialogHeader>

        <div style={{ overflow: "auto", padding: "8px 0", fontFamily: MONO, fontSize: "var(--pnv-fs-12_5)" }}>
          {lastGoodSource === null ? (
            <div style={{ padding: "16px", color: "var(--pnv-text-muted)", fontFamily: "inherit" }}>
              Nothing has built yet this session, so there is no version to compare against.
            </div>
          ) : !changed ? (
            <div style={{ padding: "16px", color: "var(--pnv-text-muted)", fontFamily: "inherit" }}>
              The file is identical to the version that built. The failure is not in the text —
              it may come from something the model reads at run time.
            </div>
          ) : (
            <LineDiffView rows={rows} />
          )}
        </div>
      </div>
    </div>
  );
}
