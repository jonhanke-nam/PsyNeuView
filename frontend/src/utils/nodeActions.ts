/**
 * Shared actions for adding nodes to the model.
 * Used by both PaletteSidebar (click) and GraphCanvas (drag-drop).
 */

import { visibleCentre } from "@/utils/graphViewport";
import { keepAutoLayoutAcrossFold, useModelStore, usesFlatPositions } from "@/stores/modelStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useStatusStore } from "@/stores/statusStore";
import { recordAction } from "@/utils/history";
import { generateDefaultVarName } from "@/utils/defaultNaming";
import { modelLoadOptions, modelViewOptions } from "@/utils/showGraphLoadRequest";
import { useNotificationStore } from "@/stores/notificationStore";
import { withBusy } from "@/stores/busyStore";
import {
  applyView,
  captureView,
  getViewBeforeEntering,
  rebuildGraph,
  setViewBeforeEntering,
} from "@/utils/graphView";

/**
 * Change how a composition is shown and rebuild the graph (#194).
 *
 * `apply` makes the change to the stores; `what` names it for the status bar,
 * the busy wheel and the notice, and `done` is what the History step is
 * called once it has happened, in the Undo and Redo tooltips (#204). A
 * rebuild that fails shows the reason and puts every setting back, so the
 * canvas and the settings still agree: before, the setting stayed changed
 * while the graph showed nothing of it, and the next unrelated rebuild
 * applied it by surprise.
 */
async function changeCompositionView(what: string, done: string, apply: () => void): Promise<void> {
  const before = captureView();
  const { setStatus, clearStatus } = useStatusStore.getState();
  apply();
  setStatus(`${what}…`);
  try {
    const failure = await withBusy(what, rebuildGraph(done));
    if (failure !== null) {
      applyView(before);
      useNotificationStore.getState().addNotification(
        "error",
        `${what} failed: ${failure}. The graph is as it was.`,
      );
    }
  } finally {
    clearStatus();
  }
}

// The flattened and PyTorch views draw every composition as a frame of its
// own, so there is nothing there to fold; folding one shows the model nested,
// with that composition as a single node. The view menu says so.
// An automatic layout stays automatic across that switch (#323).
function leaveFlattenedViews() {
  const gs = useGraphSettings.getState();
  if (gs.flat || gs.pytorch) keepAutoLayoutAcrossFold(true);
  if (gs.flat) gs.setFlat(false);
  if (gs.pytorch) gs.setPytorch(false);
}

/**
 * Fold a composition to a single node, or open a folded one (#395).
 *
 * In a flattened view the frame is open whatever the setting says (the nested
 * view folds compositions on first sight, #395, and that can already be on
 * record), so a press there always folds.
 */
export async function toggleCompositionCollapse(label: string) {
  const gs = useGraphSettings.getState();
  const folding = gs.flat || gs.pytorch || !gs.collapsedCompositions.has(label);
  try {
    await changeCompositionView(
      folding ? `Collapsing ${label}` : `Expanding ${label}`,
      folding ? `Collapsed ${label}` : `Expanded ${label}`,
      () => {
        if (folding) leaveFlattenedViews();
        if (folding === !useGraphSettings.getState().collapsedCompositions.has(label)) {
          useGraphSettings.getState().toggleCollapsedComposition(label);
        }
      },
    );
  } finally {
    // Only for this fold's own build, even when it failed before building.
    keepAutoLayoutAcrossFold(false);
  }
}

// #427 INSET mode: render a nested composition as a framed inset (internals
// laid out independently, treated as one unit by the parent). Pressed again,
// the composition is shown nested as before.
export async function toggleCompositionInset(label: string) {
  const insetting = !useGraphSettings.getState().insetCompositions.has(label);
  await changeCompositionView(
    insetting ? `Insetting ${label}` : `Un-insetting ${label}`,
    insetting ? `Inset ${label}` : `Un-inset ${label}`,
    () => {
      useGraphSettings.getState().toggleInsetComposition(label);
    },
  );
}

// #426 Focus mode, now "Enter" (#194): show a single nested composition on its
// own as the graph root (pass its cleaned label), or leave it (pass null) and
// return to the view that was showing before it was entered.
export async function focusComposition(label: string | null) {
  // The step is named for the composition entered, or the one being left.
  const leaving = useModelStore.getState().focusedComposition;
  await changeCompositionView(
    label ? `Entering ${label}` : "Leaving the composition",
    label ? `Entered ${label}` : leaving ? `Left ${leaving}` : "Left the composition",
    () => {
      const gs = useGraphSettings.getState();
      const model = useModelStore.getState();
      const from = getViewBeforeEntering();
      if (label) {
        if (!model.focusedComposition) setViewBeforeEntering({ flat: gs.flat, pytorch: gs.pytorch });
        leaveFlattenedViews();
      } else if (from) {
        gs.setFlat(from.flat);
        gs.setPytorch(from.pytorch);
        setViewBeforeEntering(null);
      }
      model.setFocusedComposition(label);
    },
  );
}

// #612/#737: rename a node's display name (the PsyNeuLink `name=`) via the
// backend and apply the result. Shared by the Inspector header (#612) and the
// graph context menu (#737) so both surfaces use one implementation. Returns
// null on success, or an error message (e.g. a collision) on failure.
export async function renameNode(
  varName: string,
  currentName: string,
  newName: string,
): Promise<string | null> {
  const existing = useModelStore.getState().nodes
    .filter((n) => n.type === "mechanismNode" || n.type === "compositionNode")
    .map((n) => (n.data as { label?: string } | undefined)?.label)
    .filter((l): l is string => !!l);
  return renameDeclaration(varName, currentName, newName, existing);
}

/**
 * #261: rename an arrow (a projection's `name=`), from its menu or the
 * Inspector's header. The same rename as a node's; its name must differ from
 * the other projections'.
 */
export async function renameProjection(
  varName: string,
  currentName: string,
  newName: string,
): Promise<string | null> {
  const existing = useModelStore.getState().edges
    .filter((e) => e.type === "projectionEdge")
    .map((e) => (e.data as { label?: string } | undefined)?.label)
    .filter((l): l is string => !!l);
  return renameDeclaration(varName, currentName, newName, existing);
}

/** Apply a structural change and load the result; null, or what went wrong. */
async function structuralChange(changes: Record<string, unknown>): Promise<string | null> {
  const { filePath, setSource, loadModelFromServer } = useModelStore.getState();
  if (!filePath) return "No model is open";
  try {
    await useModelStore.getState().flushBuffer();
    const resp = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, changes }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return data.detail || "The file couldn't be changed";
    setSource(data.source);
    loadModelFromServer(data.model, data.layout);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** #261: delete an arrow (a projection) from the file. */
export async function deleteProjection(varName: string, label: string): Promise<string | null> {
  recordAction(`Deleted projection ${label}`);
  return structuralChange({ action: "remove_projection", var_name: varName });
}

/** #261: delete a scheduling arrow: the condition it draws. */
export async function deleteSchedulingCondition(owner: string, gscType: string, target: string): Promise<string | null> {
  recordAction(`Removed ${gscType} condition on ${owner}`);
  return structuralChange({ action: "remove_gsc", owner_var: owner, gsc_type: gscType, target_var: target });
}

async function renameDeclaration(
  varName: string,
  currentName: string,
  newName: string,
  existing: string[],
): Promise<string | null> {
  const trimmed = newName.trim();
  const { filePath, setSource, loadModelFromServer } = useModelStore.getState();
  if (!filePath || !trimmed || trimmed === currentName) return null;
  try {
    // #1029: rename is applied to the file on disk, so unsaved editor text
    // must reach it first or the rename is computed from stale source.
    await useModelStore.getState().flushBuffer();
    const resp = await fetch("/api/model/rename-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath,
        var_name: varName,
        new_name: trimmed,
        existing_names: existing,
        current_name: currentName,
      }),
    });
    const text = await resp.text();
    const data = text ? JSON.parse(text) : {};
    if (!resp.ok) return data.detail || "Rename failed";
    setSource(data.source);
    loadModelFromServer(data.model, data.layout);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * The model's outermost composition: the one no other contains. Not simply the
 * first listed: with the compositions shown flattened, an inner one comes
 * first, and a node added "at the top level" went into it (#252). One is
 * inside another when the other lists it as a node (nested view), or lists
 * all of its nodes as its own (flattened view).
 */
export function outermostComposition(
  comps: { varName?: string; name?: string; nodes?: { name?: string; varName?: string }[] }[],
): string | undefined {
  const names = (c: (typeof comps)[number]) => new Set((c.nodes ?? []).flatMap((n) => [n.name, n.varName]).filter(Boolean) as string[]);
  const inside = (c: (typeof comps)[number], other: (typeof comps)[number]) => {
    if (c === other) return false;
    const theirs = names(other);
    if ((c.varName && theirs.has(c.varName)) || (c.name && theirs.has(c.name))) return true;
    const mine = [...names(c)];
    return mine.length > 0 && mine.length < theirs.size && mine.every((n) => theirs.has(n));
  };
  const outer = comps.find((c) => !comps.some((o) => inside(c, o)));
  return (outer ?? comps[0])?.varName;
}

export async function addNodeToModel(
  filePath: string,
  mechType: string,
  defaults: Record<string, string>,
  setSource: (s: string) => void,
  loadModel: (m: any, l?: any) => void,
  addNotification: (type: any, msg: string) => void,
  // #1159: where the user dropped it, in flow coordinates. Dragging from the
  // palette is the one moment they say exactly where a node goes, and without
  // this the coordinates were discarded and the node appeared wherever the
  // layout engine put it.
  dropPosition?: { x: number; y: number },
  // #252: the composition to add it to (its variable name), when the user
  // put it inside one; otherwise the model's top-level composition. With
  // one, dropPosition is relative to that composition's frame.
  composition?: string,
) {
  // #181: auto-generate `New_<Type>_<n>` against names already declared
  // in the active file (lineMap is the authoritative source). User renames
  // afterwards via the inspector — see issue body for the rationale.
  const existingNames = Object.keys(useModelStore.getState().lineMap);
  const varName = generateDefaultVarName(mechType, existingNames);
  // #252: nothing the user creates appears off-screen. With no point chosen
  // (a menu, a shortcut, the assistant), it goes in the middle of the graph
  // as it is showing, not wherever the layout would put it.
  dropPosition = dropPosition ?? visibleCentre() ?? undefined;

  // #252: putting a node down where you chose, like dragging one, makes the
  // layout Custom where it stands. In Auto, the reload would lay everything
  // out again and the new node would go wherever the layout engine put it.
  if (dropPosition && useModelStore.getState().autoLayout) useModelStore.getState().setAutoLayout(false);

  const { setStatus, clearStatus } = useStatusStore.getState();
  setStatus(`Adding ${mechType}: ${varName}…`);

  // Find the composition name
  const resp = await fetch("/api/model/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath, ...modelLoadOptions() }),
  });
  const loadData = await resp.json();
  const compVarName = composition ?? outermostComposition(loadData.model?.compositions ?? []);

  try {
    const result = await fetch("/api/model/structural-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_path: filePath, ...modelViewOptions(),
        changes: {
          action: "add_node",
          var_name: varName,
          type: mechType,
          params: defaults,
          composition: compVarName,
        },
      }),
    });
    if (!result.ok) {
      const err = await result.json();
      addNotification("error", `Failed to add node: ${err.detail}`);
      return;
    }
    const data = await result.json();

    // Record the drop position before the model loads, so the rebuild finds it
    // already saved and the node is not treated as one we have never placed
    // (#1159). varName is generated above, so we know the key without having to
    // discover what the new node ended up being called.
    if (dropPosition) {
      await saveDroppedPosition(filePath, varName, dropPosition);
    }

    // The reply's layout was read before the drop position was saved, so it
    // doesn't have the new node: loaded as it is, the node counted as never
    // placed and went wherever the layout put it (in Like show_graph, a
    // column to the right of the graph). Load it with the position (#252).
    const key = usesFlatPositions() ? "flatPositions" : "positions";
    const layout = dropPosition
      ? { ...(data.layout ?? {}), [key]: { ...(data.layout?.[key] ?? {}), [varName]: dropPosition } }
      : data.layout;

    setSource(data.source);
    loadModel(data.model, layout);
    recordAction(`Added ${mechType} "${varName}"`);
    addNotification("success", `Added ${mechType} "${varName}"`);
  } catch (e) {
    addNotification("error", `Failed to add node: ${e}`);
  } finally {
    clearStatus();
  }
}

/**
 * Persist a just-dropped node's position (#1159).
 *
 * Merged over what is already saved rather than sent alone: save-layout takes
 * a whole map per view, so posting one entry would drop every other node's
 * position.
 *
 * Written even in auto-layout mode. The position is the user's answer to
 * "where does this go", and discarding it because a view setting happens to be
 * on would lose it silently the moment they switch to custom.
 */
async function saveDroppedPosition(
  filePath: string,
  varName: string,
  position: { x: number; y: number },
) {
  // The namespace the store reads (#719): the flat one only when the view is
  // flat AND the model nests something (#48). Keyed by the view setting
  // alone, a drop on a model with no nesting was saved where it's never read.
  const flat = usesFlatPositions();
  const merged = {
    ...useModelStore.getState().lastLayoutPositions,
    [varName]: { x: position.x, y: position.y },
  };
  useModelStore.setState({ lastLayoutPositions: merged });
  try {
    await fetch("/api/model/save-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        flat
          ? { file_path: filePath, flatPositions: merged }
          : { file_path: filePath, positions: merged },
      ),
    });
  } catch {
    // A lost position is not worth failing the add over — the node still
    // arrives, just where the engine puts it.
  }
}

