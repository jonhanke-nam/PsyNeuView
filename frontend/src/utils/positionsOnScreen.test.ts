import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { positionsOnScreen } from "./positionsOnScreen";

const at = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node =>
  ({ id, position: { x, y }, data: {}, ...extra }) as Node;

describe("positionsOnScreen (#164)", () => {
  it("keys a node by its variable name, else its id", () => {
    const out = positionsOnScreen([
      at("sender-3", 1, 2, { data: { varName: "sender" } }),
      at("loose", 5, 6),
    ]);
    expect(out).toEqual({ sender: { x: 1, y: 2 }, loose: { x: 5, y: 6 } });
  });

  it("keys a CIM without the number PsyNeuLink changes on each load", () => {
    const out = positionsOnScreen([at("comp-12 Input_CIM", 3, 4, { type: "cimNode" })]);
    expect(out).toEqual({ "comp Input_CIM": { x: 3, y: 4 } });
  });

  it("leaves out the flat view's composition frames, rebuilt on every load", () => {
    expect(positionsOnScreen([at("cluster::outer", 0, 0)])).toEqual({});
  });
});
