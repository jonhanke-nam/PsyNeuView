/**
 * The AI assistant's page (#179), against a stubbed backend (page.route), so
 * it runs whether or not the backend has the assistant yet.
 *
 * Hidden when the deployment has no assistant; turning it on asks first and
 * then explains; raising a permission asks; a conversation; hostile text
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
  limits: { tool_calls: 25, minutes: 10 },
  keep_log: true,
};

type Event = Record<string, unknown> & { seq: number; type: string };

/** The stubbed backend: settings with the 409 raise flow, one session, a queue of events. */
interface Stub {
  settings: typeof DEFAULTS;
  events: Event[];
  running: boolean;
  stopped: boolean;
  accepted: string[];
  acceptStatus: number;
  puts: Record<string, unknown>[];
}

const RANK: Record<string, number> = { answer: 0, suggest: 1, app_edits: 2 };

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
    const raised: string[] = [];
    if (!stub.settings.enabled && body.enabled) raised.push("turn the assistant on");
    if (RANK[body.autonomy] > RANK[stub.settings.autonomy]) raised.push("let it propose edits to the open model");
    if (raised.length && !body.confirm_raise) return route.fulfill({ status: 409, json: { detail: { raised } } });
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

async function sendMessage(page: Page, text: string) {
  await page.getByTestId("assistant-input").fill(text);
  await page.getByTestId("assistant-send").click();
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

  test("off by default; turning it on asks, then explains what is shared", async ({ page }) => {
    const stub = await stubAssistant(page);
    await page.goto("/");
    await expect(page.getByTestId("tab-assistant")).toHaveCount(0);
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    const on = page.getByTestId("setting-assistant-enabled");
    await expect(on).not.toBeChecked();
    await expect(page.getByText("An external agent's own access can't be limited by PsyNeuView")).toBeVisible();
    await expect(page.getByTestId("assistant-api-key-state")).toHaveText("No key is set.");
    await shot(page, "01-settings-off");

    await on.click();
    // The backend's 409: asked before anything is raised, and nothing saved yet.
    const confirm = page.getByTestId("assistant-raise-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("turn the assistant on");
    expect(stub.settings.enabled).toBe(false);
    await page.getByTestId("assistant-raise-confirm-yes").click();
    expect(stub.settings.enabled).toBe(true);
    expect(stub.puts[stub.puts.length - 1].confirm_raise).toBe(true);

    const explanation = page.getByTestId("assistant-explanation");
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText("What is shared:");
    await expect(explanation).toContainText("With whom:");
    await expect(explanation).toContainText("What it can do:");
    await shot(page, "02-explanation");
    await page.getByTestId("assistant-explanation-ok").click();
    await expect(explanation).toHaveCount(0);
    await expect(on).toBeChecked();
    await shot(page, "03-settings-on");

    // The tab appears once it is on, and goes when it is off.
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("tab-assistant")).toBeVisible();
  });

  test("raising a permission asks, and keeping as it was changes nothing", async ({ page }) => {
    const stub = await stubAssistant(page, { enabled: true });
    await page.goto("/");
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    await page.getByTestId("setting-assistant-autonomy").selectOption("app_edits");
    const confirm = page.getByTestId("assistant-raise-confirm");
    await expect(confirm).toContainText("let it propose edits to the open model");
    await page.getByTestId("assistant-raise-confirm-no").click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId("setting-assistant-autonomy")).toHaveValue("suggest");
    expect(stub.settings.autonomy).toBe("suggest");
    // Lowering never asks.
    await page.getByTestId("setting-assistant-autonomy").selectOption("answer");
    await expect(page.getByTestId("assistant-raise-confirm")).toHaveCount(0);
    await expect.poll(() => stub.settings.autonomy).toBe("answer");
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
    await sendMessage(page, "Add a note");
    const after = BASE + "# added by the assistant\n";
    reply(stub, [
      {
        t: "",
        type: "proposal",
        proposal: {
          id: "p1", kind: "app_edit", summary: "Add a note at the end", state: "pending", base_hash: "x",
          ops: [{ op: "append_comment", args: {} }], path: null, before: BASE, after, freeform_python: false, warnings: [],
        },
      },
    ]);
    const card = page.getByTestId("assistant-proposal");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Waiting for you");
    await expect(card.getByTestId("assistant-proposal-before")).toContainText("sender_mech");
    await expect(card.getByTestId("assistant-proposal-after")).toContainText("# added by the assistant");
    await shot(page, "05-proposal");

    await card.getByTestId("assistant-proposal-accept").click();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Accepted");
    expect(stub.accepted).toEqual(["p1"]);
    await expect(page.locator(".cm-content")).toContainText("# added by the assistant");
    await expect(page.getByTestId("undo-button")).toHaveAttribute("title", "Undo: Assistant: Add a note at the end (⌘Z)");

    await page.getByTestId("undo-button").click();
    await expect(page.locator(".cm-content")).not.toContainText("# added by the assistant");
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
          ops: [], path: "~/Models/stroop.py", before: "", after: "import os\nos.system('ls')\n", freeform_python: true,
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
    await expect(card.getByTestId("assistant-proposal-stale")).toContainText("The model changed since the assistant read it");
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
    await page.keyboard.press("ControlOrMeta+.");
    await expect.poll(() => stub.stopped).toBe(true);
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopped.");

    // And it is listed with the other shortcuts.
    await openSettings(page);
    await page.getByTestId("settings-section-shortcuts").click();
    await expect(page.getByTestId("setting-keyboard-shortcuts")).toContainText("Stop the assistant");
  });
});
