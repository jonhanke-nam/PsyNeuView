import { beforeEach, describe, expect, it } from "vitest";
import { useGraphSettings } from "./graphSettingsStore";

// #41: Like show_graph draws curves, so it brings Smooth edges with it, and
// Smooth is the default alongside the Like show_graph default layout (#31).
describe("edge style follows Like show_graph", () => {
  const initial = useGraphSettings.getState();
  beforeEach(() => useGraphSettings.setState(initial, true));

  it("starts with Smooth edges, still routed around nodes", () => {
    expect(initial.edgeRouting).toBe("spline");
    expect(initial.avoidNodes).toBe(true);
  });

  it("choosing Like show_graph switches edges to Smooth", () => {
    useGraphSettings.getState().setEdgeRouting("straight");
    useGraphSettings.getState().setLayoutStyle("showgraph");
    expect(useGraphSettings.getState().layoutStyle).toBe("showgraph");
    expect(useGraphSettings.getState().edgeRouting).toBe("spline");
  });

  it("other layouts keep the edge style chosen", () => {
    useGraphSettings.getState().setEdgeRouting("smoothstep");
    for (const style of ["layered", "radial", "force"] as const) {
      useGraphSettings.getState().setLayoutStyle(style);
      expect(useGraphSettings.getState().edgeRouting).toBe("smoothstep");
    }
  });
});
