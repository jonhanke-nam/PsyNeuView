import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { useTourStore } from "@/stores/tourStore";
import { shouldOfferOrientation } from "./orientationOffer";
import { windowRequest } from "./appWindow";
import {
  chooseTutorialStart,
  guardOpen,
  isSameFile,
  needsModel,
  stepAsksFor,
  useTutorialChoice,
  windowUrlFor,
  type PendingChoice,
} from "./tutorialGuard";
import { WALKTHROUGHS, type TourStep } from "./tourStep";

// The app's window: opening one is checked in the browser, by the e2e spec.
vi.stubGlobal("window", { location: { origin: "", pathname: "/" }, open: vi.fn() });

const step = (act: TourStep["act"]) => ({ act }) as TourStep;
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
    const open = step({ openModel: "Stroop — Basic" });
    expect(stepAsksFor(open, { kind: "catalog", label: "Stroop — Basic" })).toBe(true);
    expect(stepAsksFor(open, { kind: "catalog", label: "EGO" })).toBe(false);
    expect(stepAsksFor(open, { kind: "newModel" })).toBe(false);
    expect(stepAsksFor(step({ newModel: "x" }), { kind: "newModel" })).toBe(true);
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
    expect(windowRequest(windowUrlFor({ kind: "path", path })!)).toEqual({ path });
    expect(windowRequest(windowUrlFor({ kind: "catalog", label: "Stroop — Basic" })!)).toEqual({ model: "Stroop — Basic" });
    expect(windowRequest(windowUrlFor({ kind: "newModel" })!)).toEqual({ newModel: true });
    expect(windowUrlFor({ kind: "file", name: "dropped.py" })).toBeNull();
    expect(windowRequest("?tour=ddm")).toBeNull();
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

  it("offers no second window on the file that's open here", async () => {
    openModel("/mine/stroop_basic.py");
    useCatalogOpener.setState({ isOpen: () => true });
    const result = chooseTutorialStart("stroop");
    await vi.waitFor(() => expect(useTutorialChoice.getState().pending).not.toBeNull());
    expect((pending() as Extract<PendingChoice, { type: "start" }>).noWindowReason).toMatch(/can't run in a second window/);
    await answer("cancel");
    await result;
  });
});
