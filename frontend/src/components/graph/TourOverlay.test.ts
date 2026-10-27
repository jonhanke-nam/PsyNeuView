import { describe, expect, it } from "vitest";

import { coveredByDialog, ringSides } from "./TourOverlay";

/** A stand-in element: `contains` answers from a fixed set of descendants. */
function fakeEl(...inside: object[]) {
  return { contains: (el: object) => inside.includes(el) } as unknown as Element;
}

function docWith(modals: Element[]) {
  return { querySelectorAll: () => modals } as unknown as Document;
}

describe("coveredByDialog (#1394)", () => {
  const node = {} as Element;
  const settingsRow = {} as Element;

  it("never hides an anchor when no modal is open", () => {
    expect(coveredByDialog(node, docWith([]))).toBe(false);
  });

  it("hides an anchor behind an open modal", () => {
    expect(coveredByDialog(node, docWith([fakeEl(settingsRow)]))).toBe(true);
  });

  it("keeps an anchor inside the open modal (the orientation's Settings steps)", () => {
    expect(coveredByDialog(settingsRow, docWith([fakeEl(settingsRow)]))).toBe(false);
  });

  it("keeps an anchor inside any of several open modals", () => {
    expect(coveredByDialog(settingsRow, docWith([fakeEl(), fakeEl(settingsRow)]))).toBe(false);
  });
});

describe("ringSides (#102)", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };
  const el = (l: number, t: number, r: number, b: number) =>
    ({ getBoundingClientRect: () => ({ left: l, top: t, right: r, bottom: b }) }) as unknown as Element;
  it("sits outside where the gap is the background round the anchor", () => {
    const bg = el(0, 0, 1000, 1000);
    expect(ringSides(rect, 10, 4, () => bg)).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });
  it("tucks inside a side whose gap holds something else", () => {
    const bg = el(0, 0, 1000, 1000);
    const textAbove = el(90, 85, 320, 95);
    const topAt = (_x: number, y: number) => (y < 100 ? textAbove : bg);
    const s = ringSides(rect, 10, 4, topAt);
    expect(s.top).toBeLessThan(0);
    expect(s.bottom).toBe(10);
  });
});
