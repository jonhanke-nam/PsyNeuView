import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import {
  applyTutorialView,
  applyTutorialViewModes,
  resetTutorialViewForTests,
  restoreTutorialView,
  viewsDrawAlike,
} from "./tutorialView";

const reloadView = vi.fn(async () => {});
/** A model the views draw differently: a composition nested in another. */
const NESTED_MODEL = {
  compositionOptions: [
    { value: "outer", label: "outer", depth: 0, nested: false },
    { value: "inner", label: "inner", depth: 1, nested: true },
  ],
  compositionMeta: { outer: { type: "Composition", isAutodiff: false }, inner: { type: "Composition", isAutodiff: false } },
  nodes: [{ id: "inner", position: { x: 0, y: 0 }, type: "mechanismNode", data: { type: "Composition" } }],
};
/** One composition, nothing nested (Stroop): every view draws it the same. */
const PLAIN_MODEL = {
  compositionOptions: [{ value: "stroop", label: "stroop", depth: 0, nested: false }],
  compositionMeta: { stroop: { type: "Composition", isAutodiff: false } },
  nodes: [{ id: "color", position: { x: 0, y: 0 }, type: "mechanismNode", data: { type: "TransferMechanism" } }],
};
const g = () => useGraphSettings.getState();

describe("the graph's view during a tutorial (#172)", () => {
  beforeEach(() => {
    resetTutorialViewForTests();
    useGraphSettings.setState(useGraphSettings.getInitialState());
    useCatalogOpener.setState({ reloadView });
    reloadView.mockClear();
    useModelStore.setState({ filePath: "/t.py", source: "a", savedSource: "a", ...NESTED_MODEL });
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

describe("a walkthrough's own view (#428)", () => {
  beforeEach(() => {
    resetTutorialViewForTests();
    useGraphSettings.setState(useGraphSettings.getInitialState());
    useCatalogOpener.setState({ reloadView });
    reloadView.mockClear();
    useModelStore.setState({ filePath: "/t.py", source: "a", savedSource: "a", ...NESTED_MODEL });
  });

  it("opens its model in the view it names, with its folds, and gives the learner's back", () => {
    expect(g().flat).toBe(true);
    applyTutorialView({ view: "nested", compositions: { EM: "folded" } }, { opensOnStart: true });
    // Its model is about to open: nothing is redrawn under the old one.
    expect(reloadView).not.toHaveBeenCalled();
    applyTutorialViewModes({ view: "nested", compositions: { EM: "folded" } });
    expect(g()).toMatchObject({ flat: false, pytorch: false });
    expect(g().collapsedCompositions.has("EM")).toBe(true);
    expect(g().seededCollapseDefaults.has("EM")).toBe(true);
    restoreTutorialView();
    expect(g()).toMatchObject({ flat: true, pytorch: false });
    expect(reloadView).toHaveBeenCalledTimes(1);
  });

  it("redraws the model on screen in its view when it opens none on start", () => {
    applyTutorialView({ view: "pytorch" });
    expect(g()).toMatchObject({ flat: false, pytorch: true });
    expect(reloadView).toHaveBeenCalledTimes(1);
    restoreTutorialView();
    expect(g()).toMatchObject({ flat: true, pytorch: false });
    expect(reloadView).toHaveBeenCalledTimes(2);
  });

  it("leaves the view alone over unsaved changes, so the menu still says how the model is drawn", () => {
    useModelStore.setState({ source: "edited" });
    applyTutorialView({ view: "nested" });
    expect(g().flat).toBe(true);
    expect(reloadView).not.toHaveBeenCalled();
  });

  it("an open composition stays open, though the nested view folds on first sight", () => {
    useGraphSettings.setState({ collapsedCompositions: new Set(["inner"]) });
    applyTutorialViewModes({ view: "nested", compositions: { inner: "open" } });
    expect(g().collapsedCompositions.has("inner")).toBe(false);
    expect(g().seededCollapseDefaults.has("inner")).toBe(true);
  });
});

describe("no redraw when the views draw the same graph (#428)", () => {
  const nested = { flat: false, pytorch: false, showCIMs: false };
  const flat = { flat: true, pytorch: false, showCIMs: false };
  const pytorch = { flat: false, pytorch: true, showCIMs: false };
  const autodiff = { ...PLAIN_MODEL, compositionMeta: { stroop: { type: "AutodiffComposition", isAutodiff: true } } };

  it("decides alike only when nothing nested, one composition, no interface mechanisms, no autodiff", () => {
    expect(viewsDrawAlike(nested, flat, PLAIN_MODEL)).toBe(true);
    expect(viewsDrawAlike(nested, pytorch, PLAIN_MODEL)).toBe(true);
    expect(viewsDrawAlike(flat, pytorch, PLAIN_MODEL)).toBe(true);
    expect(viewsDrawAlike(nested, flat, NESTED_MODEL)).toBe(false);
    expect(viewsDrawAlike(nested, pytorch, NESTED_MODEL)).toBe(true);
    expect(viewsDrawAlike(nested, pytorch, autodiff)).toBe(false);
    expect(viewsDrawAlike(nested, flat, autodiff)).toBe(true);
    // The flattened view has no interface mechanisms; the nested view shows them.
    expect(viewsDrawAlike({ ...nested, showCIMs: true }, { ...flat, showCIMs: true }, PLAIN_MODEL)).toBe(false);
    // Two top-level compositions: flattened draws them together.
    const two = { ...PLAIN_MODEL, compositionOptions: [...PLAIN_MODEL.compositionOptions, { value: "b", label: "b", depth: 0, nested: false }] };
    expect(viewsDrawAlike(nested, flat, two)).toBe(false);
    // Flattened, the view menu lists only the top composition (EGO), but EM's frame is drawn.
    const flattenedEgo = { ...PLAIN_MODEL, nodes: [{ id: "cluster::EM", position: { x: 0, y: 0 }, type: "compositionNode", data: {} }] };
    expect(viewsDrawAlike(flat, nested, flattenedEgo)).toBe(false);
  });

  beforeEach(() => {
    resetTutorialViewForTests();
    useGraphSettings.setState(useGraphSettings.getInitialState());
    useCatalogOpener.setState({ reloadView });
    reloadView.mockClear();
    useModelStore.setState({ filePath: "/stroop.py", source: "a", savedSource: "a", ...PLAIN_MODEL });
  });

  it("starting and ending a walkthrough on such a model changes the setting and redraws nothing", () => {
    applyTutorialView({ view: "nested" });
    expect(g().flat).toBe(false);
    applyTutorialViewModes({ view: "nested" });
    restoreTutorialView();
    expect(g().flat).toBe(true);
    expect(reloadView).not.toHaveBeenCalled();
  });

  it("still redraws when something else the server draws for changes back", () => {
    useGraphSettings.setState({ showController: false });
    applyTutorialView({ view: "nested" });
    applyTutorialViewModes({ view: "nested" });
    restoreTutorialView();
    expect(g()).toMatchObject({ flat: true, showController: false });
    expect(reloadView).toHaveBeenCalledTimes(1);
  });
});
