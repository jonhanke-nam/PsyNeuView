/**
 * Autosave's rules and timer (#1347), with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autosaveBlock,
  autosaveStatus,
  autosaveTooltip,
  clampAutosaveSeconds,
  createAutosaveScheduler,
  formatAgo,
  type AutosaveBlock,
  type AutosaveInputs,
} from "./autosave";

const clear: AutosaveInputs = {
  filePath: "/m/model.py",
  bundleOrigin: null,
  pnlProtected: false,
  viewOnly: false,
  externalChangePending: false,
  diskChangedSinceSave: false,
  modelError: false,
  sourceBuilt: true,
  saving: false,
};

describe("autosaveBlock", () => {
  it("lets a built, unlocked file with no disk change save", () => {
    expect(autosaveBlock(clear)).toBeNull();
  });

  it.each<[Partial<AutosaveInputs>, AutosaveBlock]>([
    [{ filePath: null }, "noFile"],
    [{ bundleOrigin: "/m/x.pnlproject" }, "bundle"],
    [{ pnlProtected: true }, "protected"],
    [{ viewOnly: true }, "locked"],
    [{ externalChangePending: true }, "externalChange"],
    [{ diskChangedSinceSave: true }, "diskChanged"],
    [{ saving: true }, "saving"],
    [{ modelError: true }, "codeError"],
    [{ sourceBuilt: false }, "building"],
  ])("never saves when %o", (patch, block) => {
    expect(autosaveBlock({ ...clear, ...patch })).toBe(block);
  });

  it("names the reason that won't lift on its own first", () => {
    expect(autosaveBlock({ ...clear, viewOnly: true, modelError: true })).toBe("locked");
    expect(autosaveBlock({ ...clear, externalChangePending: true, modelError: true })).toBe("externalChange");
  });
});

describe("clampAutosaveSeconds", () => {
  it("keeps whole seconds from 2 to 600", () => {
    expect(clampAutosaveSeconds(10)).toBe(10);
    expect(clampAutosaveSeconds(0)).toBe(2);
    expect(clampAutosaveSeconds(1000)).toBe(600);
    expect(clampAutosaveSeconds(7.6)).toBe(8);
    expect(clampAutosaveSeconds(NaN)).toBe(10);
  });
});

describe("status words", () => {
  const base = {
    enabled: true,
    block: null as AutosaveBlock | null,
    dirty: false,
    due: false,
    autosaving: false,
    lastAutosavedAt: null as number | null,
    lastFailed: false,
    now: 100_000,
  };

  it("shows nothing when autosave is off, whatever else is true", () => {
    expect(autosaveStatus({ ...base, enabled: false, dirty: true, block: "codeError" })).toBeNull();
  });

  it("says when it last saved", () => {
    expect(autosaveStatus({ ...base, lastAutosavedAt: 88_000 })?.text).toBe("Autosaved 12 s ago");
    expect(autosaveStatus(base)?.text).toBe("Autosave on");
  });

  it("says why it is waiting or paused, only while there is something unsaved", () => {
    expect(autosaveStatus({ ...base, dirty: true, block: "codeError" })).toEqual({
      text: "Autosave waiting: code has an error",
      tone: "warning",
    });
    expect(autosaveStatus({ ...base, dirty: true, block: "diskChanged" })?.text).toBe(
      "Autosave paused: file changed on disk",
    );
    expect(autosaveStatus({ ...base, dirty: true, block: "externalChange" })?.text).toBe(
      "Autosave paused: file changed on disk",
    );
    expect(autosaveStatus({ ...base, dirty: true, block: "locked" })?.text).toBe("Autosave paused: model is locked");
    expect(autosaveStatus({ ...base, dirty: false, block: "codeError" })?.text).toBe("Autosave on");
  });

  it("mentions an unbuilt edit only once the wait is over", () => {
    expect(autosaveStatus({ ...base, dirty: true, block: "building" })?.text).toBe("Autosave on");
    expect(autosaveStatus({ ...base, dirty: true, block: "building", due: true })?.text).toBe(
      "Autosave waiting: checking the code",
    );
  });

  it("says bundles are saved by hand, and nothing for a protected file", () => {
    expect(autosaveStatus({ ...base, block: "bundle" })?.text).toBe("Autosave off for bundles");
    expect(autosaveStatus({ ...base, block: "protected", dirty: true })).toBeNull();
  });

  it("formats time plainly", () => {
    expect(formatAgo(500)).toBe("just now");
    expect(formatAgo(45_000)).toBe("45 s ago");
    expect(formatAgo(185_000)).toBe("3 min ago");
    expect(formatAgo(2 * 3600_000)).toBe("2 h ago");
  });

  it("the tooltip says it is on, after how long, and where to change it", () => {
    const t = autosaveTooltip(10, null);
    expect(t).toContain("Autosave is on");
    expect(t).toContain("10 s after your last edit");
    expect(t).toContain("Settings ▸ General ▸ Model files");
  });
});

describe("the timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(over: { enabled?: boolean; dirty?: boolean; block?: AutosaveBlock | null } = {}) {
    const state = { enabled: true, dirty: true, block: null as AutosaveBlock | null, ...over };
    const save = vi.fn(() => Promise.resolve());
    const s = createAutosaveScheduler({
      delayMs: () => 10_000,
      enabled: () => state.enabled,
      dirty: () => state.dirty,
      block: () => state.block,
      save,
    });
    return { s, save, state };
  }

  it("saves once, N seconds after the last edit", async () => {
    const { s, save } = setup();
    s.activity();
    vi.advanceTimersByTime(9_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("restarts the wait on each edit", () => {
    const { s, save } = setup();
    s.activity();
    vi.advanceTimersByTime(8_000);
    s.activity();
    vi.advanceTimersByTime(8_000);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does nothing when off", () => {
    const { s, save } = setup({ enabled: false });
    s.activity();
    vi.advanceTimersByTime(60_000);
    expect(save).not.toHaveBeenCalled();
  });

  it("does nothing with no unsaved changes", () => {
    const { s, save } = setup({ dirty: false });
    s.activity();
    vi.advanceTimersByTime(60_000);
    expect(save).not.toHaveBeenCalled();
    expect(s.isDue()).toBe(false);
  });

  it.each<AutosaveBlock>(["locked", "protected", "externalChange", "diskChanged", "codeError", "bundle", "saving"])(
    "never saves while %s",
    (block) => {
      const { s, save } = setup({ block });
      s.activity();
      vi.advanceTimersByTime(60_000);
      s.recheck();
      expect(save).not.toHaveBeenCalled();
      expect(s.isDue()).toBe(true);
    },
  );

  it("saves when the block lifts after the wait, e.g. the build finishing", () => {
    const { s, save, state } = setup({ block: "building" });
    s.activity();
    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();
    state.block = null;
    s.recheck();
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.isDue()).toBe(false);
  });

  it("an edit while blocked starts the wait over", () => {
    const { s, save, state } = setup({ block: "codeError" });
    s.activity();
    vi.advanceTimersByTime(10_000);
    state.block = null;
    s.activity(); // the fix is an edit
    s.recheck();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("tries once per wait: a failed save is not retried until the next edit", async () => {
    const { s, save } = setup();
    s.activity();
    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();
    s.recheck();
    s.recheck();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("doesn't start a second save while one is out", async () => {
    let finish!: () => void;
    const state = { block: null as AutosaveBlock | null };
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const s = createAutosaveScheduler({
      delayMs: () => 2_000,
      enabled: () => true,
      dirty: () => true,
      block: () => state.block,
      save,
    });
    s.activity();
    vi.advanceTimersByTime(2_000);
    s.activity();
    vi.advanceTimersByTime(2_000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    // ...and the edit made meanwhile is saved when it ends.
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it("stops on dispose", () => {
    const { s, save } = setup();
    s.activity();
    s.dispose();
    vi.advanceTimersByTime(60_000);
    expect(save).not.toHaveBeenCalled();
  });
});
