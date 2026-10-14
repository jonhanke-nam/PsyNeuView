import { describe, expect, it } from "vitest";
import { showGraphLoadRequestFor } from "./showGraphLoadRequest";

describe("showGraphLoadRequestFor (#27)", () => {
  it("asks nothing extra unless the layout is Like show_graph", () => {
    expect(showGraphLoadRequestFor("layered", true, false, "comp")).toEqual({});
    expect(showGraphLoadRequestFor("force", true, false, null)).toEqual({});
  });

  it("carries the options the layout will ask with, and the open composition", () => {
    expect(showGraphLoadRequestFor("showgraph", true, false, "EGO_comp")).toEqual({
      show_graph: { show_controller: true, show_learning: false, composition: "EGO_comp" },
    });
  });

  it("leaves the composition out before one is open", () => {
    expect(showGraphLoadRequestFor("showgraph", false, true, null)).toEqual({
      show_graph: { show_controller: false, show_learning: true },
    });
  });
});
