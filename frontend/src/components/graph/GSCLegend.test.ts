import { describe, expect, it } from "vitest";

import { pickLegendCorner } from "./GSCLegend";

describe("pickLegendCorner", () => {
  it("takes the corner with the most room outside the nodes", () => {
    expect(pickLegendCorner({ left: 10, right: 300, top: 10, bottom: 200 })).toBe("br");
    expect(pickLegendCorner({ left: 10, right: 300, top: 200, bottom: 10 })).toBe("tr");
    expect(pickLegendCorner({ left: 300, right: 10, top: 200, bottom: 10 })).toBe("tl");
  });

  it("never covers the zoom and fit controls in the bottom-left (#55)", () => {
    // Bottom-left roomiest: the better of its neighbours instead.
    expect(pickLegendCorner({ left: 300, right: 100, top: 20, bottom: 200 })).toBe("br");
    expect(pickLegendCorner({ left: 300, right: 20, top: 100, bottom: 200 })).toBe("tl");
  });
});
