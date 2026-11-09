import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { clampIoDrag, ioRowViolations, tidyIoRows } from "./ioRows";
import { ioRowsNotApplying } from "@/stores/ioRowsStore";

/** A 100×40 mechanism node at (x, y), with roles. */
const mech = (id: string, x: number, y: number, roles: string[] = [], parentId?: string): Node => ({
  id,
  type: "mechanismNode",
  position: { x, y },
  measured: { width: 100, height: 40 },
  data: { label: id, roles },
  ...(parentId ? { parentId } : {}),
});
const frame = (id: string, x: number, y: number, w: number, h: number): Node => ({
  id,
  type: "compositionNode",
  position: { x, y },
  style: { width: w, height: h },
  data: { label: id },
});
const at = (nodes: Node[], id: string) => nodes.find((n) => n.id === id)!.position;

describe("ioRowViolations", () => {
  it("passes inputs at the bottom and outputs at the top", () => {
    const nodes = [mech("in", 0, 200, ["INPUT"]), mech("mid", 0, 100), mech("out", 0, 0, ["OUTPUT"])];
    expect(ioRowViolations(nodes)).toEqual([]);
  });

  it("reports a node below an input, and outputs on two rows", () => {
    const nodes = [
      mech("in", 0, 100, ["INPUT"]),
      mech("loose", 200, 200),
      mech("out1", 0, 0, ["OUTPUT"]),
      mech("out2", 200, 100, ["OUTPUT"]),
    ];
    const v = ioRowViolations(nodes);
    expect(v).toContain("input in above loose");
    expect(v).toContain("outputs out1 and out2 on different rows");
  });

  it("lets learning and control apparatus sit above the outputs", () => {
    const nodes = [mech("in", 0, 200, ["INPUT"]), mech("out", 0, 100, ["OUTPUT"]), mech("loss", 0, 0, ["LEARNING"])];
    expect(ioRowViolations(nodes)).toEqual([]);
  });

  it("leaves a node that is both input and output out of it", () => {
    const nodes = [mech("in", 0, 200, ["INPUT"]), mech("both", 0, 400, ["INPUT", "OUTPUT"]), mech("out", 0, 0, ["OUTPUT"])];
    expect(ioRowViolations(nodes)).toEqual([]);
  });

  it("judges each composition on its own", () => {
    // Inside F the input is at the bottom; outside, the outer input is below F's members' coordinates, which doesn't matter.
    const nodes = [
      frame("F", 0, 0, 400, 300),
      mech("fin", 10, 200, ["INPUT"], "F"),
      mech("fout", 10, 50, ["OUTPUT"], "F"),
      mech("in", 500, 100, ["INPUT"]),
      mech("out", 500, 0, ["OUTPUT"]),
    ];
    expect(ioRowViolations(nodes)).toEqual([]);
    const broken = nodes.map((n) => (n.id === "fin" ? { ...n, position: { x: 10, y: 10 } } : n));
    expect(ioRowViolations(broken)).toEqual(["input fin above fout (in F)", "output fout below fin (in F)"]);
  });
});

describe("tidyIoRows", () => {
  it("leaves a layout that keeps the rule exactly as it is", () => {
    const nodes = [mech("in", 0, 200, ["INPUT"]), mech("out", 0, 0, ["OUTPUT"])];
    const tidied = tidyIoRows(nodes);
    expect(tidied.moved).toEqual([]);
    expect(tidied.nodes).toBe(nodes);
  });

  it("moves the inputs below a node that receives nothing (EGO's case), without overlapping", () => {
    const nodes = [
      mech("in1", 0, 100, ["INPUT"]),
      mech("in2", 0, 100, ["INPUT"]),
      mech("loose", 200, 200),
      mech("out", 0, 0, ["OUTPUT"]),
    ];
    const { nodes: out, moved } = tidyIoRows(nodes);
    expect(ioRowViolations(out)).toEqual([]);
    expect(moved.sort()).toEqual(["in1", "in2"]);
    expect(at(out, "in1").y).toBe(at(out, "in2").y);
    expect(at(out, "in1").y).toBeGreaterThan(240);
    expect(Math.abs(at(out, "in1").x - at(out, "in2").x)).toBeGreaterThanOrEqual(100);
    // The given nodes are not changed.
    expect(nodes[0].position).toEqual({ x: 0, y: 100 });
  });

  it("puts outputs on different rows (Botvinick's case) onto the top row", () => {
    const nodes = [
      mech("in", 0, 300, ["INPUT"]),
      mech("hidden", 0, 200),
      mech("out1", 0, 100, ["OUTPUT"]),
      mech("out2", 200, 0, ["OUTPUT"]),
    ];
    const { nodes: out } = tidyIoRows(nodes);
    expect(ioRowViolations(out)).toEqual([]);
    expect(at(out, "out1").y).toBe(at(out, "out2").y);
  });

  it("keeps a nested composition's members inside its frame, which grows to fit", () => {
    const nodes = [
      frame("F", 0, 0, 300, 200),
      mech("fin", 20, 40, ["INPUT"], "F"),
      mech("loose", 150, 140, [], "F"),
      mech("fout", 20, 90, ["OUTPUT"], "F"),
    ];
    const { nodes: out } = tidyIoRows(nodes);
    expect(ioRowViolations(out)).toEqual([]);
    const f = out.find((n) => n.id === "F")!;
    const bottom = Math.max(...out.filter((n) => n.parentId === "F").map((n) => n.position.y + 40));
    const top = Math.min(...out.filter((n) => n.parentId === "F").map((n) => n.position.y));
    expect(f.style!.height as number).toBeGreaterThan(bottom);
    expect(top).toBeGreaterThanOrEqual(40);
  });
});

describe("clampIoDrag", () => {
  const nodes = [mech("in", 0, 300, ["INPUT"]), mech("mid", 0, 150), mech("out", 0, 0, ["OUTPUT"]), mech("loss", 200, 0, ["LEARNING"])];
  const node = (id: string) => nodes.find((n) => n.id === id)!;

  it("slides an input or an output sideways along its row", () => {
    expect(clampIoDrag(node("in"), { x: 80, y: 10 }, nodes)).toEqual({ x: 80, y: 300 });
    expect(clampIoDrag(node("out"), { x: -50, y: 250 }, nodes)).toEqual({ x: -50, y: 0 });
  });

  it("keeps another node between the outputs' row and the inputs' row", () => {
    expect(clampIoDrag(node("mid"), { x: 10, y: 500 }, nodes)).toEqual({ x: 10, y: 300 });
    expect(clampIoDrag(node("mid"), { x: 10, y: -200 }, nodes)).toEqual({ x: 10, y: 0 });
    expect(clampIoDrag(node("mid"), { x: 10, y: 120 }, nodes)).toEqual({ x: 10, y: 120 });
  });

  it("lets the apparatus go above the outputs, not below the inputs", () => {
    expect(clampIoDrag(node("loss"), { x: 200, y: -200 }, nodes)).toEqual({ x: 200, y: -200 });
    expect(clampIoDrag(node("loss"), { x: 200, y: 900 }, nodes)).toEqual({ x: 200, y: 300 });
  });

  it("leaves frames and both-ways nodes free, and compares within the composition", () => {
    const f = frame("F", 0, 0, 300, 200);
    expect(clampIoDrag(f, { x: 5, y: 999 }, nodes)).toEqual({ x: 5, y: 999 });
    const both = mech("both", 0, 0, ["INPUT", "OUTPUT"]);
    expect(clampIoDrag(both, { x: 5, y: 999 }, nodes)).toEqual({ x: 5, y: 999 });
    const inside = mech("inner", 0, 0, [], "F");
    expect(clampIoDrag(inside, { x: 5, y: 999 }, [...nodes, inside])).toEqual({ x: 5, y: 999 });
  });
});

describe("ioRowsNotApplying", () => {
  it("applies to Like show_graph and to Layered bottom-to-top only", () => {
    expect(ioRowsNotApplying("showgraph", "BT")).toBeNull();
    expect(ioRowsNotApplying("showgraph", "TB")).toBeNull();
    expect(ioRowsNotApplying("layered", "BT")).toBeNull();
    expect(ioRowsNotApplying("layered", "TB")).toMatch(/top-down/);
    expect(ioRowsNotApplying("layered", "LR")).toMatch(/sideways/);
    expect(ioRowsNotApplying("radial", "BT")).toMatch(/Radial/);
    expect(ioRowsNotApplying("force", "BT")).toMatch(/Force/);
  });
});
