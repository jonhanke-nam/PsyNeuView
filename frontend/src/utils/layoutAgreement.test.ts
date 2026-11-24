import { describe, it, expect } from "vitest";
import { measureAgreement, measureShapes, share, type Box, type Center } from "./layoutAgreement";
import { shapeFromShowGraph } from "./nodeShape";

const box = (cx: number, cy: number, w = 100, h = 40): Box => ({ x: cx - w / 2, y: cy - h / 2, w, h });

// show_graph: `a` and `b` on the top row (a left of b), `c` below them.
const reference = new Map<string, Center>([
  ["a", { x: 50, y: 20 }],
  ["b", { x: 150, y: 20 }],
  ["c", { x: 100, y: 100 }],
]);

describe("measureAgreement", () => {
  it("scores the same picture, scaled, as full agreement", () => {
    const drawn = new Map([
      ["a", box(150, 60)],
      ["b", box(450, 60)],
      ["c", box(300, 300)],
    ]);
    const r = measureAgreement(drawn, reference);
    expect(r.matched).toBe(3);
    expect(r.rows).toEqual({ agree: 3, pairs: 3 });
    expect(r.order).toEqual({ agree: 1, pairs: 1 });
    expect(r.overlaps).toEqual([]);
  });

  it("counts a row out of order, and a node off its row", () => {
    const drawn = new Map([
      ["a", box(450, 60)], // swapped with b
      ["b", box(150, 60)],
      ["c", box(300, 30)], // now above the others
    ]);
    const r = measureAgreement(drawn, reference);
    expect(r.order).toEqual({ agree: 0, pairs: 1 });
    expect(r.rows).toEqual({ agree: 1, pairs: 3 });
  });

  it("allows a couple of pixels of rounding within a row", () => {
    const drawn = new Map([
      ["a", box(150, 60)],
      ["b", box(450, 61.5)],
      ["c", box(300, 300)],
    ]);
    expect(share(measureAgreement(drawn, reference).rows)).toBe(1);
  });

  it("lists nodes show_graph doesn't draw, and overlapping boxes", () => {
    const drawn = new Map([
      ["a", box(150, 60)],
      ["b", box(200, 60)], // overlaps a
      ["x", box(800, 60)],
    ]);
    const r = measureAgreement(drawn, reference);
    expect(r.unmatched).toEqual(["x"]);
    expect(r.matched).toBe(2);
    expect(r.overlaps).toEqual([["a", "b"]]);
  });

  it("doesn't count boxes that only touch", () => {
    const drawn = new Map([
      ["a", box(150, 60)],
      ["b", box(250, 60)],
    ]);
    expect(measureAgreement(drawn, reference).overlaps).toEqual([]);
  });
});

describe("measureShapes (#385)", () => {
  const reference = new Map([
    ["RESPONSE", { shape: "doublecircle", w: 115, h: 115 }],
    ["COLOR INPUT", { shape: "oval", w: 150, h: 36 }],
    ["LC", { shape: "octagon", w: 54, h: 36 }],
  ]);

  it("agrees where the kind is show_graph's and the proportions are within 5%", () => {
    const drawn = new Map([
      ["RESPONSE", { shape: "doublecircle", w: 130, h: 130 }],
      ["COLOR INPUT", { shape: "oval", w: 175, h: 43 }],
      ["LC", { shape: "octagon", w: 63, h: 42 }],
      ["not in show_graph", { shape: "oval", w: 10, h: 10 }],
    ]);
    expect(measureShapes(drawn, reference, shapeFromShowGraph)).toMatchObject({ agree: 3, nodes: 3, off: [], mismatches: [] });
  });

  it("names a circle drawn as an oval, and a wrong kind", () => {
    const drawn = new Map([
      ["RESPONSE", { shape: "doublecircle", w: 160, h: 60 }],
      ["COLOR INPUT", { shape: "oval", w: 150, h: 36 }],
      ["LC", { shape: "oval", w: 54, h: 36 }],
    ]);
    const { agree, nodes, off, mismatches } = measureShapes(drawn, reference, shapeFromShowGraph);
    expect([agree, nodes]).toEqual([1, 3]);
    expect(off).toEqual(["RESPONSE: aspect 2.67, show_graph 1.00", "LC: oval, show_graph octagon"]);
    expect(mismatches.map((m) => [m.node, m.expected.kind, m.actual.shape])).toEqual([
      ["RESPONSE", "doublecircle", "doublecircle"],
      ["LC", "octagon", "oval"],
    ]);
  });
});
