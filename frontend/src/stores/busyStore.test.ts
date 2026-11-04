import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearWaits, finishedWaits, waitsInProgress } from "@/utils/waitLog";
import {
  beginBusy,
  formatBusyElapsed,
  installBusyFetch,
  isBackgroundRequest,
  loadBusyTimerPlace,
  oldestTask,
  requestLabel,
  useBusyStore,
  withBusy,
} from "./busyStore";

// Node has no localStorage; a small stand-in.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

describe("busyStore (#38)", () => {
  beforeEach(() => useBusyStore.setState({ tasks: new Map() }));

  it("registers work while it runs and forgets it when done", async () => {
    let resolve!: (v: number) => void;
    const p = withBusy("x", new Promise<number>((r) => (resolve = r)));
    expect(useBusyStore.getState().tasks.size).toBe(1);
    resolve(3);
    await expect(p).resolves.toBe(3);
    expect(useBusyStore.getState().tasks.size).toBe(0);
  });

  it("forgets failed work too", async () => {
    await expect(withBusy("x", Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(useBusyStore.getState().tasks.size).toBe(0);
  });

  it("ending twice is harmless; the oldest start wins", () => {
    const a = beginBusy("a", 100);
    const b = beginBusy("b", 50);
    expect(oldestTask(useBusyStore.getState().tasks)?.label).toBe("b");
    b();
    b();
    expect(oldestTask(useBusyStore.getState().tasks)?.label).toBe("a");
    a();
    expect(oldestTask(useBusyStore.getState().tasks)).toBeNull();
  });

  it("background polls are not user actions", () => {
    expect(isBackgroundRequest("/health")).toBe(true);
    expect(isBackgroundRequest("/api/jobs/abc")).toBe(true);
    expect(isBackgroundRequest("/api/settings/running?page=1")).toBe(true);
    // Asked at startup by the Run and Learn panels, not by the user.
    expect(isBackgroundRequest("/api/execution-modes")).toBe(true);
    expect(isBackgroundRequest("/api/psyneulink-examples/status")).toBe(true);
    expect(isBackgroundRequest("/api/psyneulink-examples")).toBe(false);
    expect(isBackgroundRequest("/api/model/load")).toBe(false);
    expect(isBackgroundRequest("/api/jobs")).toBe(false);
    expect(isBackgroundRequest("http://localhost:8000/api/model/save-source")).toBe(false);
  });

  it("wraps fetch so user requests register while in flight", async () => {
    let resolve!: (r: Response) => void;
    const target = { fetch: vi.fn(() => new Promise<Response>((r) => (resolve = r))) as unknown as typeof fetch };
    installBusyFetch(target);
    const p = target.fetch("/api/model/save-source", { method: "POST" });
    expect(useBusyStore.getState().tasks.size).toBe(1);
    resolve(new Response("{}"));
    await p;
    expect(useBusyStore.getState().tasks.size).toBe(0);
    void target.fetch("/health");
    expect(useBusyStore.getState().tasks.size).toBe(0);
  });

  it("remembers the threshold under a psyneuview. key", () => {
    useBusyStore.getState().setThresholdMs(500);
    expect(localStorage.getItem("psyneuview.busy.thresholdMs")).toBe("500");
    useBusyStore.getState().setThresholdMs(200);
  });
});

describe("busyStore timings (#176)", () => {
  beforeEach(() => {
    useBusyStore.setState({ tasks: new Map(), busySince: null });
    clearWaits();
  });

  it("the stretch keeps its start when the oldest work finishes first, so the timer can't jump back", () => {
    const a = beginBusy("a", 100);
    const b = beginBusy("b", 200);
    expect(useBusyStore.getState().busySince).toBe(100);
    a();
    expect(oldestTask(useBusyStore.getState().tasks)?.start).toBe(200);
    expect(useBusyStore.getState().busySince).toBe(100);
    b();
    expect(useBusyStore.getState().busySince).toBeNull();
  });

  it("records each piece of work and, past the threshold, the whole stretch", () => {
    const start = Date.now() - 5000;
    const a = beginBusy("a", start);
    const b = beginBusy("b", start + 1000);
    expect(waitsInProgress().map((w) => [w.kind, w.label])).toEqual([
      ["work", "a"],
      ["wheel", "busy"],
      ["work", "b"],
    ]);
    a();
    b();
    const waits = finishedWaits();
    expect(waits.map((w) => w.label)).toEqual(["a", "b", "busy"]);
    expect(waits[2].start).toBe(start);
    expect(waits.every((w) => w.stop !== null)).toBe(true);
  });

  it("doesn't record a stretch too short to show the wheel, but does record its work", () => {
    beginBusy("quick")();
    expect(finishedWaits().map((w) => w.label)).toEqual(["quick"]);
  });

  it("records how a request ended", async () => {
    const answers: Response[] = [new Response("{}"), new Response("no", { status: 500 })];
    const target = {
      fetch: vi.fn((url: string) => {
        if (url === "/gone") return Promise.reject(new Error("network"));
        if (url === "/stopped") return Promise.reject(new DOMException("stop", "AbortError"));
        return Promise.resolve(answers.shift()!);
      }) as unknown as typeof fetch,
    };
    installBusyFetch(target);
    await target.fetch("/fine?secret=1");
    await target.fetch("/broken", { method: "post" });
    await target.fetch("/gone").catch(() => {});
    await target.fetch("/stopped").catch(() => {});
    expect(finishedWaits().filter((w) => w.kind === "work").map((w) => [w.label, w.outcome, w.detail])).toEqual([
      ["GET /fine", "ok", undefined],
      ["POST /broken", "failed", "HTTP 500"],
      ["GET /gone", "failed", undefined],
      ["GET /stopped", "cancelled", undefined],
    ]);
  });

  it("a slow background request is recorded but doesn't show the wheel", async () => {
    const target = { fetch: vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch };
    installBusyFetch(target);
    void target.fetch("/health");
    expect(useBusyStore.getState().tasks.size).toBe(0);
    expect(waitsInProgress(Date.now() + 2000).map((w) => [w.kind, w.label])).toEqual([["background", "GET /health"]]);
  });

  it("labels a request without its query string", () => {
    expect(requestLabel("/api/x?path=/secret")).toBe("GET /api/x");
    expect(requestLabel("http://localhost:8000/api/y", { method: "POST" })).toBe("POST /api/y");
    expect(requestLabel(new URL("http://localhost/api/z?a=1"))).toBe("GET /api/z");
  });

  it("formats the elapsed time", () => {
    expect(formatBusyElapsed(12.9)).toBe("12 s");
    expect(formatBusyElapsed(65)).toBe("1:05");
    expect(formatBusyElapsed(3729)).toBe("1:02:09");
  });

  it("remembers where the timer shows, defaulting to the toolbar", () => {
    store.delete("psyneuview.busy.timerPlace");
    expect(loadBusyTimerPlace()).toBe("toolbar");
    useBusyStore.getState().setTimerPlace("both");
    expect(loadBusyTimerPlace()).toBe("both");
    store.set("psyneuview.busy.timerPlace", "nonsense");
    expect(loadBusyTimerPlace()).toBe("toolbar");
    useBusyStore.getState().setTimerPlace("toolbar");
  });
});
