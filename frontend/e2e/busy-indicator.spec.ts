/**
 * The spinning wheel of patience (#38): anything slower than 0.2 s shows it
 * in the toolbar and over the graph, with a "progress" pointer; anything
 * quicker shows nothing; covers a save and an undo.
 *
 * Each slow request is made slow on purpose with page.route. Screenshots
 * land in `$SHOTS_DIR` when it is set.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const EDITED = BASE + "# an edit for the busy wheel\n";

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "busy38-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function replaceBuffer(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/** Hold every matching request for `ms` before letting it through. */
async function slowDown(page: Page, pattern: string, ms: number) {
  await page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Watch the toolbar wheel from inside the page: when it first showed, and how often. */
async function watchWheel(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __busySeen: number[] };
    w.__busySeen = [];
    new MutationObserver(() => {
      if (document.querySelector("[data-testid=busy-indicator][data-visible=true]")) w.__busySeen.push(performance.now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-visible"] });
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __busySeen: number[] }).__busySeen.length);

test.describe("Busy wheel (#38)", { tag: "@ci" }, () => {
  test("a slow save shows the wheel after 0.2 s and clears it; a fast request never does", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    const wheel = page.getByTestId("busy-indicator");
    await expect(wheel).toHaveAttribute("role", "status");
    await expect(wheel).toHaveAttribute("data-visible", "false");

    // A fast user request: nothing shows.
    await watchWheel(page);
    const before = await seen(page);
    await page.evaluate(() => fetch("/api/models/dirs").then((r) => r.text()));
    await page.waitForTimeout(400);
    expect(await seen(page)).toBe(before);

    // A slow save: nothing at first, then the wheel, the label and the pointer.
    await replaceBuffer(page, EDITED);
    await slowDown(page, "**/api/model/save-source", 2_500);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    const t0 = Date.now();
    await save.click();
    await expect(wheel).toHaveAttribute("data-visible", "true");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    await expect(page.getByTestId("busy-indicator-canvas")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/pnv-busy/);
    await shot(page, "01-save-busy");

    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-indicator-canvas")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/pnv-busy/);
    await expect.poll(() => readFileSync(model, "utf8")).toBe(EDITED);
  });

  test("a slow undo shows the wheel and clears it", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, EDITED);
    await expect(page.getByTestId("undo-button")).toBeEnabled();

    await slowDown(page, "**/api/model/**", 2_000);
    await page.getByTestId("undo-button").click();
    const wheel = page.getByTestId("busy-indicator");
    await expect(wheel).toHaveAttribute("data-visible", "true");
    await expect(page.getByTestId("busy-indicator-canvas")).toBeVisible();
    await shot(page, "02-undo-busy");
    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-indicator-canvas")).toHaveCount(0);
  });
});
