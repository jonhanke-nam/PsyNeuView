import { beforeEach, describe, expect, it } from "vitest";
import { targetStatus, useConnectTargets } from "./connectTargetsStore";

describe("connect targets (#253)", () => {
  beforeEach(() => useConnectTargets.getState().clear());

  it("reads valid, invalid and unknown nodes", () => {
    const targets = { a: null, b: "a reason" };
    expect(targetStatus(targets, "a")).toBe("valid");
    expect(targetStatus(targets, "b")).toBe("invalid");
    expect(targetStatus(targets, "c")).toBeNull();
    expect(targetStatus(null, "a")).toBeNull();
  });

  it("drops a late answer for an earlier drag", () => {
    const s = useConnectTargets.getState();
    s.start("first");
    s.start("second");
    s.answer("first", { x: null });
    expect(useConnectTargets.getState().targets).toBeNull();
    s.answer("second", { y: null });
    expect(useConnectTargets.getState().targets).toEqual({ y: null });
  });
});
