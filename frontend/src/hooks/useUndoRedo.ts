/**
 * Undo and redo, as actions the shortcut registry can own. (#1112)
 *
 * This was a `window` keydown listener that did its own key matching, its own
 * text-field exclusion, and its own deliberate override of CodeMirror. The
 * matching and the scoping now live in the registry — `scope: "codeEditorToo"`
 * is what encodes "yes, take Cmd+Z inside the editor too" — leaving this file
 * with only the part that was ever specific to undo.
 */

import { useModelStore } from "@/stores/modelStore";
import { useHistoryStore, type Snapshot } from "@/stores/historyStore";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  continuingBurst,
  historyNoticeText,
  HISTORY_NOTICE_KEY,
  noteMove,
  NOTHING_MS,
  NOTICE_MS,
  reverseLabel,
  type Burst,
  type HistoryMoveOrigin,
} from "@/utils/historyNotice";

/** Apply one step of history. `redo` picks the direction. */
export function applyHistoryStep(redo: boolean): Promise<void> {
  return moveInHistory(redo, 1, "step");
}

/**
 * Go to History's step `index` (0 is the first, in past-then-future order):
 * undo or redo everything between here and there, as one action with one
 * notice ("Went back 20 steps, to Edit 37"). #1377.
 */
export function goToHistoryStep(index: number): Promise<void> {
  const delta = index - (useHistoryStore.getState().past.length - 1);
  if (delta === 0) return Promise.resolve();
  return moveInHistory(delta > 0, Math.abs(delta), "jump");
}

/** What a step is called in a notice; the first step is "the start". */
function stepName(step: Snapshot | undefined, first: boolean): string {
  if (first) return "the start";
  return step?.description || "an action";
}

/**
 * The one notice undo and redo share (#1377): a burst of steps is one
 * notice, replaced in place as the burst grows, with a button that takes
 * the whole burst back the other way.
 */
function showMoveNotice(b: Burst, single: string) {
  const { past } = useHistoryStore.getState();
  const target = stepName(past[past.length - 1], past.length === 1);
  const back = reverseLabel(b);
  const count = b.count;
  const redoBack = b.direction === "undo";
  useNotificationStore.getState().addNotification("info", historyNoticeText(b, target, single), {
    key: HISTORY_NOTICE_KEY,
    durationMs: NOTICE_MS,
    action: {
      label: back.label,
      title: back.title,
      testId: "history-notice-reverse",
      onClick: () => void moveInHistory(redoBack, count, "notice"),
    },
  });
}

/**
 * Undo (`redo` false) or redo `steps` steps, apply where that leaves the
 * model, and say so in the shared notice. `origin` says how it was asked
 * for: a ⌘Z or toolbar step joins the burst in progress; a History jump or
 * a notice's button is one action of its own.
 */
export async function moveInHistory(redo: boolean, steps: number, origin: HistoryMoveOrigin): Promise<void> {
  const history = useHistoryStore.getState();
  const notifications = useNotificationStore.getState();
  const direction = redo ? "redo" : "undo";
  const before = history.past.length;

  // What a single step's notice names: the step undone, or the step redone.
  const single = redo ? history.redoDescription() : history.undoDescription();
  const result = history.move(redo ? steps : -steps);
  if (!result) {
    // Holding ⌘Z past the start keeps the burst's notice; otherwise say so.
    if (!continuingBurst(direction, before)) {
      notifications.addNotification("info", redo ? "Nothing to redo" : "Nothing to undo", {
        key: HISTORY_NOTICE_KEY,
        durationMs: NOTHING_MS,
      });
    }
    return;
  }
  const snapshot = result.snapshot;
  const burst = noteMove(direction, result.moved, origin, before, useHistoryStore.getState().past.length);
  showMoveNotice(burst, single || "action");
  const addNotification = notifications.addNotification;

  if (!snapshot) return;

  // Never apply a snapshot belonging to a different model. The history is
  // cleared when a model is opened (#1091), so this should not trigger —
  // it is here because the failure it prevents is the alarming one: the
  // user believes they are editing one model and ends up in another.
  // Refusing loudly beats silently swapping the file under them.
  const currentPath = useModelStore.getState().filePath;
  if (snapshot.filePath && currentPath && snapshot.filePath !== currentPath) {
    addNotification(
      "error",
      "That undo step belongs to a different model, so it wasn't applied."
    );
    history.clear();
    return;
  }

  // Mark as restoring so pushSnapshot doesn't record this change
  history.setRestoring(true);

  try {
    // Restore state
    const store = useModelStore.getState();
    store.setSource(snapshot.source);
    if (snapshot.compact) {
      // A compact step (#558) kept its code and positions but not its graph:
      // the nodes on screen move to where they were, and the graph is
      // rebuilt from the code below.
      if (snapshot.positions && !store.autoLayout) store.applyLayoutPositions(snapshot.positions);
    } else {
      store.setNodes(snapshot.nodes);
      store.setEdges(snapshot.edges);
    }

    const filePath = snapshot.filePath || store.filePath;
    if (filePath) {
      // The layout sidecar is written, as a node move is when it is made.
      if (snapshot.positions) {
        await fetch("/api/model/save-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_path: filePath,
            positions: snapshot.positions,
          }),
        }).catch(() => {});
      }

      // The .py file is not (#1349). Undo changes the model in PsyNeuView;
      // the file on disk stays as it was until you save, so undoing past a
      // save leaves the model unsaved, and writing it is always your choice
      // (Save, or History's "Revert the file to this save"). Undo used to
      // write the restored text here while still showing it as unsaved, so
      // the next Save found the file "changed on disk" and asked about a
      // change PsyNeuView had made itself.
      //
      // Instead the restored text is previewed, as typing is (#1029): Run
      // and Learn use the preview copy, so they run what you see.
      await previewRestored(filePath, snapshot.source, snapshot.compact ? snapshot.positions : undefined);
    }
  } finally {
    // Allow recording again after a short delay
    // (the preview's model load records a step a tick later)
    setTimeout(() => history.setRestoring(false), 2000);
  }
}

/**
 * Build the restored text from the private preview copy, never the user's file.
 *
 * `rebuild` is given for a compact step (#558): it has no graph of its own,
 * so the graph is built from its code even when that code is what is on
 * disk, and then laid out at the step's positions.
 */
async function previewRestored(
  filePath: string,
  source: string,
  rebuild?: Record<string, { x: number; y: number }>,
): Promise<void> {
  const now = useModelStore.getState();
  const onDisk = source === now.savedSource;
  if (onDisk) {
    // Back to what is on disk: run the file itself again.
    if (now.previewPath) useModelStore.setState({ previewPath: null });
    if (!rebuild) return;
  }
  try {
    const resp = await fetch("/api/model/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, source }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    // Another undo, an edit or a different model since: this answer is stale.
    const after = useModelStore.getState();
    if (after.filePath !== filePath || after.source !== source) return;
    if (after.savedSource === source && !onDisk) return;
    after.applyPreviewModel(data.model, data.preview_path, source);
    // The code on disk, rebuilt: the graph, but the file itself is what runs.
    if (onDisk) useModelStore.setState({ previewPath: null });
    if (rebuild && !useModelStore.getState().autoLayout) useModelStore.getState().applyLayoutPositions(rebuild);
  } catch {
    // The graph from the snapshot stays; the next edit previews again.
  }
}
