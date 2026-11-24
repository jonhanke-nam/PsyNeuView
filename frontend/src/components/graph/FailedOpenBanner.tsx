/**
 * Marks a failed open on the canvas (#401).
 *
 * When opening a model fails outright (a missing file, a server error),
 * nothing new is opened, so the model that was open stays on screen with its
 * title. That is accurate, but on its own the canvas looks as if nothing had
 * been asked for. This strip says what happened: "Couldn't open X: reason.
 * Still showing Y.", with Try again and Dismiss (the shared ×; Escape too,
 * through useDismiss).
 *
 * It shows only while Y is still the open model, so it never speaks for a
 * model opened some other way since, and any new open clears it
 * (beginModelOpen).
 *
 * It is a strip in the layout, between the graph toolbar and the canvas, not
 * a layer drawn over the graph: nothing on the graph may be hidden under it.
 * The canvas gives up the strip's height, and GraphCanvas fits the graph to
 * what is left when the strip comes and goes, as it does when a pane is shown
 * or hidden (#226).
 */

import { Button } from "@/components/common/Button";
import { DialogCloseButton } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { useFailedOpenStore } from "@/stores/failedOpenStore";
import { useModelStore } from "@/stores/modelStore";
import { baseName } from "@/utils/modelOpenSequence";

/** Whether the strip is up: a failed open, and the model it names still open. */
export function useFailedOpenShowing(): boolean {
  const failed = useFailedOpenStore((s) => s.failed);
  const shownPath = useModelStore((s) => s.bundleOrigin || s.filePath || null);
  return failed !== null && failed.shownPath === shownPath;
}

export function FailedOpenBanner() {
  const failed = useFailedOpenStore((s) => s.failed);
  const clear = useFailedOpenStore((s) => s.clear);
  const showing = useFailedOpenShowing();

  useDismiss(showing, clear);

  if (!showing || !failed) return null;
  const still = failed.shownPath ? baseName(failed.shownPath) : null;

  return (
    <div
      role="alert"
      data-testid="failed-open-banner"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 8px 5px 12px",
        background: "var(--pnv-danger-tint)",
        borderBottom: "1px solid var(--pnv-danger-border)",
        color: "var(--pnv-danger)",
        fontSize: "var(--pnv-fs-13)",
        lineHeight: 1.5,
      }}
    >
      <span data-testid="failed-open-message" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
        <b>Couldn't open {failed.attempted}:</b> {failed.reason}.
        {still ? (
          <>
            {" "}Still showing <b>{still}</b>.
          </>
        ) : null}
      </span>
      <Button
        kind="small"
        style={{ flexShrink: 0 }}
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
      <DialogCloseButton
        onClick={clear}
        label="Dismiss"
        title="Dismiss (Escape)"
        color="var(--pnv-danger)"
        inline
        opacity={0.7}
        testId="failed-open-dismiss"
      />
    </div>
  );
}
