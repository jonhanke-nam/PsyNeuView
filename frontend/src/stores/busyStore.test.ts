import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginBusy,
  installBusyFetch,
  isBackgroundRequest,
  oldestTask,
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
