/**
 * The choice when a walkthrough and other work would collide (#172): opening
 * another model during one, or starting one with something in progress.
 * utils/tutorialGuard.ts decides when to ask, and waits on the answer here.
 *
 * Closing it any of the shared ways (#1289) changes nothing: it is Stay here,
 * or Cancel.
 */

import { Button } from "./Button";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { useTutorialChoice, type PendingChoice } from "@/utils/tutorialGuard";

export function TutorialChoiceDialog() {
  const pending = useTutorialChoice((s) => s.pending);
  if (!pending) return null;
  return pending.type === "leave" ? <Leave choice={pending} /> : <Start choice={pending} />;
}

function Frame({
  title,
  onClose,
  body,
  buttons,
}: {
  title: string;
  onClose: () => void;
  body: React.ReactNode;
  buttons: React.ReactNode;
}) {
  useDismiss(true, onClose);
  return (
    <div
      onClick={onClose}
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
        aria-labelledby="tutorial-choice-title"
        data-testid="tutorial-choice"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          width: "92%",
          maxWidth: 600,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title={title} titleId="tutorial-choice-title" onClose={onClose} />
        <div style={{ padding: "20px 28px", fontSize: "var(--pnv-fs-14)", color: "var(--pnv-text-body)", lineHeight: 1.55 }}>
          {body}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 20px 16px",
            borderTop: "1px solid var(--pnv-border-faint)",
          }}
        >
          {buttons}
        </div>
      </div>
    </div>
  );
}

function Leave({ choice }: { choice: Extract<PendingChoice, { type: "leave" }> }) {
  const stay = () => choice.resolve("stay");
  return (
    <Frame
      title={`You're in a tutorial, on step ${choice.step} of ${choice.steps}`}
      onClose={stay}
      body={
        <>
          <p style={{ margin: "0 0 10px" }}>
            <strong>{choice.tutorial}</strong>
          </p>
          <p style={{ margin: 0 }}>
            Opening <strong>{choice.what}</strong> here would leave the tutorial.
            {choice.canOpenWindow
              ? " In a new window, the tutorial stays here on this step."
              : " It can't open in a new window from here."}
          </p>
        </>
      }
      buttons={
        <>
          <Button data-testid="tutorial-choice-here" onClick={() => choice.resolve("here")} kind="secondary" size="compact">
            Leave the tutorial and open it here
          </Button>
          <Button
            data-testid="tutorial-choice-stay"
            onClick={stay}
            kind={choice.canOpenWindow ? "secondary" : "primary"}
            size="compact"
            isDefault={!choice.canOpenWindow}
          >
            Stay here
          </Button>
          {choice.canOpenWindow && (
            <Button
              data-testid="tutorial-choice-window"
              onClick={() => choice.resolve("newWindow")}
              kind="primary"
              size="compact"
              isDefault
            >
              Open in a new window
            </Button>
          )}
        </>
      }
    />
  );
}

function Start({ choice }: { choice: Extract<PendingChoice, { type: "start" }> }) {
  const cancel = () => choice.resolve("cancel");
  const canOpen = choice.noWindowReason === null;
  return (
    <Frame
      title={canOpen ? "Start this tutorial in a new window?" : "Replace what's in this window?"}
      onClose={cancel}
      body={
        <>
          <p style={{ margin: "0 0 10px" }}>
            <strong>{choice.tutorial}</strong>
          </p>
          <p style={{ margin: 0 }}>
            {canOpen
              ? "You have something in progress here. In a new window, it stays open as it is."
              : `You have something in progress here. ${choice.noWindowReason}`}
          </p>
        </>
      }
      buttons={
        <>
          <Button
            data-testid="tutorial-choice-cancel"
            onClick={cancel}
            kind={canOpen ? "secondary" : "primary"}
            size="compact"
            isDefault={!canOpen}
          >
            Cancel
          </Button>
          <Button data-testid="tutorial-choice-here" onClick={() => choice.resolve("here")} kind="secondary" size="compact">
            Replace what's in this window
          </Button>
          {canOpen && (
            <Button
              data-testid="tutorial-choice-window"
              onClick={() => choice.resolve("newWindow")}
              kind="primary"
              size="compact"
              isDefault
            >
              Start in a new window
            </Button>
          )}
        </>
      }
    />
  );
}
