import { describe, expect, it } from "vitest";
import {
  UPDATE_NOTICE_DISMISS_KEY,
  UPDATE_NOTICE_SNOOZE_MS,
  loadDismissal,
  macAppLine,
  psyneuviewVersionLine,
  releasedPhrase,
  saveDismissal,
  shouldShowUpdateNotice,
  updateNoticeText,
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

describe("when the waiting update was released (#15)", () => {
  // Built in local time, so the test holds in any time zone. ICU may put a
  // narrow no-break space before "PM"; compare with plain spaces.
  const plain = (t: string | null) => t?.replace(/\s/g, " ") ?? null;
  const now = new Date(2026, 9, 15, 16, 40);

  it("gives the date, the time and how long ago", () => {
    const iso = new Date(2026, 9, 15, 14, 33).toISOString();
    expect(plain(releasedPhrase(iso, now))).toBe("released Oct 15, 2:33 PM (2 hours ago)");
  });

  it("adds the year only for another year", () => {
    const iso = new Date(2025, 11, 30, 9, 5).toISOString();
    expect(plain(releasedPhrase(iso, now))).toMatch(/^released Dec 30, 2025, 9:05 AM \(\d+ days ago\)$/);
  });

  it("says nothing when the date is unknown or unreadable", () => {
    expect(releasedPhrase(null, now)).toBeNull();
    expect(releasedPhrase(undefined, now)).toBeNull();
    expect(releasedPhrase("not a date", now)).toBeNull();
  });
});

describe("Settings ▸ About dates (#15)", () => {
  const plain = (t: string | null) => t?.replace(/\s/g, " ") ?? null;
  const now = new Date(2026, 9, 15, 16, 40);
  const built = new Date(2026, 9, 15, 14, 33).toISOString();
  const install = (o: object = {}) => ({
    install: {
      running: "", choice: "bundled" as const, checkoutPath: null, includedVersion: "0.6.2",
      recentCheckouts: [], includedReleasedAt: built, ...o,
    },
  });

  it("names the Mac app's version and when it was built", () => {
    expect(plain(macAppLine({ name: "PsyNeuView", version: "0.6.2", build: "0.6.2", builtAt: built }, now)))
      .toBe("0.6.2, built Oct 15, 2:33 PM (2 hours ago)");
    expect(macAppLine({ name: "PsyNeuView", version: "0.6.2", build: "142", builtAt: null }, now))
      .toBe("0.6.2 (build 142)");
    expect(macAppLine(undefined, now)).toBeNull();
  });

  it("adds the release date only for the copy included with the app", () => {
    expect(plain(psyneuviewVersionLine("0.6.2", install(), now))).toBe("0.6.2, released Oct 15, 2:33 PM (2 hours ago)");
    // A checkout, another version, no date, or no app: the version alone.
    expect(psyneuviewVersionLine("0.6.2", install({ choice: "checkout" }), now)).toBe("0.6.2");
    expect(psyneuviewVersionLine("0.6.3", install(), now)).toBe("0.6.3");
    expect(psyneuviewVersionLine("0.6.2", install({ includedReleasedAt: null }), now)).toBe("0.6.2");
    expect(psyneuviewVersionLine("0.6.2", null, now)).toBe("0.6.2");
  });
});

describe("the notice's words", () => {
  it("names the waiting version", () => {
    expect(updateNoticeText({ available: true, version: "0.6.5" })).toBe("PsyNeuView 0.6.5 is available");
  });

  it("says when the waiting version is a release candidate", () => {
    expect(updateNoticeText({ available: true, version: "0.6.5-rc1", candidate: true })).toBe(
      "PsyNeuView 0.6.5-rc1 (release candidate) is available",
    );
  });
});
