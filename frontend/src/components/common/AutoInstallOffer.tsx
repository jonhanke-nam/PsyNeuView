/**
 * "Install PsyNeuView updates automatically when you quit?" (PsyNeuView-MacApp#79)
 *
 * Consent first, default off: automatic install stays off until the user says
 * yes. Inside the Mac app only, asked once after setup, to new and existing
 * users alike; the app keeps the answer and never asks again. Changing the
 * switch in Settings ▸ General ▸ Updates counts as an answer too. The × and
 * Escape close it without answering, so it is asked again at the next launch.
 *
 * Not a native window and not a second settings surface: the one control is
 * Settings ▸ General ▸ Updates (docs/settings-and-mac-app.md).
 */

import { Button } from "@/components/common/Button";
import { DialogHeader } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { DIALOG_SCRIM_BOTTOM } from "@/constants/zLayers";
import { AUTO_INSTALL_QUESTION, AUTO_INSTALL_QUESTION_HINT } from "@/utils/appUpdateNotice";

export function AutoInstallOffer({
  open,
  onAnswer,
  onClose,
}: {
  open: boolean;
  onAnswer: (yes: boolean) => void;
  onClose: () => void;
}) {
  useDismiss(open, onClose);
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0, bottom: DIALOG_SCRIM_BOTTOM,
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
        aria-labelledby="auto-install-offer-title"
        data-testid="auto-install-offer"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          width: "92%",
          maxWidth: 480,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title="Automatic updates" titleId="auto-install-offer-title" onClose={onClose} />
        <div style={{ padding: "16px 24px", fontSize: "var(--pnv-fs-14)", color: "var(--pnv-text-body)", lineHeight: 1.5 }}>
          <p style={{ margin: "0 0 8px" }}>{AUTO_INSTALL_QUESTION}</p>
          <p style={{ margin: 0, fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)" }}>{AUTO_INSTALL_QUESTION_HINT}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 20px 16px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button data-testid="auto-install-offer-no" onClick={() => onAnswer(false)} kind="secondary" size="compact">
            No, ask me each time
          </Button>
          <Button data-testid="auto-install-offer-yes" onClick={() => onAnswer(true)} kind="primary" size="compact">
            Yes, install automatically
          </Button>
        </div>
      </div>
    </div>
  );
}
