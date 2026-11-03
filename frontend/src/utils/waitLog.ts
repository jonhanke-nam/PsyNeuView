/**
 * The wait log: when each wait started and stopped, what it waited on, and the
 * action it came from (#176), so a problem report can lay the delays out
 * against what the user did.
 *
 * Every request to the backend and every long step in the page is a wait, even
 * one too quick to show the busy wheel: short waits can add up. A background
 * request counts only once it has run long, and the wheel's whole stretch of
 * busyness is kept as well, because the pieces of work inside it overlap.
 *
 * A separate list from the activity log, so that frequent requests can't push
 * out the actions they need to be read against. The two are merged when a
 * report is made (`utils/diagnostics.ts`). Same scope rules: a request's path
 * but never its query string, and the home folder as `~`.
 */

import { latestAction, scrubText, type ActivityEntry } from "./activityLog";

export type WaitOutcome = "ok" | "failed" | "cancelled";

/**
 * - work: something the user is waiting for, which can show the wheel
 * - background: a request nobody asked for, recorded only once it has run long
 * - wheel: a whole stretch of busyness that showed the wheel
 */
export type WaitKind = "work" | "background" | "wheel";

export interface WaitAction {
  text: string;
  /** False when this is only the most recent action, not a known cause. */
  certain: boolean;
}

export interface WaitRecord {
  label: string;
  kind: WaitKind;
  start: number;
  stop: number | null;
  outcome: WaitOutcome | null;
  /** More about the outcome, such as "HTTP 500". */
  detail?: string;
  action: WaitAction | null;
}

/** The last finished waits kept; older ones are dropped first. */
export const WAIT_CAP = 2000;
/** A background request is a wait only past this. */
export const BACKGROUND_WAIT_MIN_MS = 1000;
/** An older action is too stale to call the likely cause of a wait. */
export const LIKELY_ACTION_MS = 30_000;

const finished: WaitRecord[] = [];
/** The sequence number of the last finished wait, so the saver can ask for what's new (#177). */
let finishedSeq = 0;
const finishedSeqs: number[] = [];
const inProgress = new Map<number, { record: WaitRecord; minMs: number }>();
let nextId = 1;
let knownCause: string | null = null;

/** Waits begun while `work` runs synchronously came from the action `text`. */
export function causedBy<T>(text: string, work: () => T): T {
  const outer = knownCause;
  knownCause = text;
  try {
    return work();
  } finally {
    knownCause = outer;
  }
}

function actionFor(now: number): WaitAction | null {
  if (knownCause !== null) return { text: knownCause, certain: true };
  const latest = latestAction();
  if (!latest || now - Date.parse(latest.t) > LIKELY_ACTION_MS) return null;
  return { text: latest.text, certain: false };
}

/**
 * Register a wait; call the returned function when it stops. One that stops
 * before `minMs` is forgotten, and until then isn't reported as in progress.
 */
export function beginWait(
  label: string,
  opts: { kind?: WaitKind; minMs?: number; now?: number } = {},
): (outcome?: WaitOutcome, detail?: string, now?: number) => void {
  const start = opts.now ?? Date.now();
  const minMs = opts.minMs ?? 0;
  const record: WaitRecord = {
    label: scrubText(label),
    kind: opts.kind ?? "work",
    start,
    stop: null,
    outcome: null,
    action: actionFor(start),
  };
  const id = nextId++;
  inProgress.set(id, { record, minMs });
  return (outcome = "ok", detail, now = Date.now()) => {
    if (!inProgress.delete(id)) return;
    // Only when asked: the clock moving back mustn't lose a wait.
    if (minMs > 0 && now - start < minMs) return;
    finished.push({ ...record, stop: now, outcome, ...(detail ? { detail } : {}) });
    finishedSeqs.push(++finishedSeq);
    if (finished.length > WAIT_CAP) {
      finished.splice(0, finished.length - WAIT_CAP);
      finishedSeqs.splice(0, finishedSeqs.length - WAIT_CAP);
    }
  };
}

/** The waits running now, oldest first, with no stop time. */
export function waitsInProgress(now: number = Date.now()): WaitRecord[] {
  return Array.from(inProgress.values())
    .filter((w) => now - w.record.start >= w.minMs)
    .map((w) => ({ ...w.record }))
    .sort((a, b) => a.start - b.start);
}

export function finishedWaits(): WaitRecord[] {
  return finished.map((w) => ({ ...w }));
}

export function clearWaits(): void {
  finished.length = 0;
  finishedSeqs.length = 0;
  finishedSeq = 0;
  inProgress.clear();
}

/** The sequence number of the last finished wait, for `finishedWaitsSince`. */
export function waitSequence(): number {
  return finishedSeq;
}

/** The waits that finished after sequence number `seq`, as activity entries. */
export function finishedWaitsSince(seq: number): ActivityEntry[] {
  return finished.filter((_, i) => finishedSeqs[i] > seq).map((w) => waitEntry(w, w.stop ?? w.start));
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

function describe(w: WaitRecord, now: number): string {
  const name = w.kind === "wheel" ? "Busy wheel" : w.kind === "background" ? `${w.label} (background)` : w.label;
  const parts = [name];
  if (w.stop === null) {
    parts.push(`still waiting after ${seconds(now - w.start)}`);
  } else {
    parts.push(`stopped ${new Date(w.stop).toISOString()}`, seconds(w.stop - w.start));
    if (w.kind !== "wheel") parts.push(w.detail ? `${w.outcome}, ${w.detail}` : String(w.outcome));
  }
  if (w.action) parts.push(`${w.action.certain ? "from" : "likely from"}: ${w.action.text}`);
  return parts.join(" · ");
}

/** One wait as an activity entry, timed at its start. */
export function waitEntry(w: WaitRecord, now: number): ActivityEntry {
  return {
    t: new Date(w.start).toISOString(),
    kind: "wait" as const,
    text: describe(w, now),
    data: {
      label: w.label,
      waitKind: w.kind,
      stop: w.stop === null ? null : new Date(w.stop).toISOString(),
      durationMs: (w.stop ?? now) - w.start,
      outcome: w.outcome,
      ...(w.detail ? { detail: w.detail } : {}),
      action: w.action?.text ?? null,
      actionCertain: w.action?.certain ?? null,
    },
  };
}

/** Every wait as an activity entry, timed at its start, for a problem report. */
export function waitEntries(now: number = Date.now()): ActivityEntry[] {
  return [...finished, ...waitsInProgress(now)].map((w) => waitEntry(w, now));
}
