/**
 * The status bar has no spinner of its own (#222 follow-up): the busy wheel
 * is the one spinner on screen. The message and its elapsed time stay.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusBar } from "./StatusBar";

// Rendered on the server, a real store would show its starting state (idle).
vi.mock("@/stores/statusStore", () => ({
  useStatusStore: <T,>(pick: (s: { message: string; startedAt: number }) => T) =>
    pick({ message: "Loading model…", startedAt: Date.now() }),
}));

describe("StatusBar", () => {
  it("shows the message with no spinning glyph", () => {
    const html = renderToStaticMarkup(createElement(StatusBar));
    expect(html).toContain("Loading model…");
    expect(html).not.toContain("◠");
    expect(html).not.toContain("statusSpin");
  });
});
