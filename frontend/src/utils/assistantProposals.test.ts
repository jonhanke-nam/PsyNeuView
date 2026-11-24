import { describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_SETTINGS, type Proposal } from "@/stores/assistantTypes";
import { contextFor, destinationHost, mcpConnectionWords, mcpToolCallWords, modelLabel, needsConsent, pendingProposals, setProposalState, sharedWords, whereDataGoes, withProposal } from "./assistantProposals";

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

describe("modelLabel (#370)", () => {
  const anthropic = { ...base, agent: { type: "anthropic" as const, model: "", base_url: "" } };
  const list = [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }, { id: "claude-haiku-5", display_name: "Claude Haiku 5" }];
  it("is the alias with the id, else the display name, else the id", () => {
    expect(modelLabel(anthropic, list, "claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelLabel({ ...anthropic, model_aliases: { "claude-opus-5-5": "big" } }, list)).toBe("big (claude-opus-5-5)");
    expect(modelLabel({ ...anthropic, agent: { ...anthropic.agent, model: "claude-x" } }, list)).toBe("claude-x");
    expect(modelLabel({ ...base, agent: { type: "openai_compatible", model: "", base_url: "http://localhost:1" } }, [])).toBe("the server's default model");
    expect(modelLabel(base, list)).toBe("");
  });
});

describe("Claude over MCP (#201)", () => {
  const mcp = { type: "claude_mcp" as const, model: "", base_url: "" };

  it("asks before switching to it while on, naming Claude Desktop or Claude Code", () => {
    const on = { ...base, enabled: true, agent: { type: "anthropic" as const, model: "", base_url: "" } };
    const raised = needsConsent(on, { ...on, agent: mcp });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toContain("Claude Desktop or Claude Code");
  });

  it("says where messages go and that no key is kept", () => {
    expect(destinationHost(mcp)).toBe("Claude Desktop or Claude Code on this machine");
    expect(whereDataGoes(mcp)).toContain("your own Claude subscription");
    expect(whereDataGoes(mcp)).toContain("No API key is kept in PsyNeuView");
    expect(modelLabel({ ...base, agent: mcp }, [])).toBe("Claude, via Claude Desktop or Claude Code");
  });

  it("words the connection status", () => {
    expect(mcpConnectionWords(null)).toContain("No Claude client has connected yet");
    expect(mcpConnectionWords({ connected: true, seconds_ago: 2, client: "claude-code 2.1" })).toBe("Claude is connected (claude-code 2.1), last heard from just now.");
    expect(mcpConnectionWords({ connected: false, seconds_ago: 600, client: "" })).toBe("Not connected. A Claude client was last heard from 10 minutes ago.");
  });

  it("words the tool calls in the current limit window", () => {
    expect(mcpToolCallWords(null)).toBeNull();
    expect(mcpToolCallWords({ seconds_ago: null, tool_calls: { used: 0, limit: 60, minutes: 10 } })).toBeNull();
    expect(mcpToolCallWords({ seconds_ago: 3, tool_calls: { used: 1, limit: 60, minutes: 10 } })).toBe("1 tool call in the last 10 minutes, of 60 allowed.");
    expect(mcpToolCallWords({ seconds_ago: 3, tool_calls: { used: 12, limit: 60, minutes: 1 } })).toBe("12 tool calls in the last minute, of 60 allowed.");
  });
});
