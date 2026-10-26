import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { cimAnchor, cimPosition, placeCims } from "./cimPlacement";

const frame = (x: number, y: number, w: number, h: number): Node => ({
  id: "EM",
  type: "compositionNode",
  position: { x, y },
  style: { width: w, height: h },
  data: {},
});
const cim = (id: string, cimType: string, cimIndex?: number): Node => ({
  id,
  type: "cimNode",
  position: { x: -999, y: -999 },
  data: { cimType, ...(cimIndex !== undefined ? { cimIndex } : {}) },
});

describe("CIM placement (#72)", () => {
  it("puts Input CIMs above the frame, Output CIMs below and Parameter CIMs to its right", () => {
    const box = { x: 100, y: 200, w: 400, h: 300 };
    expect(cimPosition(box, "INPUT_CIM", 0)).toEqual({ x: 250, y: 140 });
    expect(cimPosition(box, "OUTPUT_CIM", 1)).toEqual({ x: 390, y: 520 });
    expect(cimPosition(box, "PARAMETER_CIM", 2)).toEqual({ x: 540, y: 320 });
  });

  it("anchors on the first frame, or a default box at the origin", () => {
    expect(cimAnchor([frame(10, 20, 30, 40)])).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
    expect(cimAnchor([])).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it("puts CIMs back against the frame after a layout moves it", () => {
    const placed = placeCims([
      frame(0, 500, 1000, 400),
      cim("in", "INPUT_CIM", 0),
      cim("out", "OUTPUT_CIM", 1),
    ]);
    expect(placed[1].position).toEqual({ x: 450, y: 440 });
    expect(placed[2].position).toEqual({ x: 590, y: 920 });
  });

  it("leaves a CIM placed from a saved layout where it is", () => {
    const placed = placeCims([
      frame(0, 0, 100, 100),
      cim("saved", "INPUT_CIM"),
    ]);
    expect(placed[1].position).toEqual({ x: -999, y: -999 });
  });
});
