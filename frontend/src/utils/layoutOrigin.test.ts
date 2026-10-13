import { describe, expect, it } from "vitest";

import { edgeOrigin, nodeOrigin, originHint, originLabel } from "./layoutOrigin";

const node = (id: string, varName?: string) => ({ id, data: varName ? { varName } : {} });

describe("nodeOrigin", () => {
  it("reads placed when the sidecar has a position under the varName", () => {
    expect(nodeOrigin(node("id-1", "a"), { a: { x: 0, y: 0 } })).toBe("placed");
  });

  it("falls back to the node id, as position resolution does", () => {
    expect(nodeOrigin(node("id-1"), { "id-1": { x: 0, y: 0 } })).toBe("placed");
  });

  it("reads automatic for a node the sidecar does not mention", () => {
    expect(nodeOrigin(node("id-1", "a"), { b: { x: 0, y: 0 } })).toBe("automatic");
  });

  it("reads automatic when there is no sidecar at all", () => {
    expect(nodeOrigin(node("id-1", "a"), null)).toBe("automatic");
    expect(nodeOrigin(node("id-1", "a"), {})).toBe("automatic");
  });

  /** A position of {0,0} is a position — falsy coordinates must not read as absent. */
  it("treats the origin as a real position", () => {
    expect(nodeOrigin(node("id-1", "a"), { a: { x: 0, y: 0 } })).toBe("placed");
  });
});

describe("edgeOrigin", () => {
  it("reads placed only when the edge was actually shaped", () => {
    expect(edgeOrigin("e1", { e1: true })).toBe("placed");
  });

  /** Promote-on-grab writes waypoints without intent; marks are the evidence. */
  it("reads automatic for an edge that was merely grabbed", () => {
    expect(edgeOrigin("e1", {})).toBe("automatic");
    expect(edgeOrigin("e1", null)).toBe("automatic");
  });
});

describe("wording", () => {
  it("says something different for each kind and origin", () => {
    const all = [
      originLabel("placed", "node"), originLabel("automatic", "node"),
      originLabel("placed", "edge"), originLabel("automatic", "edge"),
    ];
    expect(new Set(all).size).toBe(4);
  });

  it("tells an automatic thing how to become a placed one", () => {
    expect(originHint("automatic", "node")).toMatch(/drag/i);
    expect(originHint("automatic", "edge")).toMatch(/drag/i);
  });

  it("does not describe automatic placement as a problem", () => {
    for (const kind of ["node", "edge"] as const) {
      expect(originHint("automatic", kind)).not.toMatch(/error|warning|missing|unsaved|lost/i);
    }
  });
});
