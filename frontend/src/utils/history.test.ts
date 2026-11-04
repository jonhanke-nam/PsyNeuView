/**
 * What recordAction puts in the activity log (#177, #204): an edit the user
 * made is logged as one, for problem reports; the app's own steps, a model
 * loading or a frame button changing the view, are History steps but not
 * edits. The step keeps its name either way, for the Undo and Redo tooltips.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useHistoryStore } from "@/stores/historyStore";
import { useModelStore } from "@/stores/modelStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { activityEntries, clearActivity } from "./activityLog";
import { recordAction, recordInitialState } from "./history";

const edits = () => activityEntries().filter((e) => e.kind === "edit").map((e) => e.text);
const steps = () => useHistoryStore.getState().past.map((s) => s.description);

describe("recordAction and the activity log", () => {
  beforeEach(() => {
    clearActivity();
    useHistoryStore.getState().clear();
    useModelStore.setState({ source: "a = 1", nodes: [], edges: [], filePath: "/m.py", focusedComposition: null });
    useGraphSettings.setState({ flat: false, pytorch: false, collapsedCompositions: new Set(), insetCompositions: new Set() });
  });

  it("logs an edit the user made, by its description", () => {
    recordInitialState();
    useModelStore.setState({ source: "a = 2" });
    recordAction("Modified gain in hidden_layer");
    expect(edits()).toEqual(["Modified gain in hidden_layer"]);
    expect(steps()).toEqual(["Model loaded", "Modified gain in hidden_layer"]);
  });

  it("does not log a load, or a frame button's change of view, as an edit (#204)", () => {
    recordInitialState();
    useModelStore.setState({ source: "a = 2" });
    recordAction("Model updated", { edit: false });
    // Entering a composition keeps the code; the step differs only by view.
    useModelStore.setState({ focusedComposition: "EM" });
    recordAction("Entered EM", { edit: false });
    useGraphSettings.setState({ insetCompositions: new Set(["EM"]) });
    recordAction("Inset EM", { edit: false });

    expect(edits()).toEqual([]);
    // The steps are there under their names, for the Undo and Redo tooltips.
    expect(steps()).toEqual(["Model loaded", "Model updated", "Entered EM", "Inset EM"]);
    expect(useHistoryStore.getState().undoDescription()).toBe("Inset EM");
  });
});
