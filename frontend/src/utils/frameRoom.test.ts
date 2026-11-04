import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { makeRoomForFrames, type Box } from "./frameRoom";

const mech = (id: string, x: number, y: number, parentId?: string): Node => ({
  id,
  type: "mechanismNode",
  position: { x, y },
  data: {},
  ...(parentId ? { parentId } : {}),
});
const frame = (id: string, x: number, y: number, w: number, h: number, parentId?: string): Node => ({
  id,
  type: "compositionNode",
  position: { x, y },
  style: { width: w, height: h },
  data: {},
  ...(parentId ? { parentId } : {}),
});
const sizeOf = (n: Node) =>
  n.type === "compositionNode"
    ? { w: n.style!.width as number, h: n.style!.height as number }
    : { w: 180, h: 60 };
const boxOf = (n: Node): Box => ({ ...n.position, ...sizeOf(n) });
const apart = (a: Box, b: Box) =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

describe("room for an open frame (#208)", () => {
  it("moves the nodes under a frame out the shortest way, and leaves the rest", () => {
    // EGO after EM is opened at its folded node's corner: the frame grows over
    // the neighbours that were arranged around the small node.
    const nodes = [
      frame("EM", 90, 400, 500, 600),
      mech("PREDICTION", 90, 220), // above: clear
      mech("CONTEXT [NORMALIZED]", 420, 520), // near the frame's right edge: goes right
      mech("STATE", 150, 900), // near the bottom edge: goes down
      mech("FAR", 2000, 2000),
    ];
    const moved = makeRoomForFrames(nodes, sizeOf);
    expect(moved.sort()).toEqual(["CONTEXT [NORMALIZED]", "STATE"]);
    expect(nodes[0].position).toEqual({ x: 90, y: 400 });
    expect(nodes[1].position).toEqual({ x: 90, y: 220 });
    expect(nodes[4].position).toEqual({ x: 2000, y: 2000 });
    expect(nodes[2].position).toEqual({ x: 90 + 500 + 12, y: 520 });
    expect(nodes[3].position).toEqual({ x: 150, y: 400 + 600 + 12 });
    for (const n of nodes.slice(1)) expect(apart(boxOf(nodes[0]), boxOf(n))).toBe(true);
  });

  it("carries a node it moves onto another node along the same way", () => {
    const nodes = [
      frame("F", 0, 0, 400, 300),
      mech("under", 300, 100), // goes right, by 112, onto `beside`
      mech("beside", 450, 110),
    ];
    const moved = makeRoomForFrames(nodes, sizeOf);
    expect(moved).toEqual(["under", "beside"]);
    expect(nodes[1].position).toEqual({ x: 412, y: 100 });
    // `beside` moved right too, just clear of `under`.
    expect(nodes[2].position).toEqual({ x: 412 + 180, y: 110 });
  });

  it("leaves two mechanisms the user placed over one another", () => {
    const nodes = [frame("F", 0, 0, 100, 100), mech("a", 500, 500), mech("b", 520, 510)];
    expect(makeRoomForFrames(nodes, sizeOf)).toEqual([]);
  });

  it("does nothing where there is no frame", () => {
    const nodes = [mech("a", 0, 0), mech("b", 10, 10)];
    expect(makeRoomForFrames(nodes, sizeOf)).toEqual([]);
    expect(nodes[1].position).toEqual({ x: 10, y: 10 });
  });

  it("settles members inside a frame first, then the frame among its siblings", () => {
    let refits = 0;
    const nodes = [
      frame("outer", 0, 0, 300, 300),
      frame("inner", 20, 50, 200, 200, "outer"),
      mech("m", 100, 100, "outer"), // under `inner`: moves within `outer`
      mech("s", 250, 100), // under `outer`: moves right
    ];
    const moved = makeRoomForFrames(nodes, sizeOf, { refit: () => (refits += 1) });
    expect(moved).toEqual(["m", "s"]);
    expect(nodes[3].position).toEqual({ x: 312, y: 100 });
    // Refit ran once per group of siblings with a frame: inside `outer`, then the top level.
    expect(refits).toBe(2);
  });
});
