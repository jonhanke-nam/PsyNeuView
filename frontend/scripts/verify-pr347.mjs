// Live verification for #347: Open-from-path / Save-As route through the
// Mac app's pnvFile bridge when present (mocked here — the real handler is
// jonhanke-nam/PsyNeuView-MacApp#28), and fall back to the typed-path
// prompt / default save dir on plain web.
//
// Default port: frontend :5179. Override with FRONTEND_URL= for a slot.

import { chromium } from "playwright";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5179";
const OPEN_TARGET = process.env.OPEN_MODEL ?? resolve(process.cwd(), "../backend/test_nested_model.py");
const SAVE_DIR = "/tmp/pnv-bridge-347";
const SAVE_PATH = `${SAVE_DIR}/bridge_copy.py`;
const OUT = "/tmp/pr-347-verify";
mkdirSync(OUT, { recursive: true });
rmSync(SAVE_DIR, { recursive: true, force: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });
page.on("dialog", (d) => d.accept());

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// --- Bridge present (mocked WKScriptMessageHandlerWithReply) ----------------
await page.evaluate(([openPath, savePath]) => {
  window.__bridgeCalls = [];
  window.webkit = {
    messageHandlers: {
      pnvFile: {
        postMessage: async (msg) => {
          window.__bridgeCalls.push(msg);
          return { path: msg.op === "open" ? openPath : savePath };
        },
      },
    },
  };
}, [OPEN_TARGET, SAVE_PATH]);

// Open from path… goes straight to the native panel (no typed-path prompt).
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(200);
await page.getByText("Open from path...", { exact: true }).click();
await page.waitForFunction(
  (p) => window.__modelStore.getState().filePath === p,
  OPEN_TARGET,
  { timeout: 25000 },
);
assert(true, "bridge open: model loaded from the picker-returned path");
assert(await page.locator("input[placeholder='/path/to/model.py']").count() === 0,
  "bridge open: typed-path prompt did not appear");
const openCall = await page.evaluate(() => window.__bridgeCalls.find((c) => c.op === "open"));
assert(!!openCall && (openCall.extensions ?? []).includes("pnlproject"),
  `bridge open: message carries op+extensions (${JSON.stringify(openCall)})`);
await page.waitForSelector(".react-flow__node", { timeout: 25000 });

// Save a copy as… exposes Choose… which rewrites destination dir + name.
await page.getByRole("button", { name: /Save a copy as/ }).click();
await page.waitForTimeout(200);
const chooseBtn = page.getByRole("button", { name: "Choose…" });
assert(await chooseBtn.count() === 1, "bridge save: Choose… button present");
await chooseBtn.click();
await page.waitForTimeout(200);
assert(await page.getByText(`Save to: ${SAVE_DIR}/`).count() === 1,
  "bridge save: destination shows the picked directory");
assert(await page.locator("input[placeholder='my_model.py']").inputValue() === "bridge_copy.py",
  "bridge save: name input took the picked filename");
const saveCall = await page.evaluate(() => window.__bridgeCalls.find((c) => c.op === "saveAs"));
assert(!!saveCall && !!saveCall.defaultName,
  `bridge save: message carries op+defaultName (${JSON.stringify(saveCall)})`);
await page.screenshot({ path: `${OUT}/bridge-save-as.png`, fullPage: true });
// .last(): the toolbar has its own (disabled) Save button; the modal's is
// rendered after it.
await page.getByRole("button", { name: "Save", exact: true }).last().click();
await page.waitForFunction(
  (p) => window.__modelStore.getState().filePath === p,
  SAVE_PATH,
  { timeout: 25000 },
);
assert(existsSync(SAVE_PATH), `bridge save: file written at ${SAVE_PATH}`);

// --- Plain web (no bridge) ---------------------------------------------------
await page.evaluate(() => { delete window.webkit; });

await page.getByRole("button", { name: /Save a copy as/ }).click();
await page.waitForTimeout(200);
assert(await page.getByRole("button", { name: "Choose…" }).count() === 0,
  "fallback save: no Choose… button without the bridge");
assert(await page.getByText(/Save to: .+\/Documents\/|Save to: \//).count() === 1,
  "fallback save: default save dir shown");
await page.keyboard.press("Escape");
await page.locator("body").click({ position: { x: 10, y: 300 } });
await page.waitForTimeout(200);

await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(200);
await page.getByText("Open from path...", { exact: true }).click();
await page.waitForTimeout(300);
assert(await page.locator("input[placeholder='/path/to/model.py']").count() === 1,
  "fallback open: typed-path prompt appears without the bridge");
await page.screenshot({ path: `${OUT}/fallback-prompt.png`, fullPage: true });
await page.keyboard.press("Escape");

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
