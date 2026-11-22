import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { applyTutorialView, applyTutorialViewModes, resetTutorialViewForTests, restoreTutorialView } from "./tutorialView";

const reloadView = vi.fn(async () => {});
const g = () => useGraphSettings.getState();

describe("the graph's view during a tutorial (#172)", () => {
  beforeEach(() => {
    resetTutorialViewForTests();
    useGraphSettings.setState(useGraphSettings.getInitialState());
    useCatalogOpener.setState({ reloadView });
    reloadView.mockClear();
    useModelStore.setState({ filePath: "/t.py", source: "a", savedSource: "a" });
  });

  it("shows the graph as a fresh window does, and puts the learner's choices back", () => {
    useGraphSettings.setState({ showNodeNames: false, direction: "LR", collapsedCompositions: new Set(["inner"]) });
    applyTutorialView();
    expect(g().showNodeNames).toBe(true);
    expect(g().direction).toBe("BT");
    expect(g().collapsedCompositions.size).toBe(0);
    restoreTutorialView();
    expect(g().showNodeNames).toBe(false);
    expect(g().direction).toBe("LR");
    expect([...g().collapsedCompositions]).toEqual(["inner"]);
    expect(reloadView).not.toHaveBeenCalled();
  });

  it("sets what the server draws only as it opens its model, and reloads to put it back", () => {
    useGraphSettings.setState({ flat: false, pytorch: true, showController: false });
    applyTutorialView();
    expect(g()).toMatchObject({ pytorch: true, showController: false });
    applyTutorialViewModes();
    expect(g()).toMatchObject({ flat: true, pytorch: false, showController: true });
    restoreTutorialView();
    expect(g()).toMatchObject({ flat: false, pytorch: true, showController: false });
    expect(reloadView).toHaveBeenCalledTimes(1);
  });

  it("leaves the model's view as drawn when it has unsaved changes", () => {
    useGraphSettings.setState({ flat: false });
    applyTutorialView();
    applyTutorialViewModes();
    useModelStore.setState({ source: "edited" });
    restoreTutorialView();
    expect(g().flat).toBe(true);
    expect(reloadView).not.toHaveBeenCalled();
  });

  it("remembers both, whichever comes first", () => {
    useGraphSettings.setState({ showNodeNames: false, flat: false });
    applyTutorialViewModes();
    applyTutorialView();
    expect(g()).toMatchObject({ showNodeNames: true, flat: true });
    restoreTutorialView();
    expect(g()).toMatchObject({ showNodeNames: false, flat: false });
  });

  it("doesn't reload when another tutorial is starting", () => {
    useGraphSettings.setState({ flat: false });
    applyTutorialView();
    applyTutorialViewModes();
    restoreTutorialView({ anotherStarting: true });
    expect(reloadView).not.toHaveBeenCalled();
  });

  it("does nothing when no tutorial changed the view", () => {
    useGraphSettings.setState({ showNodeNames: false });
    restoreTutorialView();
    expect(g().showNodeNames).toBe(false);
  });
});
