import { describe, expect, it } from "vitest";

import { rewriteUnder } from "./recentPaths";

describe("recent paths follow a moved project folder (#1295)", () => {
  const from = "/Users/me/.psyneuview/models";
  const to = "/Users/me/Documents/PsyNeuView-My-Models";

  it("rewrites a path inside the old folder, and the folder itself", () => {
    expect(rewriteUnder(`${from}/stroop.py`, from, to)).toBe(`${to}/stroop.py`);
    expect(rewriteUnder(`${from}/sub/nested.py`, from + "/", to + "/")).toBe(`${to}/sub/nested.py`);
    expect(rewriteUnder(from, from, to)).toBe(to);
  });

  it("leaves other paths alone, including a sibling that shares the prefix", () => {
    expect(rewriteUnder("/Users/me/.psyneuview/models-old/a.py", from, to)).toBe("/Users/me/.psyneuview/models-old/a.py");
    expect(rewriteUnder("/elsewhere/a.py", from, to)).toBe("/elsewhere/a.py");
  });
});
