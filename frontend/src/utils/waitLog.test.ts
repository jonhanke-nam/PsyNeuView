import { beforeEach, describe, expect, it } from "vitest";
import { clearActivity, record, setActionLogging } from "./activityLog";

// The action-logging setting is remembered in localStorage (#177); the suite
// runs on node, so stub it.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null),
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
    clear: () => stored.clear(),
  },
});
import {
  BACKGROUND_WAIT_MIN_MS,
  LIKELY_ACTION_MS,
  WAIT_CAP,
  beginWait,
  causedBy,
  clearWaits,
  finishedWaits,
  waitEntries,
  waitsInProgress,
} from "./waitLog";

describe("waitLog (#176)", () => {
  beforeEach(() => {
    clearWaits();
    clearActivity();
  });

  it("keeps the start and stop times of even a very quick wait", () => {
    beginWait("GET /a", { now: 1000 })("ok", undefined, 1001);
    expect(finishedWaits()).toEqual([
      expect.objectContaining({ label: "GET /a", start: 1000, stop: 1001, outcome: "ok" }),
    ]);
  });

  it("reports a wait still running, with no stop time", () => {
    const end = beginWait("GET /slow", { now: 1000 });
    expect(waitEntries(13_345)).toEqual([
      expect.objectContaining({
        t: new Date(1000).toISOString(),
        kind: "wait",
        text: "GET /slow · still waiting after 12.345 s",
        data: expect.objectContaining({ stop: null, durationMs: 12_345, outcome: null }),
      }),
    ]);
    end("ok", undefined, 14_000);
    expect(waitsInProgress(14_000)).toEqual([]);
  });

  it("says how a wait ended", () => {
    beginWait("POST /b", { now: 0 })("failed", "HTTP 500", 2500);
    expect(waitEntries(3000)[0].text).toBe("POST /b · stopped 1970-01-01T00:00:02.500Z · 2.500 s · failed, HTTP 500");
  });

  it("forgets a background request that stays quick, and keeps one that runs long", () => {
    const opts = { kind: "background" as const, minMs: BACKGROUND_WAIT_MIN_MS, now: 0 };
    beginWait("GET /health", opts)("ok", undefined, 50);
    expect(finishedWaits()).toEqual([]);

    const end = beginWait("GET /health", opts);
    expect(waitsInProgress(500)).toEqual([]);
    expect(waitsInProgress(1500)).toHaveLength(1);
    end("ok", undefined, 2000);
    expect(waitEntries(2000)[0].text).toContain("GET /health (background)");
  });

  it("links a wait to its known cause, as certain", () => {
    record("menu", "Layout menu opened");
    causedBy("Open menu opened", () => beginWait("GET /c"))();
    expect(finishedWaits()[0].action).toEqual({ text: "Open menu opened", certain: true });
    expect(waitEntries()[0].text).toContain("· from: Open menu opened");
  });

  it("links a wait with no known cause to the latest action, marked as likely", () => {
    record("menu", "Open › A model");
    record("notification", "Not something the user did");
    beginWait("POST /d")();
    expect(finishedWaits()[0].action).toEqual({ text: "Open › A model", certain: false });
    expect(waitEntries()[0].text).toContain("· likely from: Open › A model");
  });

  it("links nothing when there is no recent action", () => {
    beginWait("GET /e")();
    expect(finishedWaits()[0].action).toBeNull();
    record("menu", "Open › Long ago");
    beginWait("GET /f", { now: Date.now() + LIKELY_ACTION_MS + 5000 })();
    expect(finishedWaits()[1].action).toBeNull();
  });

  it("keeps only the latest finished waits", () => {
    for (let i = 0; i < WAIT_CAP + 5; i++) beginWait(`GET /${i}`)();
    expect(finishedWaits()).toHaveLength(WAIT_CAP);
    expect(finishedWaits()[0].label).toBe("GET /5");
  });

  it("stopping twice records once", () => {
    const end = beginWait("GET /g");
    end();
    end();
    expect(finishedWaits()).toHaveLength(1);
  });

  it("records a wait without its cause, known or likely, when action logging is off (#177)", () => {
    stored.clear();
    clearActivity();
    clearWaits();
    record("menu", "Open menu opened");
    setActionLogging(false);
    const endLikely = beginWait("GET /api/a", { now: 1000 });
    endLikely("ok", undefined, 1500);
    causedBy("Open menu opened", () => beginWait("GET /api/b", { now: 1000 })("ok", undefined, 1200));
    expect(finishedWaits().map((w) => w.action)).toEqual([null, null]);
    setActionLogging(true);
    causedBy("Open menu opened", () => beginWait("GET /api/c", { now: 1000 })("ok", undefined, 1200));
    expect(finishedWaits()[2].action).toEqual({ text: "Open menu opened", certain: true });
    stored.clear();
    clearActivity();
  });
});
