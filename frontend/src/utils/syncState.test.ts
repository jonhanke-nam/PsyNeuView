import { describe, expect, it } from "vitest";

import { deriveSyncState, RELOADED_MS, type SyncInputs } from "./syncState";

const base: SyncInputs = {
  connected: true,
  watchedPath: "/tmp/model.py",
  filePath: "/tmp/model.py",
  hasConflict: false,
  lastAppliedAt: null,
  now: 1_000_000,
};

const kind = (o: Partial<SyncInputs>) => deriveSyncState({ ...base, ...o }).kind;

describe("deriveSyncState", () => {
  it("is watching when armed and quiet", () => {
    expect(kind({})).toBe("watching");
  });

  it("names the file it is watching", () => {
    expect(deriveSyncState(base).hint).toContain("model.py");
  });

  /** The failure this exists for: socket up, watching nothing. */
  it("is off when connected but not armed", () => {
    expect(kind({ watchedPath: null })).toBe("off");
  });

  it("is off when the socket dropped", () => {
    expect(kind({ connected: false })).toBe("off");
  });

  it("is off with no model open, and says so differently", () => {
    expect(kind({ filePath: null })).toBe("off");
    expect(deriveSyncState({ ...base, filePath: null }).label).not.toBe(
      deriveSyncState({ ...base, connected: false }).label,
    );
  });

  it("shows reloaded briefly after a change lands", () => {
    expect(kind({ lastAppliedAt: base.now - 500 })).toBe("reloaded");
  });

  it("falls back to watching once that has passed", () => {
    expect(kind({ lastAppliedAt: base.now - RELOADED_MS - 1 })).toBe("watching");
  });

  /** A decision the user owes us outranks any description of us. */
  it("reports a conflict above everything else", () => {
    expect(kind({ hasConflict: true })).toBe("conflict");
    expect(kind({ hasConflict: true, connected: false })).toBe("conflict");
    expect(kind({ hasConflict: true, lastAppliedAt: base.now })).toBe("conflict");
  });

  it("gives every state its own wording", () => {
    const all = [
      deriveSyncState(base),
      deriveSyncState({ ...base, watchedPath: null }),
      deriveSyncState({ ...base, filePath: null }),
      deriveSyncState({ ...base, hasConflict: true }),
      deriveSyncState({ ...base, lastAppliedAt: base.now }),
    ];
    expect(new Set(all.map((s) => s.label)).size).toBe(all.length);
    expect(all.every((s) => s.hint.length > 0)).toBe(true);
  });

  /** "Not watching" is a fact to act on, not an error to apologise for. */
  it("does not describe being off as a failure", () => {
    for (const o of [{ connected: false }, { watchedPath: null }, { filePath: null }]) {
      expect(deriveSyncState({ ...base, ...o }).label).not.toMatch(/error|failed|broken/i);
    }
  });
});
