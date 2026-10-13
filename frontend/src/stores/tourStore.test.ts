import { beforeEach, describe, expect, it } from "vitest";

import { tourIdFromUrl, useTourStore } from "./tourStore";
import { NARRATION_KEY } from "@/utils/narration";

describe("tourIdFromUrl", () => {
  it("reads the tour parameter", () => {
    expect(tourIdFromUrl("?tour=ddm")).toBe("ddm");
    expect(tourIdFromUrl("?foo=1&tour=demo")).toBe("demo");
  });

  it("returns null when there isn't one", () => {
    expect(tourIdFromUrl("")).toBeNull();
    expect(tourIdFromUrl("?foo=1")).toBeNull();
  });
});

describe("useTourStore", () => {
  beforeEach(() =>
    useTourStore.setState({ activeTourId: null, startCount: 0, stepIndex: 0, paused: false, nextPressed: false, pointerArrived: false }),
  );

  it("starts and stops a walkthrough", () => {
    useTourStore.getState().startTour("demo");
    expect(useTourStore.getState().activeTourId).toBe("demo");
    useTourStore.getState().stopTour();
    expect(useTourStore.getState().activeTourId).toBeNull();
  });

  /**
   * Picking the walkthrough that is already running must restart it. Without
   * the counter the id would not change, nothing would re-render, and the menu
   * would look broken.
   */
  it("bumps a counter even when restarting the same walkthrough", () => {
    useTourStore.getState().startTour("demo");
    const first = useTourStore.getState().startCount;
    useTourStore.getState().startTour("demo");
    expect(useTourStore.getState().startCount).toBe(first + 1);
  });
});

/** A localStorage stand-in: vitest runs these in node, which has none. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("useTourStore — playback (#1310)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    useTourStore.setState({ activeTourId: null, startCount: 0, stepIndex: 0, paused: false, nextPressed: false, pointerArrived: false, replayCount: 0, narration: false });
  });

  it("Next counts for the current step only, and is cleared on advance", () => {
    useTourStore.getState().startTour("orientation-window");
    expect(useTourStore.getState().nextPressed).toBe(false);
    useTourStore.getState().pressNext();
    expect(useTourStore.getState().nextPressed).toBe(true);
    useTourStore.getState().advance();
    expect(useTourStore.getState().stepIndex).toBe(1);
    expect(useTourStore.getState().nextPressed).toBe(false);
  });

  it("pause is a flag the bar reads; starting a walkthrough clears it", () => {
    useTourStore.getState().setPaused(true);
    expect(useTourStore.getState().paused).toBe(true);
    useTourStore.getState().startTour("orientation-window");
    expect(useTourStore.getState().paused).toBe(false);
  });

  it("replay bumps a counter and sends the pointer again", () => {
    useTourStore.getState().setPointerArrived(true);
    useTourStore.getState().replay();
    expect(useTourStore.getState().replayCount).toBe(1);
    expect(useTourStore.getState().pointerArrived).toBe(false);
  });

  it("a pointer step's arrival is reset by every advance", () => {
    useTourStore.getState().setPointerArrived(true);
    useTourStore.getState().advance();
    expect(useTourStore.getState().pointerArrived).toBe(false);
  });

  it("the narration choice is remembered in the browser", () => {
    useTourStore.getState().setNarration(true);
    expect(useTourStore.getState().narration).toBe(true);
    expect(localStorage.getItem(NARRATION_KEY)).toBe("on");
    useTourStore.getState().setNarration(false);
    expect(localStorage.getItem(NARRATION_KEY)).toBe("off");
  });
});
