import { beforeEach, describe, expect, it, vi } from "vitest";

import { announcePnlSourceChanged, onPnlSourceChanged } from "./pnlSourceEvents";

describe("PsyNeuLink source-changed announcements (#1253)", () => {
  // The suite runs on node (vitest.config.ts); an EventTarget is all of
  // `window` this module uses.
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
  });

  it("reaches a listener", () => {
    const listener = vi.fn();
    const off = onPnlSourceChanged(listener);
    announcePnlSourceChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops after unsubscribing", () => {
    const listener = vi.fn();
    const off = onPnlSourceChanged(listener);
    off();
    announcePnlSourceChanged();
    expect(listener).not.toHaveBeenCalled();
  });
});
