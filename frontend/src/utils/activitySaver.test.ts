/**
 * The saver (#177): entries and finished waits go to the server in batches,
 * not one request each; a batch waits for more, but never too long; the
 * hidden page sends at once; turning action logging off sends what's left
 * and asks for the saved actions to be removed; a refused batch is retried
 * with the next one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearActivity, record, setActionLogging, USER_ACTION_KINDS } from "./activityLog";
import {
  ACTIVITY_LOG_URL,
  FLUSH_DEBOUNCE_MS,
  FLUSH_MAX_WAIT_MS,
  batches,
  installActivitySaver,
  type SavedBatch,
} from "./activitySaver";
import { beginWait, clearWaits } from "./waitLog";

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

interface Sent {
  url: string;
  body: SavedBatch | { kinds: string[] };
}

function harness(opts: { refuse?: () => boolean } = {}) {
  const sent: Sent[] = [];
  const send = (url: string, body: string) => {
    if (opts.refuse?.()) return false;
    sent.push({ url, body: JSON.parse(body) });
    return true;
  };
  const listeners = new Map<string, () => void>();
  const win = {
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
    document: { visibilityState: "visible" as DocumentVisibilityState },
  };
  const saver = installActivitySaver({ send, window: win as never });
  const texts = (i: number) => (sent[i].body as SavedBatch).entries.map((e) => e.text);
  return { sent, saver, win, listeners, texts };
}

beforeEach(() => {
  vi.useFakeTimers();
  stored.clear();
  clearActivity();
  clearWaits();
});

afterEach(() => vi.useRealTimers());

describe("batches", () => {
  it("sends the page-loaded mark at once, then what's recorded a little later, in one batch", () => {
    const h = harness();
    expect(h.sent).toHaveLength(1);
    expect(h.texts(0)).toEqual(["Page loaded"]);
    expect((h.sent[0].body as SavedBatch).page).toBe(h.saver.page);
    record("menu", "Open › a");
    record("model", "Opened ~/a.py");
    expect(h.sent).toHaveLength(1);
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS - 1);
    record("notification", "Loaded", { type: "success" });
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS - 1);
    expect(h.sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].url).toBe(ACTIVITY_LOG_URL);
    expect(h.texts(1)).toEqual(["Open › a", "Opened ~/a.py", "Loaded"]);
    h.saver.uninstall();
  });

  it("never waits longer than the maximum while entries keep coming", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      record("run", `r${i}`);
      vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS - 100);
    }
    // 20 × 1.9 s = 38 s: three flushes at most every 10 s, the last still pending.
    expect(h.sent.length).toBeGreaterThanOrEqual(4);
    const first = h.texts(1);
    expect(first[0]).toBe("r0");
    expect(first.length).toBeLessThanOrEqual(Math.ceil(FLUSH_MAX_WAIT_MS / (FLUSH_DEBOUNCE_MS - 100)) + 1);
    h.saver.uninstall();
  });

  it("carries the waits that finished, in time order with the entries", () => {
    const h = harness();
    const now = Date.now();
    const end = beginWait("POST /api/model/save", { now: now - 100 });
    record("click", "Toolbar › Save");
    end("ok", undefined, now + 400);
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS);
    const entries = (h.sent[1].body as SavedBatch).entries;
    expect(entries.map((e) => [e.kind, e.text.split(" · ")[0]])).toEqual([
      ["wait", "POST /api/model/save"],
      ["click", "Toolbar › Save"],
    ]);
    expect(entries[0].data).toEqual(expect.objectContaining({ outcome: "ok", durationMs: 500 }));
    h.saver.uninstall();
  });

  it("sends at once when the page is hidden or unloading", () => {
    const h = harness();
    record("menu", "Open › a");
    h.win.document.visibilityState = "hidden";
    h.listeners.get("visibilitychange")!();
    expect(h.texts(1)).toEqual(["Open › a"]);
    record("menu", "Open › b");
    h.listeners.get("pagehide")!();
    expect(h.texts(2)).toEqual(["Open › b"]);
    h.saver.uninstall();
    expect(h.sent).toHaveLength(3);
    expect(h.listeners.size).toBe(0);
  });

  it("tries a refused batch again with the next one", () => {
    let refuse = true;
    const h = harness({ refuse: () => refuse });
    record("menu", "a");
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(0);
    refuse = false;
    record("menu", "b");
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS);
    expect(h.texts(0)).toEqual(["Page loaded", "a", "b"]);
    h.saver.uninstall();
  });

  it("splits a big batch so each stays under the beacon's limit", () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ t: "2026-11-03T09:00:00.000Z", kind: "menu" as const, text: `${i} ` + "x".repeat(1000) }));
    const parts = batches("p", big, 10_000);
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.every((p) => p.length <= 10_000)).toBe(true);
    expect(parts.flatMap((p) => (JSON.parse(p) as SavedBatch).entries.map((e) => e.text.split(" ")[0]))).toEqual(big.map((e) => e.text.split(" ")[0]));
    expect(batches("p", [])).toEqual([]);
  });
});

describe("action logging off", () => {
  it("sends what's left, then asks for the saved actions to be removed", () => {
    const h = harness();
    record("menu", "Open › a");
    record("error", "Model error: x");
    setActionLogging(false);
    expect(h.sent.map((s) => s.url)).toEqual([ACTIVITY_LOG_URL, ACTIVITY_LOG_URL, `${ACTIVITY_LOG_URL}/remove`]);
    expect(h.texts(1)).toEqual(["Model error: x", "activity-log-actions = off"]);
    expect(h.sent[2].body).toEqual({ kinds: Array.from(USER_ACTION_KINDS) });
    // From here, actions aren't recorded, so none are sent.
    record("click", "Toolbar › Save");
    record("notification", "Saved", { type: "success" });
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS);
    expect(h.texts(3)).toEqual(["Saved"]);
    h.saver.uninstall();
  });
});
