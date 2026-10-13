import { describe, expect, it } from "vitest";

import { cssEscape, nodeSelector } from "./nodeSelector";

// #1236: a node name is any Python string, and must never make an invalid
// selector. No DOM here (this suite stubs rather than loads one), so this checks
// the escaping itself; e2e/node-name-special-characters.spec.ts checks a browser.
describe("nodeSelector", () => {
  const names = ['odd\n"name', "back\\slash", "=@~~!1241”\n", 'a"b'];

  it.each(names)("leaves no raw newline, quote or backslash in the value for %j", (name) => {
    const sel = nodeSelector(name);
    const value = sel.slice('.react-flow__node[data-id="'.length, -'"]'.length);
    expect(value).not.toMatch(/[\n\r]/);
    // Every quote and backslash is itself escaped.
    expect(value.replace(/\\[0-9a-f]+ /gi, "").replace(/\\./g, "")).not.toMatch(/["\\]/);
  });

  it("leaves an ordinary name alone", () => {
    expect(cssEscape("color_hidden")).toBe("color_hidden");
    expect(nodeSelector("color_hidden")).toBe('.react-flow__node[data-id="color_hidden"]');
  });
});
