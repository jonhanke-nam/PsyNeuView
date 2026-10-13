import { describe, expect, it } from "vitest";
import { stripProtectionLine } from "./protectionLine";

const HEADER = "# PsyNeuLink Model File\n# Format Version: 1.0\n";
const BODY = "import psyneulink as pnl\nA = pnl.TransferMechanism(name='A')\n";

describe("stripProtectionLine (#1346)", () => {
  it("drops either level from the header and keeps the rest", () => {
    expect(stripProtectionLine(HEADER + "# PsyNeuView: protected\n" + BODY)).toBe(HEADER + BODY);
    expect(stripProtectionLine(HEADER + "#psyneuview:PROTECTED  permanently \n" + BODY)).toBe(HEADER + BODY);
  });

  it("leaves a line below the first code alone", () => {
    const src = HEADER + BODY + "# PsyNeuView: protected\n";
    expect(stripProtectionLine(src)).toBe(src);
  });

  it("leaves near misses and unprotected files alone", () => {
    const near = HEADER + "# PsyNeuView: protected, please\n" + BODY;
    expect(stripProtectionLine(near)).toBe(near);
    expect(stripProtectionLine(HEADER + BODY)).toBe(HEADER + BODY);
  });

  it("keeps CRLF line endings", () => {
    expect(stripProtectionLine("# a\r\n# PsyNeuView: protected\r\nx = 1\r\n")).toBe("# a\r\nx = 1\r\n");
  });
});
