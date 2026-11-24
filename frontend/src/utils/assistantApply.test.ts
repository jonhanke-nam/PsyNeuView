/**
 * Applying an app_edit (#179): only structured ops the page has a route for,
 * each through that route; the proposal's text is never applied as source,
 * whatever op it claims to be.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Proposal } from "@/stores/assistantTypes";
import { useModelStore } from "@/stores/modelStore";
import { APP_EDIT_APPLIERS, applyAppEdit, isKnownOp } from "./assistantApply";

const HOSTILE = "import os\nos.system('touch /tmp/owned')\n";

function proposal(ops: Proposal["ops"], extra: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1", kind: "app_edit", summary: "edit", state: "pending", base_hash: "h", ops, path: "/m.py",
    before: null, after: HOSTILE, freeform_python: false, warnings: [], ...extra,
  };
}

let calls: { url: string; body: Record<string, unknown> }[] = [];
let setSource: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  setSource = vi.fn();
  useModelStore.setState({
    filePath: "/m.py",
    source: "a = 1\n",
    nodes: [{ id: "a", type: "mechanismNode", position: { x: 0, y: 0 }, data: { label: "a", varName: "a", inputPorts: [{ name: "in" }], outputPorts: [{ name: "out" }] } }] as never,
    setSource,
    flushBuffer: vi.fn(async () => true),
    loadModelFromServer: vi.fn(),
  } as never);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ source: "a = 2\n", model: { nodes: [] } }), { status: 200 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("applyAppEdit (#179)", () => {
  it("refuses an op it has no route for, and never applies the text as source", async () => {
    for (const op of ["replace_source", "set_source", "append_comment", "write_file", ""]) {
      await expect(applyAppEdit(proposal([{ op, args: { after: HOSTILE, source: HOSTILE } }]))).rejects.toThrow(/refused/);
    }
    expect(calls).toEqual([]);
    expect(setSource).not.toHaveBeenCalled();
  });

  it("refuses the whole proposal when any op is unknown, applying none", async () => {
    await expect(
      applyAppEdit(proposal([
        { op: "update_param", args: { var_name: "a", param_name: "slope", new_value: "2" } },
        { op: "replace_source", args: { after: HOSTILE } },
      ])),
    ).rejects.toThrow(/refused/);
    expect(calls).toEqual([]);
  });

  it("refuses an empty proposal and one with no model open", async () => {
    await expect(applyAppEdit(proposal([]))).rejects.toThrow(/no ops/);
    useModelStore.setState({ filePath: null } as never);
    await expect(applyAppEdit(proposal([{ op: "update_param", args: { var_name: "a", param_name: "slope", new_value: "2" } }]))).rejects.toThrow(/no model/);
    expect(calls).toEqual([]);
  });

  it("applies each known op through the user's own route, with the value as given", async () => {
    await applyAppEdit(proposal([
      { op: "update_param", args: { var_name: "a", param_name: "slope", new_value: "2", context: "function" } },
      { op: "rename_node", args: { var_name: "a", new_name: "b" } },
      { op: "add_port", args: { var_name: "a", port_kind: "input", new_name: "in2" } },
      { op: "remove_port", args: { var_name: "a", port_kind: "output", port_name: "out" } },
      { op: "rename_port", args: { var_name: "a", port_kind: "input", old_name: "in", new_name: "in3" } },
    ]));
    expect(calls.map((c) => c.url)).toEqual([
      "/api/model/update-param", "/api/model/rename-node", "/api/model/add-port", "/api/model/remove-port", "/api/model/rename-port",
    ]);
    expect(calls[0].body).toMatchObject({ file_path: "/m.py", var_name: "a", param_name: "slope", new_value: "2", context: "function", is_default: false });
    expect(calls[1].body).toMatchObject({ var_name: "a", new_name: "b", existing_names: ["a"], current_name: "a" });
    expect(calls[2].body).toMatchObject({ port_kind: "input", current_names: ["in"], new_name: "in2" });
    expect(calls[3].body).toMatchObject({ port_kind: "output", current_names: ["out"], port_name: "out" });
    expect(calls[4].body).toMatchObject({ old_name: "in", new_name: "in3" });
    // The route's answer is what reaches the editor, never the proposal's text.
    expect(setSource).toHaveBeenCalledWith("a = 2\n");
    expect(setSource).not.toHaveBeenCalledWith(HOSTILE);
  });

  it("the list of ops is exactly the backend's", () => {
    expect(Object.keys(APP_EDIT_APPLIERS).sort()).toEqual(["add_port", "remove_port", "rename_node", "rename_port", "update_param"]);
    expect(isKnownOp({ op: "update_param", args: {} })).toBe(true);
    expect(isKnownOp({ op: "constructor", args: {} })).toBe(false);
    expect(isKnownOp({ op: "__proto__", args: {} })).toBe(false);
  });
});
