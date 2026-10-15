import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { applyDagreLayout, openFrameEnds } from "./layout";

// EGO with its EM composition opened (#25), reduced: outer nodes feed EM and
// EM feeds PREDICTION — edges that end on the frame itself — while EM's
// members are connected among themselves.
const mech = (id: string, parentId?: string, roles?: string[]): Node => ({
  id,
  type: "mechanismNode",
  position: { x: 0, y: 0 },
  data: { label: id, ...(roles ? { roles } : {}) },
  ...(parentId ? { parentId } : {}),
});
const frame = (id: string): Node => ({
  id,
  type: "compositionNode",
  position: { x: 0, y: 0 },
  data: { label: id, inset: false },
});
const edge = (source: string, target: string, type = "projection"): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type,
});

const NODES: Node[] = [
  mech("STATE", undefined, ["INPUT"]),
  mech("CONTEXT"),
  frame("EM"),
  mech("STATE [QUERY]", "EM"),
  mech("CONTEXT [QUERY]", "EM"),
  mech("STATE [FIELD_MEMORY]", "EM"),
  mech("CONTEXT [FIELD_MEMORY]", "EM"),
  mech("COMBINED SCORES", "EM"),
  mech("STATE [RETRIEVED]", "EM"),
  mech("PREDICTION", undefined, ["OUTPUT"]),
];
const EDGES: Edge[] = [
  edge("STATE", "CONTEXT"),
  edge("STATE", "EM"),
  edge("CONTEXT", "EM"),
  edge("STATE [QUERY]", "STATE [FIELD_MEMORY]"),
  edge("CONTEXT [QUERY]", "CONTEXT [FIELD_MEMORY]"),
  edge("STATE [FIELD_MEMORY]", "COMBINED SCORES"),
  edge("CONTEXT [FIELD_MEMORY]", "COMBINED SCORES"),
  edge("COMBINED SCORES", "STATE [RETRIEVED]"),
  edge("EM", "PREDICTION"),
  edge("EM", "CONTEXT", "gscEdge"),
];

describe("Layered with an open composition (#25)", () => {
  it("lays out a graph with edges that end on the open frame", () => {
    // Dagre threw on these; the store's fallback then stacked every member
    // in one tall column.
    expect(() => applyDagreLayout(NODES, EDGES, { direction: "BT" })).not.toThrow();
  });

  it("ranks the members in rows, not one column", () => {
    const laid = applyDagreLayout(NODES, EDGES, { direction: "BT" });
    const members = laid.filter((n) => n.parentId === "EM");
    const rows = new Set(members.map((n) => Math.round(n.position.y)));
    const cols = new Set(members.map((n) => Math.round(n.position.x)));
    expect(rows.size).toBeLessThan(members.length);
    expect(cols.size).toBeGreaterThan(1);
    // BT: a query sits below what it feeds.
    const y = (id: string) => laid.find((n) => n.id === id)!.position.y;
    expect(y("STATE [QUERY]")).toBeGreaterThan(y("STATE [FIELD_MEMORY]"));
    expect(y("COMBINED SCORES")).toBeGreaterThan(y("STATE [RETRIEVED]"));
  });

  it("places members relative to their frame, inside it", () => {
    const laid = applyDagreLayout(NODES, EDGES, { direction: "BT" });
    for (const n of laid.filter((m) => m.parentId === "EM")) {
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.y).toBeGreaterThanOrEqual(0);
    }
    // The flow reads through the frame: inputs below it, the output above.
    const at = (id: string) => laid.find((n) => n.id === id)!.position;
    expect(at("STATE").y).toBeGreaterThan(at("EM").y);
    expect(at("PREDICTION").y).toBeLessThan(at("EM").y);
  });

  it("enters a frame at its entry members and leaves from its exit members", () => {
    const ends = openFrameEnds(NODES, EDGES);
    expect(ends.entries("EM").sort()).toEqual(["CONTEXT [QUERY]", "STATE [QUERY]"]);
    expect(ends.exits("EM")).toEqual(["STATE [RETRIEVED]"]);
    expect(ends.entries("STATE")).toEqual(["STATE"]);
  });

  it("prefers INPUT and OUTPUT members when the frame marks them", () => {
    const nodes = [frame("F"), mech("a", "F", ["INPUT"]), mech("b", "F"), mech("c", "F", ["OUTPUT"])];
    const ends = openFrameEnds(nodes, [edge("a", "b"), edge("b", "c")]);
    expect(ends.entries("F")).toEqual(["a"]);
    expect(ends.exits("F")).toEqual(["c"]);
  });

  it("follows an open frame inside an open frame down to its members", () => {
    const outer = frame("OUT");
    const inner = { ...frame("IN"), parentId: "OUT" };
    const nodes = [outer, inner, mech("x", "IN"), mech("y", "IN")];
    const ends = openFrameEnds(nodes, [edge("x", "y")]);
    expect(ends.entries("OUT")).toEqual(["x"]);
    expect(ends.exits("OUT")).toEqual(["y"]);
  });
});
