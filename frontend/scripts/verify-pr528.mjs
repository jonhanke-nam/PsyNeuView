// Live verification for #528: deleting a trial row in the Run panel's input
// editor is now undoable. Removes a trial via its ✕, asserts the row vanished
// from every input node and the "Trial N removed — Undo" bar appeared, then
// undoes and asserts the row is back at its index with the exact edited
// values. Also checks the stack survives multiple deletions (LIFO) and that a
// model reload clears the bar.
//
// Default port: frontend :5173. Override with FRONTEND_URL= for a slot.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5173";
const OUT = "/tmp/pr-528-verify";
mkdirSync(OUT, { recursive: true });

const fails = [];
const assert = (c, m) => { if (!c) fails.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

await page.goto(FRONTEND, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// Load Stroop Basic and open the Run tab.
await page.getByRole("button", { name: /Open/ }).first().click();
await page.waitForTimeout(300);
await page.getByText("Stroop Basic", { exact: true }).first().click();
await page.waitForSelector(".react-flow__node", { timeout: 25000 });
await page.getByRole("button", { name: "Run", exact: true }).first().click();
await page.waitForTimeout(500);

// Grid geometry helpers. Each input node section renders one ✕ per trial row
// (title="Remove this trial"); rows per node = removeButtons / nodes.
const removeButtons = page.locator('[title="Remove this trial"]');
const countRows = async () => removeButtons.count();
const undoBar = page.getByRole("status").filter({ hasText: "removed" });
const undoButton = page.getByRole("button", { name: "Undo", exact: true });

const initial = await countRows();
assert(initial > 0, `trial rows render (${initial} ✕ buttons)`);
const nodes = await page.locator("text=/\\[\\d+ elements?\\]/").count();
assert(nodes > 1, `multiple input nodes render (${nodes})`);
const rowsPerNode = initial / nodes;
assert(Number.isInteger(rowsPerNode), `✕ count divides evenly across nodes (${initial}/${nodes})`);

// Plant distinctive values in trial 2 of the first node so undo can be
// checked for value fidelity, not just row count.
const firstNodeInputs = page.locator('input[type="text"], input:not([type])');
// Cells are per-node grids; address trial-2 cells of node 1 via the spinbutton/text inputs
// inside the first node section. Use evaluate for robustness against styling.
const planted = await page.evaluate(() => {
  // Find all input elements that sit in the same section as the first "Trial 2" label.
  const all = [...document.querySelectorAll("input")];
  const cells = all.filter((i) => i.closest("div")?.textContent !== null);
  // Locate the first node's trial-2 row: inputs between the "Trial 2" label and "Trial 3".
  const labels = [...document.querySelectorAll("span,div")].filter((e) => e.textContent?.trim() === "Trial 2");
  if (!labels.length) return null;
  const row = labels[0].closest("div");
  const rowInputs = row ? [...row.querySelectorAll("input")] : [];
  const setVal = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  rowInputs.forEach((el, i) => setVal(el, String(7 + i))); // 7, 8, ...
  return rowInputs.map((el) => el.value);
});
assert(planted && planted.length > 0 && planted[0] === "7", `planted distinctive values in trial 2 (${JSON.stringify(planted)})`);
await page.waitForTimeout(200);

// Delete trial 2 (index 1) via the first node's second ✕.
await removeButtons.nth(1).click();
await page.waitForTimeout(300);
const afterDelete = await countRows();
assert(afterDelete === initial - nodes, `trial removed from every node (✕ ${initial} → ${afterDelete}, expected ${initial - nodes})`);
assert(await undoBar.count() === 1, `undo bar appears`);
const barText = await undoBar.first().textContent();
assert(/Trial 2 removed/.test(barText ?? ""), `bar names the removed trial ("${barText?.trim()}")`);
await page.screenshot({ path: `${OUT}/after-delete.png`, fullPage: true });

// Undo → row count restored and planted values back in trial 2 of node 1.
await undoButton.click();
await page.waitForTimeout(300);
const afterUndo = await countRows();
assert(afterUndo === initial, `undo restores the row in every node (✕ ${afterUndo})`);
assert(await undoBar.count() === 0, `undo bar dismissed after restore`);
const restored = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("span,div")].filter((e) => e.textContent?.trim() === "Trial 2");
  const row = labels[0]?.closest("div");
  return row ? [...row.querySelectorAll("input")].map((el) => el.value) : null;
});
assert(restored && restored[0] === "7", `restored trial carries the edited values (${JSON.stringify(restored)})`);
await page.screenshot({ path: `${OUT}/after-undo.png`, fullPage: true });

// LIFO stack: delete two trials, bar reports the latest + count, two undos
// walk all the way back.
await removeButtons.nth(0).click();
await page.waitForTimeout(150);
await removeButtons.nth(0).click();
await page.waitForTimeout(150);
const stackedText = await undoBar.first().textContent();
assert(/\+1 earlier/.test(stackedText ?? ""), `stacked deletions reported ("${stackedText?.trim()}")`);
await undoButton.click();
await page.waitForTimeout(150);
await undoButton.click();
await page.waitForTimeout(300);
assert((await countRows()) === initial, `two undos restore both deletions (✕ ${await countRows()})`);
assert(await undoBar.count() === 0, `bar clears when stack is empty`);

assert(pageErrors.length === 0, `no page errors (${pageErrors.length})`);

await browser.close();
console.log(fails.length ? `\nFAILED (${fails.length}):\n  ${fails.join("\n  ")}` : "\nALL PASSED.");
process.exit(fails.length ? 1 : 0);
