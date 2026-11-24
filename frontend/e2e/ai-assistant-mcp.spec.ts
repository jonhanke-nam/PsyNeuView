/**
 * Claude over MCP (#201), against a stubbed backend (page.route): choosing
 * it in Settings ▸ AI assistant shows the Claude Code line and the Claude
 * Desktop JSON with Copy buttons and the connection status, instead of the
 * model and the API key; the Assistant tab says to use Claude Desktop or
 * Claude Code and shows the proposals that arrive. Screenshots land in
 * `$SHOTS_DIR` when it is set.
 */
import { readOnlyTest as test, expect } from "./test-base";
import path from "path";

type Page = import("@playwright/test").Page;

const SETUP = {
  url: "http://127.0.0.1:8353",
  command: "/Users/me/PsyNeuView/backend/.venv/bin/python",
  args: ["-m", "app.mcp_server"],
  env_names: ["PSYNEUVIEW_URL", "PSYNEUVIEW_MCP_TOKEN", "PYTHONPATH"],
  token: "tok-123",
  claude_code:
    "claude mcp add --transport stdio --scope user --env PSYNEUVIEW_URL=http://127.0.0.1:8353 --env PSYNEUVIEW_MCP_TOKEN=tok-123 --env PYTHONPATH=/Users/me/PsyNeuView/backend psyneuview -- /Users/me/PsyNeuView/backend/.venv/bin/python -m app.mcp_server",
  claude_desktop: JSON.stringify(
    { mcpServers: { psyneuview: { command: "/Users/me/PsyNeuView/backend/.venv/bin/python", args: ["-m", "app.mcp_server"], env: { PSYNEUVIEW_URL: "http://127.0.0.1:8353", PSYNEUVIEW_MCP_TOKEN: "tok-123", PYTHONPATH: "/Users/me/PsyNeuView/backend" } } } },
    null,
    2,
  ),
};

const DEFAULTS = {
  enabled: false,
  agent: { type: "none", model: "", base_url: "" },
  folders: [],
  autonomy: "suggest",
  saving: "always_ask",
  visibility: { model: true, selection: true, errors: true, results: false, files: false },
  limits: { tool_calls: 25, minutes: 10, max_tokens: 100000 },
  keep_log: true,
  sandbox: { all_runs: true, require: true },
  model_aliases: {} as Record<string, string>,
};

async function stub(page: Page, initial: Partial<typeof DEFAULTS>, opts: { connected?: boolean; events?: unknown[] } = {}) {
  const state = { settings: { ...DEFAULTS, ...initial }, contexts: [] as unknown[] };
  await page.route("**/api/assistant/settings", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: state.settings });
    const { confirm_raise: _c, ...rest } = route.request().postDataJSON();
    state.settings = rest;
    return route.fulfill({ json: state.settings });
  });
  await page.route("**/api/assistant/key", (route) => route.fulfill({ json: { set: false } }));
  await page.route("**/api/assistant/sandbox", (route) => route.fulfill({ json: { state: "on", available: true, wanted: true, why: "", mechanism: "seatbelt", platform: "darwin", enforced: [], not_enforced: [], reason: null, forced: null } }));
  await page.route("**/api/assistant/mcp/setup", (route) => route.fulfill({ json: SETUP }));
  await page.route("**/api/assistant/mcp/status", (route) => {
    const active = state.settings.enabled && state.settings.agent.type === "claude_mcp";
    return route.fulfill({
      json: opts.connected
        ? { connected: true, last_seen: Date.now() / 1000, seconds_ago: 3, client: "claude-code 2.1", active, session_id: active ? "mcp1" : null }
        : { connected: false, last_seen: null, seconds_ago: null, client: "", active, session_id: active ? "mcp1" : null },
    });
  });
  await page.route("**/api/assistant/mcp/context", (route) => {
    state.contexts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/assistant/sessions/mcp1/events*", (route) => {
    const events = (opts.events ?? []) as { seq: number }[];
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? "0");
    const fresh = events.filter((e) => e.seq > after);
    return route.fulfill({ json: { events: fresh, next: events.length ? events[events.length - 1].seq : after, running: false, tokens_used: 0 } });
  });
  return state;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test.describe("AI assistant: Claude over MCP (#201)", { tag: "@ci" }, () => {
  test("choosing it shows the setup to copy and the connection status", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const state = await stub(page, {});
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-assistant").click();

    const agent = page.getByTestId("setting-assistant-agent-type");
    await expect(agent.locator("option", { hasText: "Claude (your subscription, via Claude Desktop or Claude Code)" })).toHaveCount(1);
    await agent.selectOption("claude_mcp");
    await expect.poll(() => state.settings.agent.type).toBe("claude_mcp");

    // The setup, instead of the model and the API key.
    await expect(page.getByTestId("assistant-mcp-setup")).toBeVisible();
    await expect(page.getByTestId("setting-assistant-agent-model")).toHaveCount(0);
    await expect(page.getByTestId("setting-assistant-api-key")).toHaveCount(0);
    await expect(page.getByText("under your own Claude subscription")).toBeVisible();
    await expect(page.getByTestId("assistant-mcp-claude-code")).toHaveText(SETUP.claude_code);
    await expect(page.getByTestId("assistant-mcp-claude-desktop")).toContainText('"psyneuview"');
    await expect(page.getByTestId("assistant-mcp-claude-desktop")).toContainText("PSYNEUVIEW_MCP_TOKEN");
    await expect(page.getByTestId("assistant-mcp-status")).toHaveAttribute("data-connected", "false");
    await expect(page.getByTestId("assistant-mcp-status")).toContainText("No Claude client has connected yet");
    await shot(page, "mcp-01-settings-setup");

    await page.getByTestId("assistant-mcp-copy-claude-code").click();
    await expect(page.getByTestId("assistant-mcp-copied-claude-code")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SETUP.claude_code);

    await page.getByTestId("assistant-mcp-copy-claude-desktop").click();
    await expect(page.getByTestId("assistant-mcp-copied-claude-desktop")).toBeVisible();
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(copied.mcpServers.psyneuview.args).toEqual(["-m", "app.mcp_server"]);
    expect(copied.mcpServers.psyneuview.env.PSYNEUVIEW_MCP_TOKEN).toBe("tok-123");
  });

  test("the status line says when Claude is connected", async ({ page }) => {
    await stub(page, { agent: { type: "claude_mcp", model: "", base_url: "" } }, { connected: true });
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-assistant").click();
    await expect(page.getByTestId("assistant-mcp-status")).toHaveAttribute("data-connected", "true");
    await expect(page.getByTestId("assistant-mcp-status")).toContainText("Claude is connected (claude-code 2.1)");
  });

  test("the Assistant tab points to Claude and shows incoming proposals", async ({ page }) => {
    const proposal = {
      id: "p1", kind: "app_edit", summary: "Rename A", state: "pending", base_hash: "x", path: "/m/model.py",
      ops: [{ op: "rename_node", args: { var_name: "A", new_name: "Input" } }], before: null, after: "rename A to 'Input'",
      freeform_python: false, warnings: [],
    };
    const events = [
      { seq: 1, t: 0, type: "tool_call", tool: "propose_app_edit", args: {}, via: "mcp" },
      { seq: 2, t: 0, type: "proposal", proposal },
    ];
    const state = await stub(page, { enabled: true, agent: { type: "claude_mcp", model: "", base_url: "" } }, { connected: true, events });
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-mcp-note")).toContainText(
      "Use Claude Desktop or Claude Code to talk to the assistant; proposals appear here for you to accept or reject.",
    );
    await expect(page.getByTestId("assistant-input")).toHaveCount(0);
    await expect(page.getByTestId("assistant-proposal")).toHaveAttribute("data-state", "pending");
    await expect(page.getByTestId("assistant-proposal-summary")).toHaveText("Rename A");
    await expect(page.getByTestId("assistant-proposal-accept")).toBeEnabled();
    // The page shares the open model's context for read_open_model.
    await expect.poll(() => state.contexts.length).toBeGreaterThan(0);
    await shot(page, "mcp-02-assistant-tab");
  });
});
