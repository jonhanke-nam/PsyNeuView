import { describe, it, expect } from "vitest";
import {
  EXPANDED_CLEARANCE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  expandedBoxFor,
  nameLineWidth,
  outlineThickness,
  ovalBoxFor,
  shapedBoxFor,
  showGraphAspect,
} from "./nodeBox";

/** Whether the corners of a name's box lie inside an oval this size, inset by the outline. */
const fits = (name: string, outline: number) => {
  const box = ovalBoxFor(name, outline);
  const rx = box.width / 2 - outline, ry = box.height / 2 - outline;
  return (nameLineWidth(name) / 2 / rx) ** 2 + (17 / 2 / ry) ** 2 <= 1;
};

describe("a node's oval (#210)", () => {
  it("is never smaller than Graphviz's least oval", () => {
    expect(ovalBoxFor("")).toEqual({ width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT });
    expect(ovalBoxFor("A")).toEqual({ width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT });
  });

  it("grows with the name", () => {
    expect(ovalBoxFor("PREVIOUS STATE [WEIGHTED SCORES]").width).toBeGreaterThan(ovalBoxFor("STATE").width);
    expect(ovalBoxFor("two\nlines").height).toBeGreaterThan(ovalBoxFor("one line").height);
  });

  it("holds the name inside the outline at every width, single or double", () => {
    for (const name of ["A", "STATE", "RESPONSE_LAYER", "PREVIOUS STATE [WEIGHTED SCORES]"]) {
      for (let width = 1; width <= 10; width++) {
        for (const double of [false, true]) {
          expect(fits(name, outlineThickness(double, width)), `${name}, ${width}px, double ${double}`).toBe(true);
        }
      }
    }
  });
});

describe("an expanded node's box (#333)", () => {
  const K = Math.tan(Math.PI / 8);
  // How far round the shape a point is: 1 on the outline's inside edge.
  const reach = (shape: string, x: number, y: number) =>
    shape === "rectangle" ? Math.max(x, y)
    : shape === "octagon" || shape === "doubleoctagon" ? Math.max(x, y, (x + y) / (1 + K))
    : Math.hypot(x, y);

  it("holds the text's corners inside the outline, clear of it, for every shape", () => {
    for (const shape of ["oval", "doublecircle", "octagon", "doubleoctagon", "rectangle"]) {
      for (const content of [{ width: 60, height: 120 }, { width: 240, height: 140 }, { width: 330, height: 260 }]) {
        for (const outline of [1, 4, outlineThickness(true, 4)]) {
          const box = expandedBoxFor(content, shape, outline);
          const a = box.width / 2 - outline, b = box.height / 2 - outline;
          const corner = reach(shape, content.width / 2 / a, content.height / 2 / b);
          expect(corner, `${shape} ${content.width}×${content.height}, outline ${outline}`).toBeLessThan(1);
          // ...and with the clear space to spare along each axis.
          expect(a - content.width / 2).toBeGreaterThanOrEqual(EXPANDED_CLEARANCE);
          expect(b - content.height / 2).toBeGreaterThanOrEqual(EXPANDED_CLEARANCE);
        }
      }
    }
  });

  it("is no bigger than the shape needs: √2 for a round or cut shape, nothing for a rectangle", () => {
    const content = { width: 200, height: 100 };
    expect(expandedBoxFor(content, "oval", 0).width).toBe(Math.ceil(208 * Math.SQRT2));
    expect(expandedBoxFor(content, "rectangle", 2)).toEqual({ width: 212, height: 112 });
  });
});

describe("a node in show_graph's shape and proportions (#385)", () => {
  const K = Math.tan(Math.PI / 8);
  const reach = (shape: string, x: number, y: number) =>
    shape === "rectangle" ? Math.max(x, y)
    : shape === "octagon" || shape === "doubleoctagon" ? Math.max(x, y, (x + y) / (1 + K))
    : Math.hypot(x, y);
  const NAMES = ["A", "LC", "RESPONSE", "COLOR HIDDEN", "PREVIOUS STATE [WEIGHTED SCORES]", "two\nlines"];

  it("draws a circle as wide as it is tall, its diameter covering the text's diagonal and the outline", () => {
    for (const shape of ["circle", "doublecircle"]) {
      for (const name of NAMES) {
        for (const outline of [0, 3, outlineThickness(true, 4)]) {
          const box = shapedBoxFor(name, shape, outline);
          expect(box.width, `${shape} ${name}`).toBe(box.height);
          const lines = name.split("\n");
          const w = Math.max(...lines.map(nameLineWidth)), h = lines.length * 17;
          // The name with Graphviz's margin inside the circle, and the name
          // itself inside the outline...
          const need = Math.max(Math.hypot(w + 16, h + 8), Math.hypot(w + 2, h + 2) + 2 * outline);
          expect(box.width).toBeGreaterThanOrEqual(need);
          // ...and no bigger than that needs, but for Graphviz's least circle.
          expect(box.width).toBeLessThanOrEqual(Math.max(NODE_MIN_HEIGHT, Math.ceil(need) + 1));
        }
      }
    }
  });

  it("keeps show_graph's width-to-height ratio for every shape", () => {
    for (const shape of ["oval", "octagon", "doubleoctagon", "rectangle", "circle", "doublecircle"]) {
      for (const name of NAMES) {
        const box = shapedBoxFor(name, shape, 4);
        const want = showGraphAspect(name, shape);
        expect(Math.abs(box.width / box.height / want - 1), `${shape} ${name}`).toBeLessThan(0.02);
      }
    }
  });

  it("holds the name inside the outline, for every shape", () => {
    for (const shape of ["oval", "octagon", "doubleoctagon", "rectangle", "circle", "doublecircle"]) {
      for (const name of NAMES) {
        for (const outline of [1, 4, outlineThickness(true, 4)]) {
          const box = shapedBoxFor(name, shape, outline);
          const lines = name.split("\n");
          const tx = Math.max(...lines.map(nameLineWidth)) / 2, ty = (lines.length * 17) / 2;
          const a = box.width / 2 - outline, b = box.height / 2 - outline;
          expect(reach(shape, tx / a, ty / b), `${shape} ${name}, outline ${outline}`).toBeLessThan(1);
        }
      }
    }
  });

  it("follows Graphviz's sizing: a circle is round, a short name gets the least node, a box isn't enlarged", () => {
    expect(showGraphAspect("RESPONSE", "doublecircle")).toBe(1);
    expect(showGraphAspect("LC", "octagon")).toBeCloseTo(NODE_MIN_WIDTH / NODE_MIN_HEIGHT);
    expect(showGraphAspect("EM", "rectangle")).toBeCloseTo(NODE_MIN_WIDTH / NODE_MIN_HEIGHT);
    // A long name: an octagon is wider than the oval round the same name.
    const name = "PREVIOUS STATE [WEIGHTED SCORES]";
    expect(showGraphAspect(name, "octagon")).toBeGreaterThan(showGraphAspect(name, "oval"));
    expect(showGraphAspect(name, "oval")).toBeGreaterThan(showGraphAspect(name, "rectangle"));
  });

  it("leaves room for a button beside the name", () => {
    expect(shapedBoxFor("EM", "rectangle", 2, 60).width).toBeGreaterThan(shapedBoxFor("EM", "rectangle", 2).width);
  });
});

describe("an expanded circle (#385)", () => {
  it("stays a circle round its text", () => {
    const box = expandedBoxFor({ width: 240, height: 140 }, "doublecircle", 5);
    expect(box.width).toBe(box.height);
    expect(box.width).toBeGreaterThanOrEqual(Math.hypot(240 + 2 * EXPANDED_CLEARANCE, 140 + 2 * EXPANDED_CLEARANCE) + 10);
  });
});
