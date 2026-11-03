import { describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_SETTINGS, type Proposal } from "@/stores/assistantTypes";
import { contextFor, pendingProposals, raisedPermissions, setProposalState, whereDataGoes, withProposal } from "./assistantProposals";

const base = DEFAULT_ASSISTANT_SETTINGS;

describe("raisedPermissions (#179)", () => {
  it("names turning on, more autonomy, more visibility and writable folders", () => {
    const next = {
      ...base,
      enabled: true,
      autonomy: "app_edits" as const,
      visibility: { ...base.visibility, files: true },
      folders: [{ path: "~/Models", access: "read_write" as const }],
    };
    expect(raisedPermissions(base, next)).toEqual([
      "turn the assistant on",
      "let it propose edits to the open model",
      "show it your model files in the allowed folders",
      "give it read and write access to ~/Models",
    ]);
  });

  it("is empty for a lowering", () => {
    const on = { ...base, enabled: true, autonomy: "app_edits" as const };
    expect(raisedPermissions(on, { ...on, autonomy: "answer" })).toEqual([]);
    expect(raisedPermissions(on, { ...on, enabled: false })).toEqual([]);
  });
});

describe("contextFor (#179)", () => {
  const page = { filePath: "/m.py", source: "x = 1", selection: "a", errors: ["e"] };
  it("sends only what visibility allows", () => {
    expect(contextFor(base, page)).toEqual({ file_path: "/m.py", source: "x = 1", selection: "a", errors: ["e"] });
    const none = { ...base, visibility: { model: false, selection: false, errors: false, results: false, files: false } };
    expect(contextFor(none, page)).toEqual({});
  });
});

describe("proposal state (#179)", () => {
  const p: Proposal = {
    id: "p1", kind: "app_edit", summary: "s", state: "pending", base_hash: "h", ops: [], path: null,
    before: "", after: "", freeform_python: false, warnings: [],
  };
  it("adds, updates, and lists pending", () => {
    let ps = withProposal({}, p);
    ps = withProposal(ps, { ...p, id: "p2" });
    expect(pendingProposals(ps).map((x) => x.id)).toEqual(["p1", "p2"]);
    ps = setProposalState(ps, "p1", "stale");
    expect(ps.p1.state).toBe("stale");
    expect(pendingProposals(ps).map((x) => x.id)).toEqual(["p2"]);
    expect(setProposalState(ps, "nope", "accepted")).toBe(ps);
  });
});

describe("whereDataGoes (#179)", () => {
  it("says where, for each agent", () => {
    expect(whereDataGoes({ type: "none", model: "", base_url: "" })).toMatch(/nothing is sent/);
    expect(whereDataGoes({ type: "anthropic", model: "", base_url: "" })).toMatch(/Anthropic/);
    expect(whereDataGoes({ type: "openai_compatible", model: "", base_url: "http://localhost:1/v1" })).toContain("http://localhost:1/v1");
  });
});
