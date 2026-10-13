import { describe, expect, it } from "vitest";

import { findGscEdgeId, gscEdgeId } from "./gscEdgeId";

const edge = (gscId: string, source: string, target: string, targetNode: string) => ({
  id: gscEdgeId(gscId, source, target),
  data: { gscId, targetNode },
});

describe("the edge for a graph-condition row (#1370)", () => {
  // AfterNodes(A, B) on TARGET: two edges, A -> TARGET and B -> TARGET.
  const EDGES = [
    { id: "proj_1", data: {} },
    edge("gsc_0", "A", "TARGET", "A"),
    edge("gsc_0", "B", "TARGET", "B"),
    edge("gsc_1", "C", "A", "A"),
  ];

  it("names both endpoints (#651)", () => {
    expect(gscEdgeId("gsc_0", "A", "TARGET")).toBe("gsc_gsc_0_A__TARGET");
  });

  it("selects an edge that exists, not the bare condition id", () => {
    const id = findGscEdgeId(EDGES, "gsc_0");
    expect(EDGES.map((e) => e.id)).toContain(id);
    expect(id).not.toBe("gsc_gsc_0");
  });

  it("picks the condition's first edge for its owner's row", () => {
    expect(findGscEdgeId(EDGES, "gsc_0")).toBe("gsc_gsc_0_A__TARGET");
  });

  it("picks the edge to the target whose row was clicked", () => {
    expect(findGscEdgeId(EDGES, "gsc_0", "B")).toBe("gsc_gsc_0_B__TARGET");
  });

  it("falls back to the first edge when the node draws none of them", () => {
    expect(findGscEdgeId(EDGES, "gsc_0", "TARGET")).toBe("gsc_gsc_0_A__TARGET");
  });

  it("is null for a condition with no edge on the canvas", () => {
    expect(findGscEdgeId(EDGES, "gsc_9")).toBeNull();
  });
});
