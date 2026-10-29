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
  /** An element with words of its own: with no DOM to measure, all of it counts as letters. */
  const words = (l: number, t: number, r: number, b: number, tagName = "SPAN") =>
    Object.assign(el(l, t, r, b), { tagName, childNodes: [{ nodeType: 3, textContent: "words" }] });
  it("sits outside where the gap is the background round the anchor", () => {
    const bg = el(0, 0, 1000, 1000);
    expect(ringSides(rect, 10, 4, () => bg)).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });
  it("tucks inside a side whose gap holds something else", () => {
    const bg = el(0, 0, 1000, 1000);
    const textAbove = words(90, 85, 320, 95);
    const topAt = (_x: number, y: number) => (y < 100 ? textAbove : bg);
    const s = ringSides(rect, 10, 4, topAt);
    expect(s.top).toBeLessThan(0);
    expect(s.bottom).toBe(10);
  });
  it("stays outside where what is in the gap is cleared (a node's lines)", () => {
    const bg = el(0, 0, 1000, 1000);
    const line = words(190, 40, 210, 100, "path");
    const topAt = (_x: number, y: number) => (y < 100 ? line : bg);
    expect(ringSides(rect, 10, 4, topAt).top).toBeLessThan(0);
    expect(ringSides(rect, 10, 4, topAt, (e) => e === line).top).toBe(10);
  });
  it("hugs a small anchor whose neighbours are close, rather than cutting into it (a toolbar button)", () => {
    const button = { left: 100, top: 10, width: 70, height: 28 };
    const toolbar = el(0, 0, 1000, 48);
    const history = words(60, 10, 96, 38, "BUTTON");
    const save = words(174, 10, 230, 38, "BUTTON");
    const below = words(0, 48, 1000, 1000);
    const open = words(100, 10, 170, 38, "BUTTON");
    const topAt = (x: number, y: number) =>
      y >= 48 ? below : y < 10 || y >= 38 ? toolbar : x >= 60 && x < 96 ? history : x >= 100 && x < 170 ? open : x >= 174 && x < 230 ? save : toolbar;
    // The full pad (10) lands on History and Save; 6 fits in the 4px gaps
    // only as the ring's outer edge, so it hugs there.
    const s = ringSides(button, 10, 4, topAt);
    expect(s.top).toBe(10);
    expect(s.left).toBeGreaterThan(0);
    expect(s.right).toBeGreaterThan(0);
    expect(s.bottom).toBeGreaterThan(0);
  });
  it("sits on a neighbour's empty padding, not on its text (the Run panel below its tabs)", () => {
    const bg = el(0, 0, 1000, 1000);
    const tabBar = Object.assign(el(0, 60, 1000, 100), { tagName: "DIV", childNodes: [] });
    const tabLabel = words(120, 60, 180, 85, "BUTTON");
    // The tabs' labels end at 85; below them, the bar is padding.
    const topAt = (x: number, y: number) => (y < 85 && x >= 120 && x < 180 ? tabLabel : y < 100 ? tabBar : bg);
    expect(ringSides(rect, 10, 4, topAt).top).toBe(10);
    // A label reaching down into the gap still pushes the side in.
    const lowLabel = (x: number, y: number) => (y < 100 && x >= 120 && x < 180 ? tabLabel : y < 100 ? tabBar : bg);
    expect(ringSides(rect, 10, 4, lowLabel).top).toBeLessThan(0);
  });
  it("still tucks inside a big anchor (a panel) when even the hug is taken", () => {
    const bg = el(0, 0, 1000, 1000);
    const textAbove = words(90, 90, 320, 99.5);
    const topAt = (_x: number, y: number) => (y < 100 ? textAbove : bg);
    expect(ringSides(rect, 10, 4, topAt).top).toBeLessThan(0);
  });
});
