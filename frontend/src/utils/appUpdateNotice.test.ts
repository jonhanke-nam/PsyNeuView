import { describe, expect, it } from "vitest";
import {
  UPDATE_NOTICE_DISMISS_KEY,
  UPDATE_NOTICE_SNOOZE_MS,
  loadDismissal,
  saveDismissal,
  shouldShowUpdateNotice,
} from "./appUpdateNotice";

const NOW = 1_800_000_000_000;
const waiting = { available: true, version: "0.6.0" };

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe("shouldShowUpdateNotice (PsyNeuView-MacApp#6)", () => {
  it("shows a waiting update", () => {
    expect(shouldShowUpdateNotice(waiting, null, NOW)).toBe(true);
  });

  it("shows nothing when no update is waiting, or the app doesn't say (older app)", () => {
    expect(shouldShowUpdateNotice({ available: false }, null, NOW)).toBe(false);
    expect(shouldShowUpdateNotice(undefined, null, NOW)).toBe(false);
    expect(shouldShowUpdateNotice({ available: true }, null, NOW)).toBe(false);
  });

  it("hides that version for a day after Later", () => {
    const later = { version: "0.6.0", at: NOW };
    expect(shouldShowUpdateNotice(waiting, later, NOW + 60_000)).toBe(false);
    expect(shouldShowUpdateNotice(waiting, later, NOW + UPDATE_NOTICE_SNOOZE_MS)).toBe(true);
  });

  it("shows a newer version at once, even right after Later", () => {
    const later = { version: "0.6.0", at: NOW };
    expect(shouldShowUpdateNotice({ available: true, version: "0.6.1" }, later, NOW + 1)).toBe(true);
  });
});

describe("dismissal storage", () => {
  it("round-trips", () => {
    const s = storage();
    saveDismissal("0.6.0", NOW, s);
    expect(loadDismissal(s)).toEqual({ version: "0.6.0", at: NOW });
  });

  it("ignores junk and survives blocked storage", () => {
    expect(loadDismissal(storage({ [UPDATE_NOTICE_DISMISS_KEY]: "not json" }))).toBeNull();
    expect(loadDismissal(null)).toBeNull();
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadDismissal(throwing)).toBeNull();
    expect(saveDismissal("0.6.0", NOW, throwing)).toEqual({ version: "0.6.0", at: NOW });
  });
});
