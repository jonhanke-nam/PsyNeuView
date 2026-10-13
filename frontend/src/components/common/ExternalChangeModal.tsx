/**
 * Asks what to do when the model's .py changed on disk (PyCharm, or any other
 * external editor) while PsyNeuView has unsaved edits of its own (#926).
 *
 * We only ever get here when the two genuinely conflict. With no unsaved edits
 * the external change is applied silently, which is the ordinary two-headed
 * workflow: save in PyCharm, watch the graph update.
 *
 * Closes the shared ways (#1289): the × and Escape both mean "Keep my
 * changes" — the non-destructive choice, the one that changes nothing right
 * now. No click-outside: this is a question, and a stray click is not an
 * answer.
 */

import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";

interface Props {
  filePath: string;
  /** Discard the in-app edits and take what is on disk. */
  onLoadFromDisk: () => void;
  /** Keep the in-app edits; disk is left exactly as the external editor wrote it. */
  onKeepMyEdits: () => void;
}

export function ExternalChangeModal({ filePath, onLoadFromDisk, onKeepMyEdits }: Props) {
  useDismiss(true, onKeepMyEdits);

  const fileName = filePath.split("/").pop() || filePath;

  return (
    <div
      data-testid="external-change-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--pnv-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-change-title"
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          maxWidth: 560,
          width: "90%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title={`${fileName} changed on disk`} titleId="external-change-title" onClose={onKeepMyEdits} />
        <div style={{ padding: "16px 28px 24px" }}>
          <div style={{ fontSize: 13, color: "var(--pnv-text-body)", lineHeight: 1.55, marginBottom: 6 }}>
            Another editor saved this file while you have unsaved changes here, so
            there are two different versions of the model and only you know which
            one you want.
          </div>
          <ul style={{ fontSize: 13, color: "var(--pnv-text-body)", lineHeight: 1.55, margin: "0 0 18px 18px", padding: 0 }}>
            <li>
              <strong>Load from disk</strong> — take the other editor's version.
              Your unsaved changes here are discarded.
            </li>
            <li>
              <strong>Keep my changes</strong> — carry on here. The file on disk
              keeps the other editor's version until you save over it.
            </li>
          </ul>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              data-testid="external-change-keep-mine"
              onClick={onKeepMyEdits}
              kind="secondary"
            >
              Keep my changes
            </Button>
            <Button
              data-testid="external-change-load-disk"
              onClick={onLoadFromDisk}
              kind="primary"
            >
              Load from disk
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
