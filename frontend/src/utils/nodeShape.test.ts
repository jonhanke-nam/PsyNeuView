/**
 * Node shapes follow show_graph (#192, #193): which node gets which shape,
 * what the shape says, and where its outline is for ports and edge ends.
 */
import { describe, expect, it } from "vitest";
import {
  boundaryDir,
  boundaryInward,
  nodeShapeFor,
  onShapeBoundary,
  polygonPoints,
  shapeTooltip,
} from "./nodeShape";

describe("nodeShapeFor", () => {
  it("gives show_graph's shape to each kind of node", () => {
    expect(nodeShapeFor({ type: "TransferMechanism", roles: ["INTERNAL"] })).toBe("oval");
    expect(nodeShapeFor({ type: "ProcessingMechanism", roles: ["FEEDBACK_SENDER", "TERMINAL"] })).toBe("octagon");
    expect(nodeShapeFor({ type: "TransferMechanism", roles: ["CYCLE"] })).toBe("doublecircle");
    expect(nodeShapeFor({ type: "ControlMechanism", roles: ["CONTROLLER"], isController: true })).toBe("doubleoctagon");
    expect(nodeShapeFor({ type: "Composition", roles: ["OUTPUT"] })).toBe("rectangle");
  });

  it("keeps show_graph's precedence and survives missing data", () => {
    // A collapsed composition that is also a feedback sender is a rectangle;
    // a controller on a cycle is a double octagon; feedback beats cycle.
    expect(nodeShapeFor({ type: "Composition", roles: ["FEEDBACK_SENDER"] })).toBe("rectangle");
    expect(nodeShapeFor({ isController: true, roles: ["CYCLE"] })).toBe("doubleoctagon");
    expect(nodeShapeFor({ roles: ["CYCLE", "FEEDBACK_SENDER"] })).toBe("octagon");
    expect(nodeShapeFor(undefined)).toBe("oval");
    expect(nodeShapeFor({})).toBe("oval");
  });
});

describe("shapeTooltip", () => {
  it("says what each special shape means and that show_graph draws it so", () => {
    expect(shapeTooltip("oval")).toBeUndefined();
    expect(shapeTooltip("octagon")).toMatch(/^Feedback sender: .*feedback connection.*octagon/);
    expect(shapeTooltip("rectangle")).toMatch(/^Collapsed composition: .*rectangle/);
    expect(shapeTooltip("doubleoctagon")).toMatch(/^Controller: .*double octagon/);
    expect(shapeTooltip("doublecircle")).toMatch(/cycle.*double/);
  });
});

describe("outline geometry", () => {
  it("a rectangle's outline is the box itself", () => {
    expect(boundaryInward("rectangle", 0)).toBe(0);
    expect(boundaryInward("rectangle", 0.8)).toBe(0);
    const [x, y] = boundaryDir("rectangle", 1, 1);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
    const [rx, ry] = boundaryDir("rectangle", 1, 0);
    expect(rx).toBeCloseTo(1);
    expect(ry).toBeCloseTo(0);
  });

  it("an octagon is flat across the middle of each side and cut at the corners", () => {
    expect(boundaryInward("octagon", 0)).toBe(0);
    expect(boundaryInward("octagon", 0.3)).toBe(0);
    // Down the 45° diagonal: halfway between the top corner (0.414) and the
    // side the outline is halfway to the side's own corner cut.
    const K = Math.tan(Math.PI / 8);
    expect(boundaryInward("octagon", (K + 1) / 2)).toBeCloseTo((1 - K) / 2, 5);
    expect(boundaryInward("octagon", 1)).toBeCloseTo(1 - K, 5);
    // Straight up hits the top side; towards the corner hits the diagonal, inside the box.
    const [, top] = boundaryDir("octagon", 0, -1);
    expect(top).toBeCloseTo(-1);
    const [cx, cy] = boundaryDir("octagon", 1, 1);
    expect(cx).toBeCloseTo(cy);
    expect(cx).toBeLessThan(1);
    expect(cx).toBeGreaterThan(0.5);
  });

  it("an oval keeps the ellipse the edge maths already uses", () => {
    expect(boundaryInward("oval", 0)).toBe(0);
    expect(boundaryInward("oval", 1)).toBe(1);
    expect(boundaryDir("oval", 0, -2)).toEqual([0, -1]);
    const box = { cx: 100, cy: 50, a: 80, b: 40 };
    expect(onShapeBoundary(box, "oval", { x: 180, y: 50 })).toEqual({ x: 180, y: 50 });
  });

  it("moves an oval's attachment point out to a rectangle's or octagon's outline", () => {
    const box = { cx: 100, cy: 50, a: 80, b: 40 };
    // Towards the top-right corner the oval point is at 45° on the ellipse;
    // the rectangle's is its corner.
    const corner = onShapeBoundary(box, "rectangle", { x: 100 + 80 * Math.SQRT1_2, y: 50 - 40 * Math.SQRT1_2 });
    expect(corner.x).toBeCloseTo(180);
    expect(corner.y).toBeCloseTo(10);
    // Straight right, every shape meets the box's side.
    const side = onShapeBoundary(box, "octagon", { x: 180, y: 50 });
    expect(side.x).toBeCloseTo(180);
    expect(side.y).toBeCloseTo(50);
  });

  it("writes SVG points inside the box by the inset", () => {
    const pts = polygonPoints("rectangle", 100, 60, 2).split(" ").map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(4);
    for (const [x, y] of pts) {
      expect([2, 98]).toContain(x);
      expect([2, 58]).toContain(y);
    }
    expect(polygonPoints("octagon", 100, 60, 0).split(" ")).toHaveLength(8);
    expect(polygonPoints("oval", 100, 60, 0)).toBe("");
  });
});
