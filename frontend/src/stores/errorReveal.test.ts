import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "./modelStore";

// Clicking a model error to jump to its line (#1103).
//
// A user's banner said "Error (line 241)" while their editor was showing lines
// 203-206 of a 514-line file. The line number was correct — the file the server
// parsed really was missing a comma there — but nothing was clickable, so being
// told the location didn't help him reach it.

describe("revealModelError", () => {
  beforeEach(() => {
    useModelStore.setState({ errorRevealNonce: 0, modelErrorLine: null });
  });

  it("starts at zero, which means nobody has asked yet", () => {
    // The editor effect must ignore the initial value, or it would yank the
    // cursor to the error the moment a model with an error is opened.
    expect(useModelStore.getState().errorRevealNonce).toBe(0);
  });

  it("bumps on each request", () => {
    useModelStore.getState().revealModelError();
    expect(useModelStore.getState().errorRevealNonce).toBe(1);
  });

  it("keeps bumping, so repeated clicks each re-trigger the jump", () => {
    // This is why it is a counter and not a boolean: scroll away, click again,
    // go back. A flag would work exactly once.
    const reveal = useModelStore.getState().revealModelError;
    reveal();
    reveal();
    reveal();
    expect(useModelStore.getState().errorRevealNonce).toBe(3);
  });

  it("is independent of the error line itself", () => {
    // The line can change under it (a re-introspect after an edit) without
    // losing a pending request, and asking does not alter the line.
    useModelStore.setState({ modelErrorLine: 241 });
    useModelStore.getState().revealModelError();
    expect(useModelStore.getState().modelErrorLine).toBe(241);
    expect(useModelStore.getState().errorRevealNonce).toBe(1);
  });
});
