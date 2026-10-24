import { describe, it, expect } from "vitest";
import { measureAgreement, share, type Box, type Center } from "./layoutAgreement";

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
