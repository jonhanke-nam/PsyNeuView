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
 *
 * Every piece of work, and each stretch that showed the wheel, also goes in
 * the wait log for problem reports (#176, utils/waitLog.ts).
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";
import { BACKGROUND_WAIT_MIN_MS, beginWait, type WaitOutcome } from "@/utils/waitLog";

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

export const BUSY_TIMER_KEY = "psyneuview.busy.timerPlace";
export type BusyTimerPlace = "off" | "toolbar" | "canvas" | "both";
export const DEFAULT_BUSY_TIMER_PLACE: BusyTimerPlace = "toolbar";
export const BUSY_TIMER_PLACES: { place: BusyTimerPlace; label: string }[] = [
  { place: "off", label: "Off" },
  { place: "toolbar", label: "In the toolbar" },
  { place: "canvas", label: "Over the graph" },
  { place: "both", label: "Both" },
];

export function loadBusyTimerPlace(): BusyTimerPlace {
  try {
    const stored = localStorage.getItem(BUSY_TIMER_KEY);
    return BUSY_TIMER_PLACES.find((p) => p.place === stored)?.place ?? DEFAULT_BUSY_TIMER_PLACE;
  } catch {
    return DEFAULT_BUSY_TIMER_PLACE;
  }
}

/** How long the wheel has been spinning: `12 s`, `1:05`, `1:02:09`. */
export function formatBusyElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s} s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}:${pad(s % 60)}`;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(s % 60)}`;
}

interface Task {
  label: string;
  start: number;
}

interface BusyState {
  /** In-flight work, by id. */
  tasks: Map<number, Task>;
  /**
   * When this unbroken stretch of busyness began, or null when idle. The timer
   * counts from here, not from the oldest task, so it can't jump backwards
   * when that task finishes while another carries on.
   */
  busySince: number | null;
  thresholdMs: number;
  setThresholdMs: (ms: number) => void;
  timerPlace: BusyTimerPlace;
  setTimerPlace: (place: BusyTimerPlace) => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  tasks: new Map(),
  busySince: null,
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
  timerPlace: loadBusyTimerPlace(),
  setTimerPlace: (place) => {
    try {
      localStorage.setItem(BUSY_TIMER_KEY, place);
    } catch {
      // Storage blocked: the choice holds for this page.
    }
    recordSettingChanged("busy-timer", place);
    set({ timerPlace: place });
  },
}));

let nextId = 1;
let endStretch: (() => void) | null = null;

/** Register a piece of work; call the returned function when it is done. */
export function beginBusy(
  label: string,
  now: number = Date.now(),
): (outcome?: WaitOutcome, detail?: string) => void {
  const id = nextId++;
  const endWait = beginWait(label, { now });
  if (useBusyStore.getState().tasks.size === 0) {
    endStretch?.();
    // Only a stretch long enough to show the wheel is worth recording.
    endStretch = beginWait("busy", { kind: "wheel", minMs: useBusyStore.getState().thresholdMs, now });
    useBusyStore.setState({ busySince: now });
  }
  useBusyStore.setState((s) => {
    const tasks = new Map(s.tasks);
    tasks.set(id, { label, start: now });
    return { tasks };
  });
  let done = false;
  return (outcome, detail) => {
    if (done) return;
    done = true;
    endWait(outcome, detail);
    useBusyStore.setState((s) => {
      const tasks = new Map(s.tasks);
      tasks.delete(id);
      return tasks.size === 0 ? { tasks, busySince: null } : { tasks };
    });
    if (useBusyStore.getState().tasks.size === 0) {
      endStretch?.();
      endStretch = null;
    }
  };
}

/** How a failed piece of work ended: a cancel is not a failure. */
function rejectedOutcome(e: unknown): WaitOutcome {
  return e instanceof Error && e.name === "AbortError" ? "cancelled" : "failed";
}

function settle<T>(
  work: Promise<T>,
  end: (outcome?: WaitOutcome, detail?: string) => void,
  judge?: (value: T) => { outcome: WaitOutcome; detail?: string },
): Promise<T> {
  return work.then(
    (value) => {
      const verdict = judge?.(value);
      end(verdict?.outcome ?? "ok", verdict?.detail);
      return value;
    },
    (e) => {
      end(rejectedOutcome(e));
      throw e;
    },
  );
}

/** Show the wheel while `work` runs (if it runs longer than the threshold). */
export function withBusy<T>(label: string, work: Promise<T>): Promise<T> {
  return settle(work, beginBusy(label));
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
  // The Run and Learn panels ask which execution modes exist when they mount,
  // at startup; it takes about a second, so the wheel spun before anyone did
  // anything.
  /^\/api\/execution-modes\b/,
  /^\/api\/settings\/pnl-freshness/,
  /^\/api\/settings\/pnl-updates/,
  // The marks on the Open menu's PsyNeuLink Examples: the server loads and
  // runs every example to find them, which can take a minute, and nobody is
  // waiting for it (#175).
  /^\/api\/psyneulink-examples\/status\b/,
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

/** `POST /api/model/load`: the method and the path, never the query string. */
export function requestLabel(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
  let path = requestPath(input);
  try {
    path = new URL(path, "http://x").pathname;
  } catch {
    path = path.split(/[?#]/)[0];
  }
  return `${method.toUpperCase()} ${path}`;
}

/** A request answered with an error status failed, though the fetch resolved. */
function judgeResponse(r: Response): { outcome: WaitOutcome; detail?: string } {
  return r.ok ? { outcome: "ok" } : { outcome: "failed", detail: `HTTP ${r.status}` };
}

const WRAPPED = Symbol.for("psyneuview.busyFetch");

/** Wrap window.fetch so every user-driven request registers while in flight. */
export function installBusyFetch(target: { fetch: typeof fetch } = globalThis): void {
  if ((target.fetch as unknown as Record<symbol, boolean>)[WRAPPED]) return;
  const original = target.fetch.bind(target);
  target.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const label = requestLabel(input, init);
    const end = isBackgroundRequest(requestPath(input))
      ? beginWait(label, { kind: "background", minMs: BACKGROUND_WAIT_MIN_MS })
      : beginBusy(label);
    return settle(original(input, init), end, judgeResponse);
  };
  (target.fetch as unknown as Record<symbol, boolean>)[WRAPPED] = true;
}
