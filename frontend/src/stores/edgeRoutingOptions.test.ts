import { describe, expect, it } from "vitest";
import { EDGE_ROUTING_OPTIONS } from "./graphSettingsStore";

// #1299: plain names in the menu; the stored values keep their old names
// because layout files and settings already contain them.
describe("edge style names", () => {
  it("labels each stored value with its plain name", () => {
    expect(Object.fromEntries(EDGE_ROUTING_OPTIONS.map((o) => [o.value, o.label]))).toEqual({
      straight: "Angled",
      smoothstep: "Step",
      spline: "Smooth",
    });
  });

  it("explains every option", () => {
    for (const o of EDGE_ROUTING_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });
});
