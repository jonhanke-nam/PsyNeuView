import { describe, expect, it } from "vitest";
import { blankScreenHint } from "./BlankScreen";

describe("the blank-screen hint (#215)", () => {
  it("names the Layout menu and each panel's key", () => {
    expect(blankScreenHint({ graph: "⌘1", code: "⌘2", bottom: "⌘3" })).toBe(
      "Every panel is hidden. Bring one back from the Layout menu, or press " +
        "⌘1 for the graph, ⌘2 for the code editor or ⌘3 for the Inspector panel.",
    );
  });

  it("leaves out a key that was unbound, and still reads as a sentence", () => {
    expect(blankScreenHint({ graph: "", code: "⌘2", bottom: "⌘3" })).toBe(
      "Every panel is hidden. Bring one back from the Layout menu, or press " +
        "⌘2 for the code editor or ⌘3 for the Inspector panel.",
    );
    expect(blankScreenHint({ graph: "⌘1", code: "", bottom: "" })).toBe(
      "Every panel is hidden. Bring one back from the Layout menu, or press ⌘1 for the graph.",
    );
    expect(blankScreenHint({ graph: "", code: "", bottom: "" })).toBe(
      "Every panel is hidden. Bring one back from the Layout menu.",
    );
  });
});
