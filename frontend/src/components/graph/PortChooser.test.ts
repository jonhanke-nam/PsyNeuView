import { describe, expect, it } from "vitest";
import { chooserQuestion } from "./PortChooser";

// #253: what the chooser asks follows the sender's kind.
describe("chooserQuestion", () => {
  it("asks which parameter for a control mechanism", () => {
    expect(chooserQuestion("parameter")[0]).toBe("Control which parameter of");
  });
  it("asks which port for a gating mechanism", () => {
    expect(chooserQuestion("port")[0]).toBe("Gate which port of");
  });
  it("asks which input otherwise", () => {
    expect(chooserQuestion(undefined)[0]).toBe("Connect into which input of");
  });
});
