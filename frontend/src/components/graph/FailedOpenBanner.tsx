/**
 * Marks a failed open on the canvas (#401).
 *
 * When opening a model fails outright (a missing file, a server error),
 * nothing new is opened, so the model that was open stays on screen with its
 * title. That is accurate, but on its own the canvas looks as if nothing had
 * been asked for. This banner over the graph says what happened: "Couldn't
 * open X: reason. Still showing Y.", with Try again and Dismiss (the shared ×;
 * Escape too, through useDismiss).
 *
 * It shows only while Y is still the open model, so it never speaks for a
 * model opened some other way since, and any new open clears it
 * (beginModelOpen). Anchored to the top and narrow, like the stale-graph
 * banner, and click-through except for its two buttons: the model still open
 * is still the one being worked on, and a node under the banner still takes
 * a click.
 */

import { Button } from "@/components/common/Button";
import { DialogCloseButton } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { useFailedOpenStore } from "@/stores/failedOpenStore";
import { useModelStore } from "@/stores/modelStore";
import { baseName } from "@/utils/modelOpenSequence";

export function FailedOpenBanner() {
  const failed = useFailedOpenStore((s) => s.failed);
  const clear = useFailedOpenStore((s) => s.clear);
  const shownPath = useModelStore((s) => s.bundleOrigin || s.filePath || null);
  const showing = failed !== null && failed.shownPath === shownPath;

  useDismiss(showing, clear);

  if (!showing) return null;
  const still = failed.shownPath ? baseName(failed.shownPath) : null;

  return (
    <div
      role="alert"
      data-testid="failed-open-banner"
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 7,
        width: "max-content",
        maxWidth: "min(560px, calc(100% - 32px))",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px 8px 14px",
        borderRadius: 6,
        background: "var(--pnv-danger-tint)",
        border: "1px solid var(--pnv-danger-border)",
        color: "var(--pnv-danger)",
        fontSize: "var(--pnv-fs-13)",
        lineHeight: 1.5,
        boxShadow: "var(--pnv-shadow-frame)",
        pointerEvents: "none",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
        <span data-testid="failed-open-message">
          <b>Couldn't open {failed.attempted}:</b> {failed.reason}.
          {still ? (
            <>
              {" "}Still showing <b>{still}</b>.
            </>
          ) : null}
        </span>
        <div style={{ marginTop: 6 }}>
          <Button
            kind="small"
            style={{ pointerEvents: "auto" }}
            data-testid="failed-open-retry"
            title={`Try opening ${failed.attempted} again`}
            onClick={() => {
              const { retry } = failed;
              clear();
              retry();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
      <span style={{ pointerEvents: "auto", display: "flex" }}>
        <DialogCloseButton
          onClick={clear}
          label="Dismiss"
          title="Dismiss (Escape)"
          color="var(--pnv-danger)"
          inline
          opacity={0.7}
          testId="failed-open-dismiss"
        />
      </span>
    </div>
  );
}
