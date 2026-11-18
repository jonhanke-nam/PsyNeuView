/** Spacing between nodes (#278). */
import { beforeEach, describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { applyLayout } from "@/utils/layout";
import { DEFAULT_LAYOUT_SPACING, spacingFactor, useLayoutSpacingStore } from "./layoutSpacingStore";
import { RENDERING_DEFAULTS } from "@/config/renderingDefaults";

const mech = (id: string): Node => ({ id, type: "mechanismNode", position: { x: 0, y: 0 }, data: { label: id } });
const edge = (s: string, t: string): Edge => ({ id: `${s}-${t}`, source: s, target: t });
const nodes = ["a", "b", "c", "d"].map(mech);
const edges = [edge("a", "b"), edge("b", "c"), edge("a", "d"), edge("d", "c")];

/** Height and width of the laid-out graph's node positions. */
function extent(laid: Node[]) {
  const xs = laid.map((n) => n.position.x);
  const ys = laid.map((n) => n.position.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe("Spacing between nodes (#278)", () => {
  beforeEach(() => useLayoutSpacingStore.setState({ spacing: DEFAULT_LAYOUT_SPACING }));

  it("defaults to Compact for Layered and show_graph's own for Like show_graph", () => {
    expect(DEFAULT_LAYOUT_SPACING).toBe("default");
    expect(spacingFactor("layered", "default")).toBeLessThan(1);
    expect(spacingFactor("showgraph", "default")).toBe(1);
    expect(spacingFactor("layered", "compact")).toBe(spacingFactor("showgraph", "compact"));
    expect(spacingFactor("layered", "standard")).toBe(1);
    expect(spacingFactor("layered", "roomy")).toBeGreaterThan(1);
  });

  it("draws a Layered layout's rows and neighbours closer, the more compact it is", () => {
    const at = (spacing: "compact" | "standard" | "roomy") => {
      useLayoutSpacingStore.setState({ spacing });
      return extent(applyLayout("layered", nodes, edges, { direction: "TB", ioRows: "off" }));
    };
    const [compact, standard, roomy] = [at("compact"), at("standard"), at("roomy")];
    expect(compact.h).toBeLessThan(standard.h);
    expect(standard.h).toBeLessThan(roomy.h);
    expect(compact.w).toBeLessThan(roomy.w);
  });

  it("makes Layered compact by default", () => {
    const laid = (spacing: "default" | "compact") => {
      useLayoutSpacingStore.setState({ spacing });
      return extent(applyLayout("layered", nodes, edges, { direction: "TB", ioRows: "off" }));
    };
    expect(laid("default")).toEqual(laid("compact"));
  });

  it("keeps nodes apart even when compact", () => {
    useLayoutSpacingStore.setState({ spacing: "compact" });
    const laid = applyLayout("layered", nodes, edges, { direction: "TB", ioRows: "off" });
    for (const p of laid) {
      for (const q of laid) {
        if (p.id >= q.id) continue;
        const dx = Math.abs(p.position.x - q.position.x);
        const dy = Math.abs(p.position.y - q.position.y);
        // Same row: at least a box apart; different rows: at least a box high.
        expect(dx >= 180 || dy >= 60, `${p.id} and ${q.id} overlap`).toBe(true);
      }
    }
  });

  it("draws arrowheads larger by default", () => {
    expect(RENDERING_DEFAULTS.arrowheadSize).toBe(10);
  });
});
