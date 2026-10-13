/**
 * The dialog stack behind useDismiss (#1289): Escape closes the innermost open
 * overlay, nothing else, and leaves alone an Escape that already meant
 * something.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleEscape, openOverlayCount, pushDismiss, type EscapeKeyEvent } from "./useDismiss";

function escape(overrides: Partial<EscapeKeyEvent> = {}): EscapeKeyEvent & { prevented: boolean; stopped: boolean } {
  const e = {
    key: "Escape",
    prevented: false,
    stopped: false,
    preventDefault() {
      e.prevented = true;
    },
    stopPropagation() {
      e.stopped = true;
    },
    ...overrides,
  };
  return e;
}

const listeners = { add: vi.fn(), remove: vi.fn() };

beforeEach(() => {
  listeners.add.mockClear();
  listeners.remove.mockClear();
  vi.stubGlobal("window", { addEventListener: listeners.add, removeEventListener: listeners.remove });
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(openOverlayCount(), "a test left an overlay on the stack").toBe(0);
});

describe("the dialog stack", () => {
  it("Escape closes the overlay opened last, and only that one", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const popOuter = pushDismiss(outer);
    const popInner = pushDismiss(inner);
    expect(openOverlayCount()).toBe(2);

    const e = escape();
    handleEscape(e);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    // Claimed, so nothing further down the line acts on the same key.
    expect(e.prevented).toBe(true);
    expect(e.stopped).toBe(true);

    // The inner one closes (its effect cleanup pops it); the next Escape
    // reaches the outer one.
    popInner();
    handleEscape(escape());
    expect(outer).toHaveBeenCalledTimes(1);
    popOuter();
  });

  it("an overlay that closed out of order is popped, not the one above it", () => {
    const a = vi.fn();
    const b = vi.fn();
    const popA = pushDismiss(a);
    const popB = pushDismiss(b);
    popA();
    expect(openOverlayCount()).toBe(1);
    handleEscape(escape());
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    popB();
    // Popping twice is harmless.
    popA();
    expect(openOverlayCount()).toBe(0);
  });

  it("does nothing with no overlay open, and leaves the event alone", () => {
    const e = escape();
    handleEscape(e);
    expect(e.prevented).toBe(false);
    expect(e.stopped).toBe(false);
  });

  it("leaves an Escape alone that something closer already handled", () => {
    const top = vi.fn();
    const pop = pushDismiss(top);
    // The shortcut recorder, a gesture cancel: they preventDefault and the
    // dialog underneath must stay open.
    handleEscape(escape({ defaultPrevented: true }));
    // A key pressed while composing text is the input method's, not ours.
    handleEscape(escape({ isComposing: true }));
    // Any other key is not Escape.
    handleEscape(escape({ key: "Enter" }));
    expect(top).not.toHaveBeenCalled();
    pop();
  });

  it("listens on the window only while something is open", () => {
    const pop1 = pushDismiss(() => {});
    const pop2 = pushDismiss(() => {});
    expect(listeners.add).toHaveBeenCalledTimes(1);
    expect(listeners.add).toHaveBeenCalledWith("keydown", handleEscape);
    pop1();
    expect(listeners.remove).not.toHaveBeenCalled();
    pop2();
    expect(listeners.remove).toHaveBeenCalledTimes(1);
    expect(listeners.remove).toHaveBeenCalledWith("keydown", handleEscape);
  });
});
