import { describe, expect, it } from "vitest";

import { coveredByDialog } from "./TourOverlay";

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
