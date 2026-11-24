import { describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_SETTINGS, type Proposal } from "@/stores/assistantTypes";
import { contextFor, destinationHost, needsConsent, pendingProposals, setProposalState, sharedWords, whereDataGoes, withProposal } from "./assistantProposals";

const base = DEFAULT_ASSISTANT_SETTINGS;

describe("needsConsent (#369)", () => {
  it("asks once, to turn on, naming where messages go", () => {
    const next = { ...base, enabled: true, agent: { type: "anthropic" as const, model: "", base_url: "" } };
    expect(needsConsent(base, next)).toEqual(["turning the assistant on", "sending messages to https://api.anthropic.com"]);
  });

  it("doesn't ask for widening anything else, on or off", () => {
    const wider = {
      autonomy: "app_edits" as const,
      visibility: { ...base.visibility, files: true },
      folders: [{ path: "~/Models", access: "read_write" as const }],
      agent: { type: "anthropic" as const, model: "", base_url: "" },
    };
    expect(needsConsent(base, { ...base, ...wider })).toEqual([]);
    const on = { ...base, enabled: true, agent: wider.agent };
    expect(needsConsent(on, { ...on, ...wider, limits: { ...on.limits, minutes: 60 } })).toEqual([]);
    expect(needsConsent(on, { ...on, enabled: false })).toEqual([]);
  });

  it("asks for a new destination while on, but not for one with no address yet", () => {
    const on = { ...base, enabled: true, agent: { type: "anthropic" as const, model: "", base_url: "" } };
    expect(needsConsent(on, { ...on, agent: { type: "openai_compatible", model: "", base_url: "" } })).toEqual([]);
    expect(needsConsent(on, { ...on, agent: { type: "openai_compatible", model: "", base_url: "http://localhost:11434" } })).toEqual([
      "sending messages to http://localhost:11434 instead of https://api.anthropic.com",
    ]);
  });
});

describe("destinationHost and sharedWords (#369)", () => {
  it("names the host and what is shared", () => {
    expect(destinationHost({ type: "anthropic", model: "", base_url: "" })).toBe("api.anthropic.com");
    expect(destinationHost({ type: "openai_compatible", model: "", base_url: "http://localhost:11434/v1" })).toBe("localhost:11434");
    expect(destinationHost({ type: "none", model: "", base_url: "" })).toBeNull();
    expect(sharedWords(base)).toBe("what you type, and your open model, selection, errors");
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
