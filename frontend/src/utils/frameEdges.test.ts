import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { memberEnd, retargetFrameEdges } from "./frameEdges";

const mech = (id: string, parentId?: string, ports: { inputPorts?: string[]; outputPorts?: string[] } = {}): Node => ({
  id,
  type: "mechanismNode",
  position: { x: 0, y: 0 },
  data: {
    inputPorts: (ports.inputPorts ?? ["InputPort-0"]).map((name) => ({ name })),
    outputPorts: (ports.outputPorts ?? ["OutputPort-0"]).map((name) => ({ name })),
  },
  ...(parentId ? { parentId } : {}),
});
const frame = (id: string, parentId?: string): Node => ({
  id,
  type: "compositionNode",
  position: { x: 0, y: 0 },
  data: {},
  ...(parentId ? { parentId } : {}),
});
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, type = "projectionEdge"): Edge => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
  type,
});

// EGO, as the backend describes it: STATE feeds EM's STATE [VALUE] through
// EM's input CIM; EM's STATE [RETRIEVED] feeds PREDICTION through its output CIM.
const nodes: Node[] = [
  mech("STATE"),
  mech("PREDICTION"),
  frame("EM"),
  mech("STATE [VALUE]", "EM"),
  mech("STATE [RETRIEVED]", "EM"),
  mech("STATE [FIELD_MEMORY]", "EM"),
];

describe("projections through an open frame's boundary (#209)", () => {
  it("names the member a frame's port carries to, with the member's own port", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(memberEnd("EM", "INPUT_CIM_STATE [VALUE]_InputPort-0", "INPUT_CIM_", byId, nodes)).toEqual({
      id: "STATE [VALUE]",
      handle: "InputPort-0",
    });
    expect(memberEnd("EM", "OUTPUT_CIM_STATE [RETRIEVED]_OutputPort-0", "OUTPUT_CIM_", byId, nodes)).toEqual({
      id: "STATE [RETRIEVED]",
      handle: "OutputPort-0",
    });
    // A mechanism's own end is itself.
    expect(memberEnd("STATE", "OutputPort-0", "OUTPUT_CIM_", byId, nodes)).toEqual({ id: "STATE", handle: "OutputPort-0" });
    // A port the member doesn't list: the member, on its first port.
    expect(memberEnd("EM", "INPUT_CIM_STATE [VALUE]_RESULT", "INPUT_CIM_", byId, nodes)).toEqual({
      id: "STATE [VALUE]",
      handle: undefined,
    });
    // A port naming no member: the frame, as before.
    expect(memberEnd("EM", "INPUT_CIM_NOBODY_InputPort-0", "INPUT_CIM_", byId, nodes)).toEqual({
      id: "EM",
      handle: "INPUT_CIM_NOBODY_InputPort-0",
    });
  });

  it("follows a frame within a frame inward", () => {
    const deep: Node[] = [mech("a"), frame("mid"), frame("inner", "mid"), mech("x", "inner")];
    const byId = new Map(deep.map((n) => [n.id, n]));
    expect(memberEnd("mid", "INPUT_CIM_inner_INPUT_CIM_x_InputPort-0", "INPUT_CIM_", byId, deep)).toEqual({
      id: "x",
      handle: "InputPort-0",
    });
  });

  it("redirects the edges to the members and leaves the rest alone", () => {
    const edges: Edge[] = [
      edge("in", "STATE", "OutputPort-0", "EM", "INPUT_CIM_STATE [VALUE]_InputPort-0"),
      edge("out", "EM", "OUTPUT_CIM_STATE [RETRIEVED]_OutputPort-0", "PREDICTION", "InputPort-0"),
      edge("plain", "STATE", "OutputPort-0", "PREDICTION", "InputPort-0"),
      edge("gsc", "STATE", "OutputPort-0", "EM", "INPUT_CIM_STATE [VALUE]_InputPort-0", "gscEdge"),
    ];
    expect(retargetFrameEdges(nodes, edges)).toEqual(["in", "out"]);
    expect(edges[0]).toMatchObject({ source: "STATE", sourceHandle: "OutputPort-0", target: "STATE [VALUE]", targetHandle: "InputPort-0" });
    expect(edges[1]).toMatchObject({ source: "STATE [RETRIEVED]", sourceHandle: "OutputPort-0", target: "PREDICTION", targetHandle: "InputPort-0" });
    expect(edges[2]).toMatchObject({ source: "STATE", target: "PREDICTION" });
    expect(edges[3]).toMatchObject({ source: "STATE", target: "EM" });
  });

  it("leaves an edge to a folded composition on the folded node", () => {
    // Folded, EM is drawn as one node with the CIM ports as its own.
    const folded: Node[] = [mech("STATE"), mech("EM", undefined, { inputPorts: ["INPUT_CIM_STATE [VALUE]_InputPort-0"] })];
    const edges = [edge("in", "STATE", "OutputPort-0", "EM", "INPUT_CIM_STATE [VALUE]_InputPort-0")];
    expect(retargetFrameEdges(folded, edges)).toEqual([]);
    expect(edges[0]).toMatchObject({ target: "EM", targetHandle: "INPUT_CIM_STATE [VALUE]_InputPort-0" });
  });
});
