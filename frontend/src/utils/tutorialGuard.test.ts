import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTourStore } from "@/stores/tourStore";
import { shouldOfferOrientation } from "./orientationOffer";
import { windowRequest } from "./appWindow";
import {
  chooseTutorialStart,
  discardIsApproved,
  followSavedCopy,
  guardOpen,
  isSameFile,
  isTutorialCopy,
  needsModel,
  noteNewModel,
  noteTutorialModel,
  offerToSave,
  offTutorialModel,
  startTutorialOver,
  stepAsksFor,
  tutorialCopyFor,
  undoStepEdits,
  useTutorialChoice,
  windowUrlFor,
  type PendingChoice,
} from "./tutorialGuard";
import { WALKTHROUGHS, type TourStep } from "./tourStep";

// The app's window: opening one is checked in the browser, by the e2e spec.
const openWindow = vi.fn(() => null as unknown);
// Save, as the code editor answers it: writes the text it is given, or the editor's.
const saveListener = vi.fn((e: { detail?: { accepted?: boolean; done?: () => void; source?: string } }) => {
  const d = e.detail;
  if (!d) return;
  d.accepted = true;
  const text = d.source ?? useModelStore.getState().source;
  useModelStore.setState({ source: text, savedSource: text });
  d.done?.();
});
vi.stubGlobal("window", {
  location: { origin: "", pathname: "/" },
  open: openWindow,
  dispatchEvent: (e: unknown) => {
    saveListener(e as never);
    return true;
  },
});
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
});

const step = (opens: string) => ({ opens }) as TourStep;
const pending = () => useTutorialChoice.getState().pending as PendingChoice;
// The choice appears after guardOpen's first await has run.
const answer = async (choice: string) => {
  await vi.waitFor(() => expect(useTutorialChoice.getState().pending).not.toBeNull());
  (pending().resolve as (c: string) => void)(choice);
};

function openModel(filePath: string | null, { edited = false, untouched = false } = {}) {
  useModelStore.setState({ filePath, source: edited ? "b" : "a", savedSource: "a" });
  useCatalogOpener.setState({ isUntouched: () => untouched, isOpen: () => false });
}

describe("what the guard looks at", () => {
  it("knows which walkthroughs depend on a model", () => {
    expect(needsModel(WALKTHROUGHS["stroop"])).toBe(true);
    expect(needsModel(WALKTHROUGHS["pnl-mechanism"])).toBe(true);
    expect(needsModel(WALKTHROUGHS["orientation-settings"])).toBe(false);
  });

  it("lets a step open only what it asks for", () => {
    const open = step("Stroop — Basic");
    expect(stepAsksFor(open, { kind: "catalog", label: "Stroop — Basic" })).toBe(true);
    expect(stepAsksFor(open, { kind: "catalog", label: "EGO" })).toBe(false);
    expect(stepAsksFor(open, { kind: "newModel" })).toBe(false);
    expect(stepAsksFor(step("new model"), { kind: "newModel" })).toBe(true);
    expect(stepAsksFor(null, { kind: "newModel" })).toBe(false);
  });

  it("treats the open file as no change", () => {
    expect(isSameFile({ kind: "path", path: "/a/m.py" }, "/a/m.py")).toBe(true);
    expect(isSameFile({ kind: "path", path: "/b/m.py" }, "/a/m.py")).toBe(false);
    expect(isSameFile({ kind: "catalog", label: "M", file: "/demos/m.py" }, "/work/m.py")).toBe(true);
    expect(isSameFile({ kind: "newModel" }, "/a/m.py")).toBe(false);
  });

  it("round-trips a target through a new window's address", () => {
    const path = "/Users/me/my model.py";
    const address = windowUrlFor({ kind: "path", path })!;
    expect(address).not.toContain("model.py");
    expect(windowRequest(address)).toEqual({ path });
    // Once only, so reloading that window doesn't open it again.
    expect(windowRequest(address)).toBeNull();
    expect(windowRequest(windowUrlFor({ kind: "catalog", label: "Stroop — Basic" })!)).toEqual({ model: "Stroop — Basic" });
    expect(windowRequest(windowUrlFor({ kind: "newModel" })!)).toEqual({ newModel: true });
    expect(windowUrlFor({ kind: "file", name: "dropped.py" })).toBeNull();
    expect(windowRequest("?tour=ddm")).toBeNull();
  });

  it("won't open a file named in the address", () => {
    expect(windowRequest(`?open=${encodeURIComponent("/tmp/from-a-link.py")}`)).toBeNull();
  });

  it("doesn't make the first-launch offer over a window with a job to do", () => {
    expect(shouldOfferOrientation(null, "?openModel=Stroop")).toBe(false);
    expect(shouldOfferOrientation(null, "?newModel=1")).toBe(false);
    expect(shouldOfferOrientation(null, "")).toBe(true);
  });
});

describe("opening something during a walkthrough", () => {
  beforeEach(() => {
    useTutorialChoice.setState({ pending: null });
    useTourStore.setState({ activeTourId: null, stepIndex: 0 });
    openModel("/work/stroop_basic.py");
  });

  it("doesn't ask with no walkthrough, or one that uses no model", async () => {
    await expect(guardOpen({ kind: "newModel" })).resolves.toBe(true);
    useTourStore.setState({ activeTourId: "orientation-settings" });
    await expect(guardOpen({ kind: "newModel" })).resolves.toBe(true);
    expect(useTutorialChoice.getState().pending).toBeNull();
  });

  it("stays on Stay here, and leaves on Leave", async () => {
    useTourStore.setState({ activeTourId: "stroop", stepIndex: 2 });
    let result = guardOpen({ kind: "path", path: "/mine/other.py" });
    await answer("stay");
    await expect(result).resolves.toBe(false);
    expect(useTourStore.getState().activeTourId).toBe("stroop");

    result = guardOpen({ kind: "path", path: "/mine/other.py" });
    await answer("here");
    await expect(result).resolves.toBe(true);
    expect(useTourStore.getState().activeTourId).toBeNull();
  });

  it("names the step, and offers no window for a file only this one holds", async () => {
    useTourStore.setState({ activeTourId: "stroop", stepIndex: 2 });
    const result = guardOpen({ kind: "file", name: "dropped.py" });
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending).not.toBeNull());
    const p = pending();
    expect(p).toMatchObject({ type: "leave", step: 3, what: "dropped.py", canOpenWindow: false });
    await answer("stay");
    await result;
  });
});

describe("when a browser blocks the new window", () => {
  it("says so, and leaves the walkthrough where it was", async () => {
    useTutorialChoice.setState({ pending: null });
    useTourStore.setState({ activeTourId: "stroop", stepIndex: 2 });
    openModel("/work/stroop_basic.py");
    openWindow.mockReturnValueOnce(null);
    const result = guardOpen({ kind: "newModel" });
    await answer("newWindow");
    await expect(result).resolves.toBe(false);
    expect(openWindow).toHaveBeenCalledWith("/?newModel=1", "_blank");
    expect(useNotificationStore.getState().notifications.slice(-1)[0]?.message).toMatch(/didn't open/);
    expect(useTourStore.getState().activeTourId).toBe("stroop");
  });
});

describe("starting a walkthrough", () => {
  beforeEach(() => {
    useTutorialChoice.setState({ pending: null });
    useTourStore.setState({ activeTourId: null, stepIndex: 0 });
  });
  const started = () => useTourStore.getState().activeTourId;

  it("uses this window when nothing is in progress", async () => {
    openModel(null);
    await chooseTutorialStart("stroop");
    expect(started()).toBe("stroop");

    useTourStore.setState({ activeTourId: null });
    openModel("/work/stroop_basic.py", { untouched: true });
    await chooseTutorialStart("stroop");
    expect(started()).toBe("stroop");
  });

  it("asks when your own model or unsaved work is open", async () => {
    openModel("/mine/model.py");
    let result = chooseTutorialStart("stroop");
    await answer("cancel");
    await result;
    expect(started()).toBeNull();

    openModel("/work/stroop_basic.py", { untouched: true, edited: true });
    result = chooseTutorialStart("stroop");
    await answer("here");
    // Replacing unsaved work offers to save it first (#172).
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending?.type).toBe("save"));
    await answer("discard");
    await result;
    expect(started()).toBe("stroop");
  });

  it("asks when another walkthrough is running, not when restarting the same one", async () => {
    openModel(null);
    useTourStore.setState({ activeTourId: "stroop" });
    await chooseTutorialStart("stroop");
    expect(useTutorialChoice.getState().pending).toBeNull();

    const result = chooseTutorialStart("orientation-settings");
    await answer("cancel");
    await result;
    expect(started()).toBe("stroop");
  });

  it("doesn't ask about a model when the walkthrough uses none", async () => {
    openModel("/mine/model.py");
    await chooseTutorialStart("orientation-settings");
    expect(started()).toBe("orientation-settings");
  });

  it("offers a second window over your own copy of its model, which it doesn't touch", async () => {
    openModel("/work/stroop_basic.py");
    useCatalogOpener.setState({ isOpen: () => true });
    const result = chooseTutorialStart("stroop");
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending).not.toBeNull());
    expect((pending() as Extract<PendingChoice, { type: "start" }>).noWindowReason).toBeNull();
    await answer("cancel");
    await result;
  });

  it("offers no second window when its own copy is the file open here", async () => {
    openModel("/work/tutorials/stroop/stroop_basic.py");
    const result = chooseTutorialStart("stroop");
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending).not.toBeNull());
    expect((pending() as Extract<PendingChoice, { type: "start" }>).noWindowReason).toMatch(/can't run in a second window/);
    await answer("cancel");
    await result;
  });
});

describe("the walkthrough's own model (#172)", () => {
  beforeEach(() => {
    useTutorialChoice.setState({ pending: null });
    useTourStore.getState().stopTour();
  });

  it("opens a fresh copy for its own model, or the one a step teaches opening", () => {
    expect(tutorialCopyFor("Stroop — Basic")).toBeNull();
    useTourStore.getState().startTour("stroop");
    expect(tutorialCopyFor("Stroop — Basic")).toBe("stroop");
    expect(tutorialCopyFor("Hopfield Network")).toBeNull();
    useTourStore.getState().startTour("orientation-open");
    const teaching = WALKTHROUGHS["orientation-open"].steps.findIndex((s) => s.opens === "Stroop — Basic");
    useTourStore.setState({ stepIndex: teaching });
    expect(tutorialCopyFor("Stroop — Basic")).toBe("orientation-open");
  });

  it("remembers its model, and follows it to a saved copy", () => {
    useTourStore.getState().startTour("stroop");
    noteTutorialModel("/work/tutorials/stroop/s.py", { copy: true });
    expect(useTourStore.getState().modelPath).toBe("/work/tutorials/stroop/s.py");
    expect(isTutorialCopy("/work/tutorials/stroop/s.py")).toBe(true);
    followSavedCopy("/elsewhere.py", "/x.py");
    expect(useTourStore.getState().modelPath).toBe("/work/tutorials/stroop/s.py");
    followSavedCopy("/work/tutorials/stroop/s.py", "/mine/s_copy.py");
    expect(useTourStore.getState().modelPath).toBe("/mine/s_copy.py");
  });

  it("takes a New Model as its model only on the step that teaches it", () => {
    useTourStore.getState().startTour("ddm");
    noteNewModel("/mine/ddm_demo.py");
    expect(useTourStore.getState().modelPath).toBe("/mine/ddm_demo.py");
    useTourStore.getState().startTour("stroop");
    noteNewModel("/mine/other.py");
    expect(useTourStore.getState().modelPath).toBeNull();
  });

  it("knows when the window has moved off it", () => {
    const w = WALKTHROUGHS.stroop;
    expect(offTutorialModel(w, null, "/a.py")).toBe(false);
    expect(offTutorialModel(w, "/t.py", "/t.py")).toBe(false);
    expect(offTutorialModel(w, "/t.py", "/a.py")).toBe(true);
    expect(offTutorialModel(w, "/t.py", null)).toBe(true);
    expect(offTutorialModel(WALKTHROUGHS["orientation-settings"], "/t.py", "/a.py")).toBe(false);
  });

  it("doesn't ask about going back to its own model", async () => {
    useTourStore.getState().startTour("stroop");
    useTourStore.setState({ stepIndex: 2, modelPath: "/work/tutorials/stroop/s.py" });
    openModel("/mine/other.py");
    await expect(guardOpen({ kind: "path", path: "/work/tutorials/stroop/s.py" })).resolves.toBe(true);
    expect(useTutorialChoice.getState().pending).toBeNull();
  });

  it("undoes the step's edits through Save", async () => {
    useTourStore.getState().startTour("stroop");
    useModelStore.setState({ filePath: "/t.py", source: "edited", savedSource: "edited" });
    useTourStore.setState({ stepStart: { key: "k", filePath: "/t.py", source: "as the step began" } });
    await expect(undoStepEdits()).resolves.toBe(true);
    expect(useModelStore.getState().source).toBe("as the step began");
    expect(useModelStore.getState().savedSource).toBe("as the step began");
  });

  it("won't undo onto another file", async () => {
    useModelStore.setState({ filePath: "/other.py", source: "x", savedSource: "x" });
    useTourStore.setState({ stepStart: { key: "k", filePath: "/t.py", source: "y" } });
    await expect(undoStepEdits()).resolves.toBe(false);
    expect(useModelStore.getState().source).toBe("x");
  });

  it("starts over from step 1", () => {
    useTourStore.getState().startTour("stroop");
    useTourStore.setState({ stepIndex: 4, modelPath: "/t.py" });
    const before = useTourStore.getState().startCount;
    startTutorialOver();
    expect(useTourStore.getState()).toMatchObject({ activeTourId: "stroop", stepIndex: 0, modelPath: null, startCount: before + 1 });
  });
});

describe("replacing unsaved work (#172)", () => {
  beforeEach(() => {
    useTutorialChoice.setState({ pending: null });
    useTourStore.getState().stopTour();
  });

  it("doesn't ask with nothing unsaved", async () => {
    openModel("/mine/model.py");
    await expect(offerToSave()).resolves.toBe(true);
    expect(useTutorialChoice.getState().pending).toBeNull();
  });

  it("saves first when asked to", async () => {
    openModel("/mine/model.py", { edited: true });
    const result = offerToSave();
    await answer("save");
    await expect(result).resolves.toBe(true);
    expect(useModelStore.getState().savedSource).toBe("b");
  });

  it("goes ahead without saving, and doesn't ask again about the same changes", async () => {
    openModel("/mine/model.py", { edited: true });
    expect(discardIsApproved()).toBe(false);
    const result = offerToSave();
    await answer("discard");
    await expect(result).resolves.toBe(true);
    expect(useModelStore.getState().savedSource).toBe("a");
    expect(discardIsApproved()).toBe(true);
    useModelStore.setState({ source: "c" });
    expect(discardIsApproved()).toBe(false);
  });

  it("changes nothing on Cancel", async () => {
    openModel("/mine/model.py", { edited: true });
    const result = offerToSave();
    await answer("cancel");
    await expect(result).resolves.toBe(false);
  });

  it("is offered when Replace starts a tutorial over unsaved work", async () => {
    openModel("/mine/model.py", { edited: true });
    const result = chooseTutorialStart("stroop");
    await answer("here");
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending?.type).toBe("save"));
    await answer("cancel");
    await result;
    expect(useTourStore.getState().activeTourId).toBeNull();
  });
});
