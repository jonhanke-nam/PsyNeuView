import { describe, expect, it } from "vitest";

import { ORIENTATION_OFFER_KEY, readOfferChoice, shouldOfferOrientation, shouldRemindFromMenu, writeOfferChoice } from "./orientationOffer";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe("the first-launch orientation offer (#1310)", () => {
  it("is made once: when nothing is remembered and no walkthrough was linked to", () => {
    expect(shouldOfferOrientation(null, "")).toBe(true);
    expect(shouldOfferOrientation(null, "?foo=1")).toBe(true);
    expect(shouldOfferOrientation(null, "?tour=ddm")).toBe(false);
  });

  it("is not made again after any answer", () => {
    for (const choice of ["started", "later", "never"] as const) {
      expect(shouldOfferOrientation(choice, "")).toBe(false);
    }
  });

  it("'maybe later' is what puts the reminder in the Tutorials menu", () => {
    expect(shouldRemindFromMenu("later")).toBe(true);
    expect(shouldRemindFromMenu("never")).toBe(false);
    expect(shouldRemindFromMenu("started")).toBe(false);
    expect(shouldRemindFromMenu(null)).toBe(false);
  });

  it("the answer is remembered per browser, and anything else reads as unanswered", () => {
    const s = storage();
    expect(readOfferChoice(s)).toBeNull();
    writeOfferChoice("later", s);
    expect(s.map.get(ORIENTATION_OFFER_KEY)).toBe("later");
    expect(readOfferChoice(s)).toBe("later");
    expect(readOfferChoice(storage({ [ORIENTATION_OFFER_KEY]: "maybe" }))).toBeNull();
  });

  it("blocked storage reads as unanswered and never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readOfferChoice(blocked)).toBeNull();
    expect(() => writeOfferChoice("never", blocked)).not.toThrow();
  });
});
