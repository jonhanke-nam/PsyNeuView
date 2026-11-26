import { describe, expect, it } from "vitest";
import { GRAPHVIZ_COLOURS, asGraphvizDrawsIt } from "./graphvizColours";

// The same cases as backend/tests/test_show_graph_picture.py: both sides
// rewrite from one table, and must rewrite alike (#424).
describe("asGraphvizDrawsIt", () => {
  it.each([
    ["green", "#00ff00"],
    ["purple", "#a020f0"],
    ["gray", "#c0c0c0"],
    ["grey", "#c0c0c0"],
    ["maroon", "#b03060"],
    ["gray50", "#7f7f7f"],
    ["grey50", "#7f7f7f"],
    ["green4", "#008b00"],
    ["lightgrey", "#d3d3d3"],
    ["red", "#ff0000"],
    ["black", "#000000"],
  ])("%s takes Graphviz's X11 value %s", (name, x11) => {
    expect(GRAPHVIZ_COLOURS[name]).toBe(x11);
    expect(asGraphvizDrawsIt(`<ellipse stroke="${name}"/>`)).toBe(`<ellipse stroke="${x11}"/>`);
  });

  it("redraws every name in the table", () => {
    expect(Object.keys(GRAPHVIZ_COLOURS).length).toBeGreaterThan(600);
    for (const [name, hex] of Object.entries(GRAPHVIZ_COLOURS)) {
      expect(asGraphvizDrawsIt(`<path stroke="${name}"/>`)).toBe(`<path stroke="${hex}"/>`);
    }
  });

  it("matches names whatever their case", () => {
    expect(asGraphvizDrawsIt('<ellipse stroke="GREEN" fill="Gray50"/>')).toBe('<ellipse stroke="#00ff00" fill="#7f7f7f"/>');
  });

  it("rewrites fill, stroke, color and stop-color attributes", () => {
    expect(asGraphvizDrawsIt(`<ellipse fill="purple" stroke='green'/><g color="maroon"/><stop stop-color="grey"/>`)).toBe(
      `<ellipse fill="#a020f0" stroke='#00ff00'/><g color="#b03060"/><stop stop-color="#c0c0c0"/>`,
    );
  });

  it("rewrites inline style declarations", () => {
    expect(
      asGraphvizDrawsIt('<stop style="stop-color:green;stop-opacity:1.0;"/><path style="fill: purple; stroke:Gray50 !important"/>'),
    ).toBe('<stop style="stop-color:#00ff00;stop-opacity:1.0;"/><path style="fill: #a020f0; stroke:#7f7f7f !important"/>');
  });

  it("leaves hex, none, transparent, gradients and text alone", () => {
    const svg =
      '<ellipse fill="none" stroke="#00FF00"/><polygon fill="transparent" stroke="#a020f080"/>' +
      '<path fill="url(#l_1)" stroke="currentColor"/><path fill-opacity="0.5"/>' +
      '<stop style="stop-color:#123456;stop-opacity:0;"/><path fill="notacolour"/>' +
      "<title>purple</title><text>green</text>";
    expect(asGraphvizDrawsIt(svg)).toBe(svg);
  });
});
