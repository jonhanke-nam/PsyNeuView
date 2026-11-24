/**
 * The AI assistant's page (#179), against a stubbed backend (page.route), so
 * it runs whether or not the backend has the assistant yet.
 *
 * Hidden when the deployment has no assistant; turning it on is the one
 * consent, with what is shared and with whom, and later changes save
 * without asking (#369); a conversation; hostile text
 * stays inert; a proposal accepted is one History entry and one undo; a
 * stale proposal says so; Stop ends the turn. Screenshots land in
 * `$SHOTS_DIR` when it is set.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

const DEFAULTS = {
  enabled: false,
  agent: { type: "none", model: "", base_url: "" },
  folders: [],
  autonomy: "suggest",
  saving: "always_ask",
  visibility: { model: true, selection: true, errors: true, results: false, files: false },
  limits: { tool_calls: 25, minutes: 10, max_tokens: 100000 },
  keep_log: true,
  model_aliases: {} as Record<string, string>,
};

type Event = Record<string, unknown> & { seq: number; type: string };

/** The stubbed backend: settings with the one-consent flow (#369), one session, a queue of events. */
interface Stub {
  settings: typeof DEFAULTS;
  events: Event[];
  running: boolean;
  stopped: boolean;
  accepted: string[];
  acceptStatus: number;
  puts: Record<string, unknown>[];
}

async function stubAssistant(page: Page, initial: Partial<typeof DEFAULTS> = {}): Promise<Stub> {
  const stub: Stub = {
    settings: { ...DEFAULTS, ...initial },
    events: [],
    running: false,
    stopped: false,
    accepted: [],
    acceptStatus: 200,
    puts: [],
  };
  await page.route("**/api/assistant/settings", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: stub.settings });
    const body = req.postDataJSON() as typeof DEFAULTS & { confirm_raise?: boolean };
    stub.puts.push(body);
    // The backend's rule (#369): only turning on, or a new destination while on, asks.
    const raised: string[] = [];
    const moved = body.agent.type !== stub.settings.agent.type || body.agent.base_url !== stub.settings.agent.base_url;
    if (!stub.settings.enabled && body.enabled) raised.push("turning the assistant on");
    else if (stub.settings.enabled && body.enabled && moved && (body.agent.type === "anthropic" || body.agent.base_url)) raised.push(`sending messages to ${body.agent.base_url}`);
    if (raised.length && !body.confirm_raise) return route.fulfill({ status: 200, json: { needs_confirmation: true, reason: "confirm_raise", raised } });
    const { confirm_raise: _c, ...rest } = body;
    stub.settings = rest;
    return route.fulfill({ json: stub.settings });
  });
  await page.route("**/api/assistant/key", (route) => route.fulfill({ json: { set: false } }));
  await page.route("**/api/assistant/sessions", (route) => route.fulfill({ json: { id: "s1" } }));
  await page.route("**/api/assistant/sessions/s1/messages", (route) => {
    stub.running = true;
    return route.fulfill({ json: { turn_id: "t1" } });
  });
  await page.route("**/api/assistant/sessions/s1/events*", (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? "0");
    const events = stub.events.filter((e) => e.seq > after);
    const next = stub.events.length ? Math.max(after, ...stub.events.map((e) => e.seq)) : after;
    return route.fulfill({ json: { events, next, running: stub.running } });
  });
  await page.route("**/api/assistant/sessions/s1/stop", (route) => {
    stub.stopped = true;
    stub.running = false;
    stub.events.push({ seq: stub.events.length + 1, t: "", type: "done", reason: "stopped" });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/assistant/proposals/*/accept", (route) => {
    const id = route.request().url().split("/").slice(-2)[0];
    if (stub.acceptStatus !== 200) return route.fulfill({ status: stub.acceptStatus, json: { detail: "stale" } });
    stub.accepted.push(id);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/assistant/proposals/*/reject", (route) => route.fulfill({ json: { ok: true } }));
  return stub;
}

/** Answer the current turn with `events` and end it. */
function reply(stub: Stub, events: Omit<Event, "seq">[]) {
  let seq = stub.events.length;
  for (const e of events) stub.events.push({ ...e, seq: ++seq } as Event);
  stub.events.push({ seq: ++seq, t: "", type: "done", reason: "finished" });
  stub.running = false;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
}

async function openFromPath(page: Page, model: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "assistant179-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

/** Send, and wait until the turn is under way, so a test's `reply` lands after the stub saw the message. */
async function sendMessage(page: Page, text: string) {
  await page.getByTestId("assistant-input").fill(text);
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-turn-state")).toHaveText("Working…");
}

test.describe("AI assistant (#179)", { tag: "@ci" }, () => {
  test("is hidden entirely when the deployment has no assistant", async ({ page }) => {
    await page.route("**/api/assistant/settings", (route) => route.fulfill({ status: 403, json: { detail: "unavailable_in_deployment" } }));
    await page.goto("/");
    await expect(page.getByTestId("tab-inspector")).toBeVisible();
    await expect(page.getByTestId("tab-assistant")).toHaveCount(0);
    await openSettings(page);
    await expect(page.getByTestId("settings-section-folders")).toBeVisible();
    await expect(page.getByTestId("settings-section-assistant")).toHaveCount(0);
  });

  test("off by default; turning it on is the one consent, saying what is shared and with whom (#369)", async ({ page }) => {
    const stub = await stubAssistant(page, { agent: { type: "anthropic", model: "", base_url: "" } });
    await page.goto("/");
    await expect(page.getByTestId("tab-assistant")).toHaveCount(0);
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const on = page.getByTestId("setting-assistant-enabled");
    await expect(on).not.toBeChecked();
    await expect(page.getByTestId("assistant-summary")).toHaveText("Off: nothing is sent anywhere.");
    await expect(page.getByText("An external agent's own access can't be limited by PsyNeuView")).toBeVisible();
    await expect(page.getByTestId("assistant-api-key-state")).toHaveText("No key is set.");
    await shot(page, "01-settings-off");

    // Cancel saves nothing.
    await on.click();
    const consent = page.getByTestId("assistant-raise-confirm");
    await expect(consent).toHaveAttribute("data-kind", "turn-on");
    await page.getByTestId("assistant-raise-confirm-no").click();
    await expect(consent).toHaveCount(0);
    await expect(on).not.toBeChecked();
    expect(stub.settings.enabled).toBe(false);

    // The consent says what is shared, with whom, what it can do, and the folders.
    await on.click();
    await expect(consent).toContainText("What is shared:");
    await expect(consent).toContainText("With whom:");
    await expect(consent).toContainText("api.anthropic.com");
    await expect(consent).toContainText("PsyNeuView can't limit what that service does");
    await expect(consent).toContainText("What it can do:");
    await expect(consent).toContainText("Folders:");
    await shot(page, "02-consent");
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(consent).toHaveCount(0);
    await expect(on).toBeChecked();
    expect(stub.settings.enabled).toBe(true);
    expect(stub.puts[stub.puts.length - 1].confirm_raise).toBe(true);
    await expect(page.getByTestId("assistant-summary")).toContainText("Shares what you type, and your open model, selection, errors with api.anthropic.com");
    await shot(page, "03-settings-on");

    // The tab appears once it is on.
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("tab-assistant")).toBeVisible();
  });

  test("once on, widening a permission saves without asking, and the summary follows (#369)", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true, agent: { type: "anthropic", model: "", base_url: "" } });
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    await page.getByTestId("setting-assistant-autonomy").selectOption("app_edits");
    await expect.poll(() => stub.settings.autonomy).toBe("app_edits");
    await page.getByTestId("setting-assistant-visibility-results").click();
    await expect.poll(() => stub.settings.visibility.results).toBe(true);
    await expect(page.getByTestId("assistant-raise-confirm")).toHaveCount(0);
    expect(stub.puts.every((p) => !(p as { confirm_raise?: boolean }).confirm_raise)).toBe(true);
    await expect(page.getByTestId("assistant-summary")).toContainText("run results");
    await expect(page.getByTestId("assistant-summary")).toContainText("Propose edits to the open model");
    // Lowering never asks either.
    await page.getByTestId("setting-assistant-autonomy").selectOption("answer");
    await expect.poll(() => stub.settings.autonomy).toBe("answer");
    await expect(page.getByTestId("assistant-raise-confirm")).toHaveCount(0);
  });

  test("Test connection says whether the key, model and network work (#368)", async ({ page }) => {
    await stubAssistant(page, { enabled: true, agent: { type: "anthropic", model: "claude-test", base_url: "" } });
    const answers = [
      { ok: true, agent: "anthropic", model: "claude-test", ms: 412, message: "Connected to Anthropic, model claude-test, in 412 ms" },
      { ok: false, agent: "anthropic", model: "claude-test", ms: 120, message: "The key was refused (HTTP 401)" },
    ];
    let release: () => void = () => {};
    let calls = 0;
    await page.route("**/api/assistant/test-connection", async (route) => {
      const answer = answers[calls++];
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      return route.fulfill({ json: answer });
    });
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const button = page.getByTestId("assistant-test-connection");
    const result = page.getByTestId("assistant-test-connection-result");
    await expect(button).toBeEnabled();

    await button.click();
    await expect(result).toHaveText("Testing…");
    release();
    await expect(result).toHaveText("✓ Connected to Anthropic, model claude-test, in 412 ms");
    await expect(result).toHaveAttribute("data-ok", "true");
    await shot(page, "test-connection-ok");

    await button.click();
    await expect(result).toHaveText("⚠ The key was refused (HTTP 401)");
    await expect(result).toHaveAttribute("data-ok", "false");
    await shot(page, "test-connection-401");
  });

  test("the model is chosen from the service's list, with a short name of your own (#370)", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true, agent: { type: "anthropic", model: "", base_url: "" } });
    let fail = false;
    await page.route("**/api/assistant/models", (route) =>
      route.fulfill({
        json: fail
          ? { ok: false, agent: "anthropic", models: [], default: "claude-opus-5-5", message: "Couldn't reach api.anthropic.com." }
          : {
              ok: true, agent: "anthropic", default: "claude-opus-5-5", message: "2 models offered.",
              models: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }, { id: "claude-haiku-5", display_name: "Claude Haiku 5" }],
            },
      }),
    );
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const model = page.getByTestId("setting-assistant-agent-model");
    // The default is preselected.
    await expect(model).toHaveValue("claude-opus-5-5");
    await expect(model.locator("option")).toHaveText(["Claude Opus 5.5 (claude-opus-5-5)", "Claude Haiku 5 (claude-haiku-5)"]);

    await model.selectOption("claude-haiku-5");
    await expect.poll(() => stub.settings.agent.model).toBe("claude-haiku-5");
    const alias = page.getByTestId("setting-assistant-model-alias");
    await alias.fill("fast");
    await alias.blur();
    await expect.poll(() => stub.settings.model_aliases).toEqual({ "claude-haiku-5": "fast" });
    expect(stub.settings.agent.model).toBe("claude-haiku-5");
    await expect(model.locator("option:checked")).toHaveText("fast — Claude Haiku 5 (claude-haiku-5)");
    await shot(page, "model-list-alias");

    // A failed refresh says so and keeps the choice and the last list.
    fail = true;
    await page.getByTestId("assistant-models-refresh").click();
    await expect(page.getByTestId("assistant-models-message")).toHaveText("Couldn't reach api.anthropic.com. The saved choice is kept.");
    await expect(model).toHaveValue("claude-haiku-5");

    // The alias is shown in the Assistant tab; the id is what's stored.
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-model-name")).toHaveText("fast (claude-haiku-5)");
  });

  test("a saved model the service no longer offers is flagged, not changed (#370)", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true, agent: { type: "anthropic", model: "claude-old-1", base_url: "" } });
    await page.route("**/api/assistant/models", (route) =>
      route.fulfill({ json: { ok: true, agent: "anthropic", default: "claude-opus-5-5", message: "1 model offered.", models: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] } }),
    );
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const model = page.getByTestId("setting-assistant-agent-model");
    await expect(model).toHaveValue("claude-old-1");
    await expect(model.locator("option:checked")).toHaveText("claude-old-1 — no longer offered by the service");
    await expect(page.getByTestId("assistant-models-message")).toContainText("claude-old-1 is no longer offered by the service");
    expect(stub.puts).toEqual([]);
  });

  test("while off, Test connection and the model list send nothing and say why (#369)", async ({ page }) => {
    await stubAssistant(page, { agent: { type: "anthropic", model: "claude-test", base_url: "" } });
    const sent: string[] = [];
    await page.route("**/api/assistant/test-connection", (route) => {
      sent.push("test-connection");
      return route.fulfill({ json: { ok: true, agent: "anthropic", model: "claude-test", ms: 1, message: "sent" } });
    });
    await page.route("**/api/assistant/models", (route) => {
      sent.push("models");
      return route.fulfill({ json: { ok: true, agent: "anthropic", default: "", message: "", models: [] } });
    });
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const off = "Turn the assistant on first; nothing is sent until you do.";
    await expect(page.getByTestId("assistant-test-connection")).toBeDisabled();
    await expect(page.getByTestId("assistant-test-connection")).toHaveAttribute("title", off);
    await expect(page.getByTestId("assistant-test-connection-off")).toContainText(off);
    await expect(page.getByTestId("assistant-models-refresh")).toBeDisabled();
    await expect(page.getByTestId("assistant-models-off")).toContainText(off);
    await shot(page, "off-nothing-sent");
    expect(sent).toEqual([]);
  });

  test("Test connection is disabled until an agent is chosen (#368)", async ({ page }) => {
    await stubAssistant(page);
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    await expect(page.getByTestId("assistant-test-connection")).toBeDisabled();
  });

  test("a conversation, with the turn's state shown", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-panel")).toBeVisible();
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Ready");
    await sendMessage(page, "What does this model do?");
    await expect(page.getByTestId("assistant-user-message")).toHaveText("What does this model do?");
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Working…");
    reply(stub, [
      { t: "", type: "tool_call", tool: "read_open_model", args: {} },
      { t: "", type: "tool_result", tool: "read_open_model", ok: true, summary: "2 mechanisms" },
      { t: "", type: "text", text: "Two mechanisms joined by `sender_to_receiver`. See https://docs.example/intro for more." },
    ]);
    await expect(page.getByTestId("assistant-reply")).toContainText("Two mechanisms joined by");
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Done.");
    // A link shows its full address before anything opens, and is never an anchor.
    await expect(page.getByTestId("assistant-link")).toHaveText("docs.example (link)");
    await expect(page.locator("[data-testid=assistant-reply] a")).toHaveCount(0);
    await page.getByTestId("assistant-link").click();
    await expect(page.getByTestId("assistant-link-address")).toContainText("https://docs.example/intro");
    await shot(page, "04-panel");
  });

  test("hostile text is inert: no element injected, no request to a remote address", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    const remote: string[] = [];
    await page.route("**/evil.invalid/**", (route) => {
      remote.push(route.request().url());
      return route.abort();
    });
    page.on("request", (req) => {
      if (req.url().includes("evil.invalid")) remote.push(req.url());
    });
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await sendMessage(page, "hi");
    reply(stub, [
      {
        t: "",
        type: "text",
        text:
          '<img src="https://evil.invalid/pixel.png" onerror="document.title=\'owned\'"><script>document.title="owned"</script>' +
          '<a href="javascript:document.title=\'owned\'">click</a> javascript:alert(1) ' +
          "![x](https://evil.invalid/a.png) <iframe src=https://evil.invalid/f></iframe>",
      },
    ]);
    const replyEl = page.getByTestId("assistant-reply");
    await expect(replyEl).toContainText("<img src=");
    await expect(replyEl.locator("img, script, iframe, a, object, embed, link, style")).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.title()).not.toBe("owned");
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Done.");
    expect(remote).toEqual([]);
  });

  test("a proposal accepted is one History entry, and one undo reverses it", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    const model = scratchModel();
    await page.goto("/");
    await openFromPath(page, model);
    await page.getByTestId("tab-assistant").click();
    await sendMessage(page, "Set the slope to 2");
    // A structured op, applied through the real /api/model/update-param; the
    // proposal's text is a description and is never applied as source.
    reply(stub, [
      {
        t: "",
        type: "proposal",
        proposal: {
          id: "p1", kind: "app_edit", summary: "Set the slope of sender_mech to 2", state: "pending", base_hash: "x",
          ops: [{ op: "update_param", args: { var_name: "sender_mech", param_name: "slope", new_value: "2", context: "function" } }],
          path: model, before: null, after: "sender_mech.function.slope = 2\nimport os  # not applied", freeform_python: false, warnings: [],
        },
      },
    ]);
    const card = page.getByTestId("assistant-proposal");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Waiting for you");
    await expect(card.getByTestId("assistant-proposal-after")).toContainText("sender_mech.function.slope = 2");
    await shot(page, "05-proposal");

    await card.getByTestId("assistant-proposal-accept").click();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Accepted");
    expect(stub.accepted).toEqual(["p1"]);
    await expect(page.locator(".cm-content")).toContainText("slope=2");
    await expect(page.locator(".cm-content")).not.toContainText("import os");
    await expect(page.getByTestId("undo-button")).toHaveAttribute("title", "Undo: Assistant: Set the slope of sender_mech to 2 (⌘Z)");

    await page.getByTestId("undo-button").click();
    await expect(page.locator(".cm-content")).not.toContainText("slope=2");
    await expect(page.getByTestId("undo-button")).not.toHaveAttribute("title", /Assistant/);
  });

  test("free-form Python is called out, and a stale proposal says so", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await sendMessage(page, "Write a model file");
    reply(stub, [
      {
        t: "",
        type: "proposal",
        proposal: {
          id: "p2", kind: "file_write", summary: "Write stroop.py", state: "pending", base_hash: "x",
          ops: [], path: "/Users/me/Models/stroop.py", before: "", after: "import os\nos.system('ls')\n", freeform_python: true,
          warnings: ["Calls os.system", "Imports os"],
        },
      },
    ]);
    const card = page.getByTestId("assistant-proposal");
    const warning = card.getByTestId("assistant-proposal-python-warning");
    await expect(warning).toContainText("may run on this machine");
    await expect(warning).toContainText("not a guarantee");
    await expect(warning).toContainText("Calls os.system");
    await expect(card.getByTestId("assistant-proposal-accept")).toHaveText("Approve and apply");
    await shot(page, "06-python-warnings");

    stub.acceptStatus = 409;
    await card.getByTestId("assistant-proposal-accept").click();
    await expect(card.getByTestId("assistant-proposal-stale")).toContainText("The file changed since the assistant read it");
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Out of date");
    await expect(card.getByTestId("assistant-proposal-accept")).toBeDisabled();
    expect(stub.accepted).toEqual([]);
  });

  test("Stop ends the turn, from the button and from the shortcut", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-stop")).toBeVisible();
    await expect(page.getByTestId("assistant-stop")).toBeDisabled();
    await sendMessage(page, "Go on for a while");
    await expect(page.getByTestId("assistant-stop")).toBeEnabled();
    await page.getByTestId("assistant-stop").click();
    await expect.poll(() => stub.stopped).toBe(true);
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopped.");
    await expect(page.getByTestId("assistant-stop")).toBeDisabled();

    // The shortcut, while typing in the text box: Stop has to be reachable.
    stub.stopped = false;
    await sendMessage(page, "Again");
    await expect(page.getByTestId("assistant-stop")).toBeEnabled();
    await page.getByTestId("assistant-input").focus();
    // The registry reads Mod as Cmd on a Mac page and Ctrl elsewhere, by what
    // the page's navigator says, which Playwright's emulation may not match
    // to the host; ask the page which it is.
    const pageIsMac = await page.evaluate(() =>
      [(navigator as any).userAgentData?.platform, navigator.platform, navigator.userAgent].some((c) => c && /mac/i.test(c)),
    );
    await page.keyboard.press(pageIsMac ? "Meta+." : "Control+.");
    await expect.poll(() => stub.stopped).toBe(true);
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopped.");

    // And it is listed with the other shortcuts.
    await openSettings(page);
    await page.getByTestId("settings-section-shortcuts").click();
    await expect(page.getByTestId("setting-keyboard-shortcuts")).toContainText("Stop the assistant");
  });
});
