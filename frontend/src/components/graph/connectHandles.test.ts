import { describe, expect, it } from "vitest";
import { CONNECT_GESTURE } from "./connectHandles";

describe("how a connection starts (#317)", () => {
  it("never by a click on a handle", () => {
    expect(CONNECT_GESTURE.connectOnClick).toBe(false);
  });
  it("only by a drag past a few pixels, the same as other drags on the graph", () => {
    expect(CONNECT_GESTURE.connectionDragThreshold).toBeGreaterThanOrEqual(4);
  });
});
