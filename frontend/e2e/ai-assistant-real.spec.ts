/**
 * The AI assistant end to end (#179): the real backend, with no assistant
 * route stubbed, and a small fake OpenAI-compatible server on loopback that
 * this test starts and scripts. No real AI service, no key.
 *
 * Turn on and configure in Settings; a conversation; the agent reads the
 * model; it proposes a parameter edit, the user accepts, the graph and the
 * source change, and one undo reverses it; a file write in an allowed
 * folder is proposed and accepted, opening it is blocked until approved,
 * then it opens; a hostile proposal is refused; Stop works.
 *
 * Every file is in a temp folder. The harness points the assistant's state,
 * log and key store at the session's temp folder (playwright.config.ts), and
 * the test checks the real preferences and review state were not touched.
 * Screenshots land in `$SHOTS_DIR` when it is set.
 */
import { mutatingTest as test, expect } from "./test-base";
import http from "http";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

// ── the fake agent ───────────────────────────────────────────────────────

type Msg = { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string };

interface FakeAgent {
  url: string;
  requests: number;
  /** Delay the next reply this long (Stop has to have something to stop). */
  slowMs: number;
  close: () => Promise<void>;
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { id: `call_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/**
 * What the agent "decides", from the last user message or the last tool
 * result. A fixed script: the point is the app's side, not the agent's.
 */
function decide(messages: Msg[], folder: string, marker: string, hostileMarker: string): { content: string | null; tool_calls?: unknown[] } {
  const last = messages[messages.length - 1];
  if (last.role === "tool") {
    const content = String(last.content ?? "");
    if (content.startsWith("Refused:")) return { content: `The app refused that: ${content.slice(9).trim()}` };
    try {
      const data = JSON.parse(content.replace(/^\[untrusted data from the user's machine\]\n/, ""));
      if (typeof data.source === "string") {
        const names = Array.from(data.source.matchAll(/^(\w+) = pnl\.(\w+)\(/gm)).map((m) => `${m[1]} (${m[2]})`);
        return { content: `I read the model: ${names.join(", ")}.` };
      }
      if (data.proposal_id) return { content: "Proposed. Accept it if you agree." };
    } catch {
      // not JSON
    }
    return { content: "Done." };
  }
  const text = String(last.content ?? "").toLowerCase();
  if (text.includes("look at the model")) return { content: null, tool_calls: [toolCall("read_open_model", {})] };
  if (text.includes("set the slope")) {
    return {
      content: null,
      tool_calls: [toolCall("propose_app_edit", {
        summary: "Set the slope of sender_mech to 2",
        ops: [{ op: "update_param", args: { var_name: "sender_mech", param_name: "slope", new_value: "2", context: "function" } }],
      })],
    };
  }
  if (text.includes("write a new model")) {
    // Runs only if opened: the marker says whether it did.
    const model =
      "from pathlib import Path\n" +
      `Path(${JSON.stringify(marker)}).write_text('ran')\n` +
      "import psyneulink as pnl\n" +
      "wrote_mech = pnl.TransferMechanism(name='wrote_mech')\n" +
      "wrote = pnl.Composition(name='wrote')\n" +
      "wrote.add_node(wrote_mech)\n";
    return { content: null, tool_calls: [toolCall("propose_file_write", { path: path.join(folder, "assistant_wrote.py"), text: model, summary: "Write assistant_wrote.py" })] };
  }
  if (text.includes("open it")) return { content: null, tool_calls: [toolCall("propose_open_file", { path: path.join(folder, "assistant_wrote.py"), summary: "Open assistant_wrote.py" })] };
  if (text.includes("hostile value")) {
    return {
      content: null,
      tool_calls: [toolCall("propose_app_edit", {
        summary: "Tune the slope",
        ops: [{ op: "update_param", args: { var_name: "sender_mech", param_name: "slope", new_value: `__import__('pathlib').Path(${JSON.stringify(hostileMarker)}).write_text('owned')`, context: "function" } }],
      })],
    };
  }
  if (text.includes("hostile source")) {
    return {
      content: null,
      tool_calls: [toolCall("propose_app_edit", {
        summary: "Rewrite the model",
        ops: [{ op: "replace_source", args: { after: `import pathlib\npathlib.Path(${JSON.stringify(hostileMarker)}).write_text('owned')\n` } }],
      })],
    };
  }
  return { content: `Hello. You said: ${last.content}` };
}

async function startFakeAgent(folder: string, marker: string, hostileMarker: string): Promise<FakeAgent> {
  const agent: FakeAgent = { url: "", requests: 0, slowMs: 0, close: async () => undefined };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      agent.requests += 1;
      if (req.method !== "POST" || !req.url?.endsWith("/v1/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as { messages: Msg[] };
      const reply = decide(body.messages, folder, marker, hostileMarker);
      const delay = agent.slowMs;
      agent.slowMs = 0;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-fake", object: "chat.completion", model: "fake",
          choices: [{ index: 0, finish_reason: reply.tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content: reply.content, ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}) } }],
          usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 },
        }));
      }, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake agent: no port");
  agent.url = `http://127.0.0.1:${address.port}`;
  agent.close = () => new Promise((resolve) => server.close(() => resolve()));
  return agent;
}

// ── helpers ──────────────────────────────────────────────────────────────

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
}

/** The backend's 409 for a raised permission: confirm it when it is asked. */
async function allowIfAsked(page: Page) {
  const confirm = page.getByTestId("assistant-raise-confirm");
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("assistant-raise-confirm-yes").click();
  await expect(confirm).toHaveCount(0);
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

async function send(page: Page, text: string) {
  await page.getByTestId("assistant-input").fill(text);
  await page.getByTestId("assistant-send").click();
}

async function waitDone(page: Page) {
  await expect(page.getByTestId("assistant-turn-state")).toHaveText(/Done\.|Stopped\.|Stopped at/, { timeout: 30_000 });
}

function mtimeOrNull(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// ── the story ────────────────────────────────────────────────────────────

const REAL_PREFS = path.join(homedir(), ".psynewview.json");
const REAL_REVIEW = path.join(homedir(), ".psyneuview", "assistant-review.json");

let folder: string;
let model: string;
let marker: string;
let hostileMarker: string;
let agent: FakeAgent;
let realBefore: { prefs: number | null; review: number | null };

test.describe.configure({ mode: "serial" });

test.describe("AI assistant, for real (#179)", { tag: "@ci" }, () => {
  test.beforeAll(async () => {
    realBefore = { prefs: mtimeOrNull(REAL_PREFS), review: mtimeOrNull(REAL_REVIEW) };
    folder = realpathSync(mkdtempSync(path.join(tmpdir(), "assistant179-real-")));
    model = path.join(folder, "two_mech_projection.py");
    writeFileSync(model, BASE);
    marker = path.join(folder, "..", path.basename(folder) + "-ran.txt");
    hostileMarker = path.join(folder, "..", path.basename(folder) + "-owned.txt");
    agent = await startFakeAgent(folder, marker, hostileMarker);
  });

  test.afterAll(async () => {
    await agent.close();
    // Nothing of the user's was touched.
    expect(mtimeOrNull(REAL_PREFS)).toBe(realBefore.prefs);
    expect(mtimeOrNull(REAL_REVIEW)).toBe(realBefore.review);
  });

  test("turn it on and configure it, against the real settings routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("tab-inspector")).toBeVisible();
    await expect(page.getByTestId("tab-assistant")).toHaveCount(0);
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    await expect(page.getByTestId("setting-assistant-enabled")).not.toBeChecked();

    await page.getByTestId("setting-assistant-enabled").click();
    await allowIfAsked(page);
    await expect(page.getByTestId("assistant-explanation")).toContainText("What is shared:");
    await page.getByTestId("assistant-explanation-ok").click();
    await expect(page.getByTestId("setting-assistant-enabled")).toBeChecked();

    // The agent: an OpenAI-compatible server on this machine.
    await page.getByTestId("setting-assistant-agent-type").selectOption("openai_compatible");
    const url = page.getByTestId("setting-assistant-agent-base-url");
    await expect(url).toBeVisible();
    await url.fill(agent.url);
    await url.blur();
    await expect(page.getByTestId("assistant-section")).toContainText(`sent to ${agent.url}`);

    // A folder it may write in, and files visible.
    await page.getByLabel("Folder to add").fill(folder);
    await page.getByRole("button", { name: "Add (read only)" }).click();
    await allowIfAsked(page);
    await expect(page.getByTestId("setting-assistant-folders")).toContainText(folder);
    await page.getByLabel(`Access to ${folder}`).selectOption("read_write");
    await allowIfAsked(page);
    await page.getByTestId("setting-assistant-visibility-files").click();
    await allowIfAsked(page);
    await expect(page.getByTestId("setting-assistant-visibility-files")).toBeChecked();
    await expect(page.getByTestId("setting-assistant-limit-max-tokens")).toHaveValue("100000");
    await shot(page, "10-settings-configured");

    // Stored by the backend, not the page: a reload shows the same.
    await page.reload();
    await openSettings(page);
    await page.getByTestId("settings-section-assistant").click();
    await expect(page.getByTestId("setting-assistant-enabled")).toBeChecked();
    await expect(page.getByTestId("setting-assistant-agent-base-url")).toHaveValue(agent.url);
    await expect(page.getByLabel(`Access to ${folder}`)).toHaveValue("read_write");
    await closeSettings(page);
    await expect(page.getByTestId("tab-assistant")).toBeVisible();
  });

  test("a conversation: it reads the model, proposes an edit, the user accepts, one undo reverses it", async ({ page }) => {
    await page.goto("/");
    await openFromPath(page, model);
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Ready");

    await send(page, "hello there");
    await waitDone(page);
    await expect(page.getByTestId("assistant-reply").last()).toContainText("Hello. You said: hello there");
    // Spending, from the usage the service reported.
    await expect(page.getByTestId("assistant-tokens-used")).toContainText("1,000 of 100,000 tokens");

    await send(page, "look at the model");
    await waitDone(page);
    await expect(page.getByTestId("assistant-reply").last()).toContainText("I read the model: sender_mech (TransferMechanism), receiver_mech (TransferMechanism)");
    await shot(page, "11-conversation");

    await send(page, "set the slope of sender_mech to 2");
    await waitDone(page);
    const card = page.getByTestId("assistant-proposal").last();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Waiting for you");
    await expect(card.getByTestId("assistant-proposal-summary")).toHaveText("Set the slope of sender_mech to 2");
    await expect(card.getByTestId("assistant-proposal-after")).toHaveText("sender_mech.function.slope = 2");
    await expect(page.locator(".cm-content")).not.toContainText("slope=2");
    await shot(page, "12-proposal");

    await card.getByTestId("assistant-proposal-accept").click();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Accepted");
    // The source and the graph changed, through the user's own edit route.
    await expect(page.locator(".cm-content")).toContainText("function=pnl.Linear(slope=2)");
    expect(readFileSync(model, "utf8")).toContain("function=pnl.Linear(slope=2)");
    await expect(page.getByTestId("undo-button")).toHaveAttribute("title", "Undo: Assistant: Set the slope of sender_mech to 2 (⌘Z)");
    await shot(page, "13-applied");

    await page.getByTestId("undo-button").click();
    await expect(page.locator(".cm-content")).not.toContainText("slope=2");
    await expect(page.getByTestId("undo-button")).not.toHaveAttribute("title", /Assistant/);
  });

  test("a file write in an allowed folder: accepted, blocked from opening until approved, then open", async ({ page }) => {
    await page.goto("/");
    await openFromPath(page, model);
    await page.getByTestId("tab-assistant").click();

    await send(page, "write a new model file for me");
    await waitDone(page);
    const card = page.getByTestId("assistant-proposal").last();
    await expect(card).toContainText("Write a file");
    await expect(card.getByTestId("assistant-proposal-python-warning")).toContainText("free-form Python");
    await expect(card.getByTestId("assistant-proposal-python-warning")).toContainText("accesses files");
    await expect(card.getByTestId("assistant-proposal-before")).toHaveText("(a new file)");
    const written = path.join(folder, "assistant_wrote.py");
    expect(existsSync(written)).toBe(false);
    await shot(page, "14-file-write");

    await card.getByTestId("assistant-proposal-accept").click();
    await expect(card.getByTestId("assistant-proposal-state")).toHaveText("Accepted");
    await expect.poll(() => existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain("wrote_mech");
    // Written, not run.
    expect(existsSync(marker)).toBe(false);

    await send(page, "open it");
    await waitDone(page);
    const open = page.getByTestId("assistant-proposal").last();
    await expect(open).toContainText("Open a file");
    await open.getByTestId("assistant-proposal-accept").click();
    await expect(open.getByTestId("assistant-proposal-state")).toHaveText("Accepted");
    // Opening runs it: refused, and the review offered, with the whole file shown.
    const offer = page.getByTestId("assistant-review-offer");
    await expect(offer).toBeVisible();
    await expect(offer.getByTestId("assistant-review-content")).toContainText("wrote_mech = pnl.TransferMechanism");
    await expect(offer.getByTestId("assistant-review-content")).toContainText("write_text('ran')");
    expect(existsSync(marker)).toBe(false);
    await expect(page.locator(".react-flow__node", { hasText: "wrote_mech" })).toHaveCount(0);
    await shot(page, "15-review-offer");

    await offer.getByTestId("assistant-review-approve").click();
    await expect(offer).toHaveCount(0);
    // Approved by the user, so it opens, and only now does it run.
    await expect(page.locator(".react-flow__node", { hasText: "wrote_mech" })).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => existsSync(marker)).toBe(true);
    await shot(page, "16-opened-after-approval");
  });

  test("a hostile proposal is refused: code in a value, and source in an unknown op", async ({ page }) => {
    await page.goto("/");
    await openFromPath(page, model);
    await page.getByTestId("tab-assistant").click();

    await send(page, "hostile value please");
    await waitDone(page);
    await expect(page.getByTestId("assistant-refused").last()).toContainText("Refused propose_app_edit");
    await expect(page.getByTestId("assistant-refused").last()).toContainText("plain literal");
    await expect(page.getByTestId("assistant-reply").last()).toContainText("The app refused that");

    await send(page, "hostile source please");
    await waitDone(page);
    await expect(page.getByTestId("assistant-refused").last()).toContainText("replace_source");
    await expect(page.getByTestId("assistant-refused").last()).toContainText("isn't one of the structured edits");
    await expect(page.getByTestId("assistant-proposal")).toHaveCount(0);
    expect(existsSync(hostileMarker)).toBe(false);
    expect(readFileSync(model, "utf8")).not.toContain("owned");
    await shot(page, "17-refused");
  });

  test("Stop ends the turn, from the button and from the shortcut", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-assistant").click();
    await expect(page.getByTestId("assistant-stop")).toBeDisabled();

    agent.slowMs = 4000;
    await send(page, "take your time");
    await expect(page.getByTestId("assistant-stop")).toBeEnabled();
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Working…");
    await page.getByTestId("assistant-stop").click();
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopping…");
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopped.", { timeout: 15_000 });
    await expect(page.getByTestId("assistant-stop")).toBeDisabled();
    // The reply that came back after Stop was discarded.
    await expect(page.getByTestId("assistant-reply")).toHaveCount(0);
    await shot(page, "18-stopped");

    agent.slowMs = 4000;
    await send(page, "and again");
    await expect(page.getByTestId("assistant-stop")).toBeEnabled();
    await page.getByTestId("assistant-input").focus();
    const pageIsMac = await page.evaluate(() =>
      [(navigator as any).userAgentData?.platform, navigator.platform, navigator.userAgent].some((c) => c && /mac/i.test(c)),
    );
    await page.keyboard.press(pageIsMac ? "Meta+." : "Control+.");
    await expect(page.getByTestId("assistant-turn-state")).toHaveText("Stopped.", { timeout: 15_000 });
  });
});
