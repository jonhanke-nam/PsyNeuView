/**
 * The saver: a copy of the activity log and the wait log on disk (#177), so
 * a problem report made after a restart still says what the user was doing.
 *
 * The page's log starts empty whenever the page loads; the server keeps the
 * copy, under ~/.psyneuview/activity-log (backend/app/services/activity_log.py),
 * this launch's beside the previous launch's, each with a size cap. It stays
 * on the machine and leaves only in a problem report or a download the user
 * asks for. The same rules as the log itself: entries arrive here already
 * scrubbed, and user actions are left out — and the saved ones removed —
 * when action logging is off.
 *
 * Not a request per entry: new entries are batched and sent a couple of
 * seconds after the first of them, at most every `maxWaitMs` while they keep
 * coming, and at once when the page is hidden or about to unload, through
 * `navigator.sendBeacon`, which the browser delivers even as the page goes
 * away. `sendBeacon` is also outside the busy wheel's wrapped `fetch`, so the
 * saving never counts as a wait of its own.
 */

import {
  activitySequence,
  entriesSince,
  onActionLoggingChanged,
  onRecorded,
  record,
  USER_ACTION_KINDS,
  type ActivityEntry,
} from "./activityLog";
import { finishedWaitsSince, waitSequence } from "./waitLog";

export const ACTIVITY_LOG_URL = "/api/activity-log";
/** A batch waits this long for more entries before it is sent. */
export const FLUSH_DEBOUNCE_MS = 2000;
/** …but never longer than this after its first entry. */
export const FLUSH_MAX_WAIT_MS = 10_000;
/** `sendBeacon` refuses a large body; a batch is split to stay under this. */
export const MAX_BATCH_BYTES = 48 * 1024;

export interface SavedBatch {
  /** Which page load the entries came from. */
  page: string;
  entries: ActivityEntry[];
}

export interface SaverDeps {
  /** `navigator.sendBeacon`, or a stand-in: true when the browser took the request. */
  send: (url: string, body: string) => boolean;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  /** Where to listen for the page being hidden or unloaded; nothing in tests. */
  window?: Pick<Window, "addEventListener" | "removeEventListener"> & { document?: Pick<Document, "visibilityState"> };
}

/** A short random id for this page load, so a reload shows in the saved log. */
export function newPageId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Split `entries` into batches whose JSON stays under `maxBytes`. */
export function batches(page: string, entries: ActivityEntry[], maxBytes = MAX_BATCH_BYTES): string[] {
  const out: string[] = [];
  let current: ActivityEntry[] = [];
  let bytes = 0;
  const overhead = JSON.stringify({ page, entries: [] }).length;
  for (const e of entries) {
    const size = JSON.stringify(e).length + 1;
    if (current.length > 0 && bytes + size + overhead > maxBytes) {
      out.push(JSON.stringify({ page, entries: current } satisfies SavedBatch));
      current = [];
      bytes = 0;
    }
    current.push(e);
    bytes += size;
  }
  if (current.length > 0) out.push(JSON.stringify({ page, entries: current } satisfies SavedBatch));
  return out;
}

export interface Saver {
  page: string;
  /** Send whatever is pending now. */
  flush: () => void;
  /** Stop listening; sends what is pending first. */
  uninstall: () => void;
}

function beacon(url: string, body: string): boolean {
  try {
    return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  } catch {
    return false;
  }
}

/** Start saving. One per page; returns the handle. */
export function installActivitySaver(deps: Partial<SaverDeps> = {}): Saver {
  const send = deps.send ?? beacon;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const win = deps.window ?? (typeof window !== "undefined" ? window : undefined);
  const page = newPageId();

  // What has been sent so far, by sequence number.
  let activitySent = activitySequence();
  let waitsSent = waitSequence();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPending: number | null = null;

  const flush = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    firstPending = null;
    const entries = [...entriesSince(activitySent), ...finishedWaitsSince(waitsSent)];
    const nextActivity = activitySequence();
    const nextWaits = waitSequence();
    if (entries.length === 0) return;
    entries.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    let taken = true;
    for (const body of batches(page, entries)) if (!send(ACTIVITY_LOG_URL, body)) taken = false;
    // A batch the browser refused is tried again with the next one.
    if (taken) {
      activitySent = nextActivity;
      waitsSent = nextWaits;
    }
  };

  const schedule = () => {
    const t = now();
    if (firstPending === null) firstPending = t;
    if (timer !== null) clearTimer(timer);
    const wait = Math.max(0, Math.min(FLUSH_DEBOUNCE_MS, firstPending + FLUSH_MAX_WAIT_MS - t));
    timer = setTimer(flush, wait);
  };

  const stopRecorded = onRecorded(schedule);
  // A finished wait has no listener of its own: the next entry, the hidden
  // page or the unload carries it; and a wait finishing is followed by a
  // message or a model entry more often than not.
  const stopLogging = onActionLoggingChanged((on) => {
    if (on) return;
    // Pending actions were dropped from the log with the rest; what's left
    // goes first, then the saved copy loses its actions too.
    flush();
    send(`${ACTIVITY_LOG_URL}/remove`, JSON.stringify({ kinds: Array.from(USER_ACTION_KINDS) }));
  });

  const onHidden = () => {
    if (!win?.document || win.document.visibilityState === "hidden") flush();
  };
  win?.addEventListener("visibilitychange", onHidden);
  win?.addEventListener("pagehide", flush);

  // Where this page load begins, in the saved log and in the timeline.
  record("logging", "Page loaded", { page });
  flush();

  return {
    page,
    flush,
    uninstall: () => {
      flush();
      stopRecorded();
      stopLogging();
      win?.removeEventListener("visibilitychange", onHidden);
      win?.removeEventListener("pagehide", flush);
    },
  };
}

export interface SavedActivity {
  /** This launch's saved entries, every page load's, oldest first. */
  current: (ActivityEntry & { page?: string })[];
  /** The previous launch's, or an empty list. */
  previous: (ActivityEntry & { page?: string })[];
}

/**
 * Read the saved copy, for a report: this launch's entries from earlier
 * page loads, and the previous launch's. Through XMLHttpRequest rather than
 * `fetch`, which the busy wheel wraps: reading the log for a report mustn't
 * add a wait to it. Rejects after `timeoutMs`.
 */
export function fetchSavedActivity(timeoutMs = 3000): Promise<SavedActivity> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", ACTIVITY_LOG_URL);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`HTTP ${xhr.status}`));
      try {
        const body = JSON.parse(xhr.responseText) as Partial<SavedActivity>;
        resolve({ current: body.current ?? [], previous: body.previous ?? [] });
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error("couldn't read the saved activity log"));
    xhr.ontimeout = () => reject(new Error("timed out"));
    xhr.send();
  });
}
