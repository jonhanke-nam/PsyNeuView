/** Anything added with no point chosen goes in the middle of what's showing (#252). */
import { afterEach, describe, expect, it } from "vitest";
import { registerVisibleCentre, visibleCentre } from "./graphViewport";

describe("the graph's visible centre (#252)", () => {
  afterEach(() => registerVisibleCentre(null));

  it("answers what the canvas registered", () => {
    registerVisibleCentre(() => ({ x: 120, y: -40 }));
    expect(visibleCentre()).toEqual({ x: 120, y: -40 });
  });

  it("is null with no graph showing, so callers fall back", () => {
    expect(visibleCentre()).toBeNull();
    registerVisibleCentre(() => null);
    expect(visibleCentre()).toBeNull();
  });

  it("never throws", () => {
    registerVisibleCentre(() => { throw new Error("no pane"); });
    expect(visibleCentre()).toBeNull();
  });
});
