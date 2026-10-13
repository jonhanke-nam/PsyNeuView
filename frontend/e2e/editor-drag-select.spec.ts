/**
 * Dragging the mouse in the code editor must not raise an error (#1094).
 *
 * "Click and dragging in a python file causes an error" — reported against an
 * early Mac app build, never reproduced, and thin on detail: a toast, a panel
 * or a console exception? Selecting text with the mouse is about the most
 * basic thing anyone does in an editor, so whatever it broke it broke all the
 * time. This spec drives the gestures a person actually makes and listens on
 * every channel an error could reach them by:
 *
 *   - `pageerror`: an uncaught exception, which React would turn into a crash
 *   - `console.error`: what a caught-and-logged failure leaves behind
 *   - text appearing in the page that says "error" or "failed": a toast, or
 *     the canvas's "No model to display" panel
 *
 * Gestures, each one its own test so a failure names the gesture:
 *
 *   1. a plain drag-selection, forwards and backwards, across the
 *      declarations the cursor-highlight listener walks on every selection
 *      change;
 *   2. dragging a selection to move it (CodeMirror's drag-and-drop of text)
 *      — a comment line, so the Python stays valid and any error is the
 *      gesture's, not the model's;
 *   3. dragging a selection out of the editor and dropping it on the canvas,
 *      where the app's file-drop handler lives.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const editor = (page: Page) => page.locator(".cm-content");
const canvas = (page: Page) => page.getByTestId("graph-canvas-viewport");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "drag1094-"));
  const file = path.join(dir, "two_mech_projection.py");
  copyFileSync(fixturePath("two_mech_projection"), file);
  return file;
}

async function openModel(page: Page, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await expect(editor(page)).toBeVisible();
  // The "Loaded …" toast mentions nothing alarming, but let it go before the
  // DOM trap is armed so the trap only ever sees what a gesture caused.
  await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });
}

type Traps = { errors: string[]; pageText: () => Promise<string[]> };

/** Listen on every channel an error can reach the user by. */
async function armTraps(page: Page): Promise<Traps> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  await page.evaluate(() => {
    const hits: string[] = [];
    (window as any).__dragTrapHits = hits;
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          const text = (n.textContent || "").trim();
          if (/\b(error|failed)\b/i.test(text)) hits.push(text.slice(0, 200));
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
  return {
    errors,
    pageText: () => page.evaluate(() => (window as any).__dragTrapHits as string[]),
  };
}

async function expectClean(page: Page, traps: Traps) {
  // Give a preview / timer-driven listener its chance to misbehave.
  await page.waitForTimeout(1500);
  expect(traps.errors, `errors raised:\n${traps.errors.join("\n")}`).toEqual([]);
  const hits = await traps.pageText();
  expect(hits, `error text appeared in the page:\n${hits.join("\n")}`).toEqual([]);
  await expect(page.getByText("No model to display")).toHaveCount(0);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

/** The rendered editor line whose text contains `text` (lines are addressed
 * by content, not index: CodeMirror only renders the lines in view). */
const line = (page: Page, text: string) =>
  page.locator(".cm-line").filter({ hasText: text }).first();

async function lineStart(page: Page, text: string, inset = 4) {
  const box = await line(page, text).boundingBox();
  if (!box) throw new Error(`no editor line containing ${JSON.stringify(text)}`);
  return { x: box.x + inset, y: box.y + box.height / 2 };
}

async function lineEnd(page: Page, text: string) {
  const box = await line(page, text).boundingBox();
  if (!box) throw new Error(`no editor line containing ${JSON.stringify(text)}`);
  return { x: box.x + box.width - 4, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 25 });
  await page.mouse.up();
}

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test("drag-selecting text, forwards and backwards, raises nothing (#1094)", async ({ page }) => {
  test.setTimeout(120_000);
  await openModel(page, scratchModel());
  const traps = await armTraps(page);

  // Forwards: from the first mechanism's line down across the projection.
  await drag(page, await lineStart(page, "sender_mech = pnl"), await lineEnd(page, "name='sender_to_receiver'"));
  expect((await selectedText(page)).length).toBeGreaterThan(100);
  await expectClean(page, traps);

  // Backwards: from inside the composition block up to the imports.
  await drag(page, await lineEnd(page, "add_node(sender_mech)"), await lineStart(page, "import psyneulink as pnl"));
  expect((await selectedText(page)).length).toBeGreaterThan(100);
  await expectClean(page, traps);

  // Click to drop the selection; the cursor lands on a declaration.
  const decl = await lineStart(page, "receiver_mech = pnl", 30);
  await page.mouse.click(decl.x, decl.y);
  await expectClean(page, traps);
});

test("dragging a selection to move it raises nothing (#1094)", async ({ page }) => {
  test.setTimeout(120_000);
  await openModel(page, scratchModel());
  const traps = await armTraps(page);

  // Select the whole "# Mechanisms" banner line: a comment, so moving it
  // leaves the Python valid.
  const banner = "# Mechanisms";
  await drag(page, await lineStart(page, banner, 1), await lineEnd(page, banner));
  expect((await selectedText(page)).trim()).toBe(banner);

  // Now pick the selection up and drop it on the last line of the document.
  await drag(page, await lineStart(page, banner, 40), await lineEnd(page, "add_projection(sender_to_receiver)"));
  await expectClean(page, traps);

  // Whether the browser moved the text or merely moved the caret, the
  // document still holds the banner exactly once.
  const text = await editor(page).innerText();
  expect(text.split("# Mechanisms").length - 1).toBe(1);
});

test("dragging a selection out onto the canvas raises nothing (#1094)", async ({ page }) => {
  test.setTimeout(120_000);
  await openModel(page, scratchModel());
  const traps = await armTraps(page);

  await drag(page, await lineStart(page, "sender_mech = pnl"), await lineEnd(page, "receiver_mech = pnl"));
  expect((await selectedText(page)).length).toBeGreaterThan(50);

  const target = await canvas(page).boundingBox();
  if (!target) throw new Error("no canvas");
  await drag(
    page,
    await lineStart(page, "sender_mech = pnl", 40),
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  );
  await expectClean(page, traps);
});
