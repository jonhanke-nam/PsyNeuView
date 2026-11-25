import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  arrowheadFromShowGraph,
  lookFromShowGraph,
  projectionLookFor,
  showGraphEdgesByPair,
} from "./projectionLook";
import { applyProjectionLooks } from "@/stores/modelStore";
import { roleColorFor } from "@/constants/pnlTypes";

// #425: each projection is drawn as show_graph draws it.
describe("a projection's look follows show_graph", () => {
  it("by type: a control projection is a solid blue line ending in a box", () => {
    expect(projectionLookFor("ControlProjection")).toEqual({
      arrowhead: "box", line: "solid", color: "var(--pnv-projection-control)",
    });
    expect(projectionLookFor("MappingProjection")).toEqual({
      arrowhead: "normal", line: "solid", color: "var(--pnv-projection-mapping)",
    });
    expect(projectionLookFor("AutoAssociativeProjection").arrowhead).toBe("normal");
    expect(projectionLookFor("LearningProjection")).toEqual({
      arrowhead: "normal", line: "solid", color: "var(--pnv-projection-learning)",
    });
    // show_graph decides by the sender: anything from a control node controls.
    expect(projectionLookFor("MappingProjection", { fromControl: true }).arrowhead).toBe("box");
    // The controller's own, in its colour.
    expect(projectionLookFor("ControlProjection", { fromController: true })).toEqual({
      arrowhead: "box", line: "solid", color: "var(--pnv-projection-controller)",
    });
  });

  it("show_graph's own edge decides where there is one", () => {
    const base = projectionLookFor("MappingProjection");
    expect(lookFromShowGraph(base, { sender: "LC", receiver: "R", arrowhead: "box", color: "blue" })).toEqual({
      arrowhead: "box", line: "solid", color: "var(--pnv-projection-control)",
    });
    expect(lookFromShowGraph(base, { sender: "a", receiver: "b", color: "purple", style: "dashed" }).line).toBe("dashed");
    expect(lookFromShowGraph(base, undefined)).toBe(base);
    expect(arrowheadFromShowGraph("vee")).toBe("normal");
    expect(arrowheadFromShowGraph("none")).toBe("none");
    expect(arrowheadFromShowGraph(undefined)).toBeNull();
  });

  it("hands out show_graph's edges in order between the same two nodes", () => {
    const pairs = showGraphEdgesByPair([
      { sender: "a", receiver: "b", arrowhead: "normal" },
      { sender: "a", receiver: "b", arrowhead: "box" },
      { sender: "b", receiver: "b" },
    ]);
    expect(pairs.get("a\u0000b")!.map((e) => e.arrowhead)).toEqual(["normal", "box"]);
    expect(pairs.get("b\u0000b")).toHaveLength(1);
  });

  it("the model's edges take their arrowhead, line and colour (Gilzenrat)", () => {
    const node = (id: string, roles: string[] = []): Node => ({ id, position: { x: 0, y: 0 }, data: { roles }, type: "mechanismNode" });
    const edge = (id: string, source: string, target: string, type: string, dash?: string): Edge => ({
      id, source, target, type: "projectionEdge", data: { type }, style: { strokeWidth: 2, ...(dash ? { strokeDasharray: dash } : {}) },
    });
    const nodes = [node("LC", ["CONTROL"]), node("RESPONSE"), node("DECISION LAYER")];
    const edges = [
      edge("c1", "LC", "RESPONSE", "ControlProjection", "6 3"),
      edge("c2", "LC", "DECISION LAYER", "ControlProjection"),
      edge("m", "DECISION LAYER", "RESPONSE", "MappingProjection"),
      edge("loop", "RESPONSE", "RESPONSE", "AutoAssociativeProjection"),
      { ...edge("x", "RESPONSE", "LC", "InactiveProjection", "4 4") },
    ];
    applyProjectionLooks(nodes, edges, [
      { sender: "LC", receiver: "RESPONSE", arrowhead: "box", color: "blue" },
      { sender: "RESPONSE", receiver: "RESPONSE", arrowhead: "normal", color: "black" },
    ]);
    const by = Object.fromEntries(edges.map((e) => [e.id, e]));
    // From show_graph's edge, and by the rule where it has none: the same.
    for (const id of ["c1", "c2"]) {
      expect((by[id].data as any).arrowhead, id).toBe("box");
      expect(by[id].style?.strokeDasharray, id).toBeUndefined();
      expect(by[id].style?.stroke, id).toBe("var(--pnv-projection-control)");
    }
    expect((by.m.data as any).arrowhead).toBe("normal");
    expect((by.loop.data as any).arrowhead).toBe("normal");
    expect(by.loop.style?.stroke).toBe("var(--pnv-projection-mapping)");
    // PsyNeuView's own kinds keep their look.
    expect(by.x.style?.strokeDasharray).toBe("4 4");
    expect((by.x.data as any).arrowhead).toBeUndefined();
  });
});

describe("a control node's colour (#425)", () => {
  it("is show_graph's control colour, unless it is an input, output or probe", () => {
    expect(roleColorFor(["CONTROL", "FEEDBACK_SENDER"])).toBe("var(--pnv-role-control)");
    expect(roleColorFor(["CONTROL", "OUTPUT"])).toBe("var(--pnv-role-output)");
    expect(roleColorFor(["CONTROL", "INPUT"])).toBe("var(--pnv-role-input)");
    expect(roleColorFor(["CONTROLLER"])).toBe("var(--pnv-role-controller)");
  });
});
