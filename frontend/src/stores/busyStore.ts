/**
 * What PsyNeuView is busy with, for the spinning wheel of patience (#38).
 *
 * Every request to the backend registers here while it is in flight
 * (installBusyFetch wraps window.fetch once, at start-up), and long steps in
 * the page register through withBusy(label, promise). BusyIndicator shows the
 * wheel once the oldest piece of work has run for the threshold (0.2 s by
 * default, Settings ▸ General ▸ Busy indicator); quick actions show nothing.
 *
 * Background requests (the health check, polls of a running job, checks
 * for updates) are not user actions and never register.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";

export const BUSY_THRESHOLD_KEY = "psyneuview.busy.thresholdMs";
export const DEFAULT_BUSY_THRESHOLD_MS = 200;
export const BUSY_THRESHOLDS: { ms: number; label: string }[] = [
  { ms: 0, label: "At once" },
  { ms: 100, label: "After 0.1 s" },
  { ms: 200, label: "After 0.2 s" },
  { ms: 500, label: "After 0.5 s" },
  { ms: 1000, label: "After 1 s" },
];

export function loadBusyThreshold(): number {
  try {
    const stored = localStorage.getItem(BUSY_THRESHOLD_KEY);
    const n = Number(stored);
    return stored !== null && BUSY_THRESHOLDS.some((t) => t.ms === n) ? n : DEFAULT_BUSY_THRESHOLD_MS;
  } catch {
    return DEFAULT_BUSY_THRESHOLD_MS;
  }
}

interface Task {
  label: string;
  start: number;
}

interface BusyState {
  /** In-flight work, by id. */
  tasks: Map<number, Task>;
  thresholdMs: number;
  setThresholdMs: (ms: number) => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  tasks: new Map(),
  thresholdMs: loadBusyThreshold(),
  setThresholdMs: (ms) => {
    try {
      localStorage.setItem(BUSY_THRESHOLD_KEY, String(ms));
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("busy-threshold", String(ms));
    set({ thresholdMs: ms });
  },
}));

let nextId = 1;

/** Register a piece of work; call the returned function when it is done. */
export function beginBusy(label: string, now: number = Date.now()): () => void {
  const id = nextId++;
  useBusyStore.setState((s) => {
    const tasks = new Map(s.tasks);
    tasks.set(id, { label, start: now });
    return { tasks };
  });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    useBusyStore.setState((s) => {
      const tasks = new Map(s.tasks);
      tasks.delete(id);
      return { tasks };
    });
  };
}

/** Show the wheel while `work` runs (if it runs longer than the threshold). */
export function withBusy<T>(label: string, work: Promise<T>): Promise<T> {
  const end = beginBusy(label);
  return work.finally(end);
}

/** The oldest in-flight task, or null when idle. */
export function oldestTask(tasks: Map<number, Task>): Task | null {
  let oldest: Task | null = null;
  for (const t of tasks.values()) if (!oldest || t.start < oldest.start) oldest = t;
  return oldest;
}

/** Requests that run in the background, not because the user did something. */
const BACKGROUND = [
  /^\/health\b/,
  /^\/api\/settings\/running/,
  /^\/api\/settings\/info\b/,
  /^\/api\/settings\/pnl-freshness/,
  /^\/api\/settings\/pnl-updates/,
  /^\/api\/settings\/install\/[^/?]+$/, // polling an install job
  /^\/api\/jobs\/[^/?]+$/, // polling a job
  /^\/rendering-defaults\.json/,
];

export function isBackgroundRequest(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    // keep url
  }
  return BACKGROUND.some((re) => re.test(path));
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

const WRAPPED = Symbol.for("psyneuview.busyFetch");

/** Wrap window.fetch so every user-driven request registers while in flight. */
export function installBusyFetch(target: { fetch: typeof fetch } = globalThis): void {
  if ((target.fetch as unknown as Record<symbol, boolean>)[WRAPPED]) return;
  const original = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (isBackgroundRequest(path)) return original(input, init);
    return withBusy(path, original(input, init));
  };
  (target.fetch as unknown as Record<symbol, boolean>)[WRAPPED] = true;
}
