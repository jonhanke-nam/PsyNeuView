/**
 * A code edit that doesn't build shows the stale-graph banner (#1367).
 *
 * The banner ("Showing the last version that built", with Compare with that
 * version) is for a graph that is not the code. A syntax error already held
 * the graph with it. A line that parses but fails when it runs did not: the
 * backend skips the statement and builds the rest (#615), so the canvas
 * rebuilt without what you had just typed, and nothing said so but a calm
 * "module-level driver" notice in the collapsed diagnostics bar.
 *
 *   - a syntax error typed in the editor: banner, comparison, file untouched;
 *     fixed, the banner goes;
 *   - a line that runs into an undefined name, typed key by key as a person
 *     would: the same banner, naming the error and its line;
 *   - fast typing: one preview after the pause, and no banner flashing for
 *     the half-typed states on the way.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const BROKEN = `${BASE}\nthis is not python (\n`;

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "preview1367-"));
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

/** Check, every quarter second for `ms`, that something stays true. */
async function holdsFor(page: Page, ms: number, check: () => Promise<void>) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await check();
    await page.waitForTimeout(250);
  }
  await check();
}

async function typeAtLine(page: Page, lineText: string, text: string) {
  // Click the line, then Home: a click lands wherever the line wraps.
  await page.locator(".cm-line", { hasText: lineText }).first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type(text, { delay: 40 });
}

async function replaceBuffer(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test("a syntax error typed in the editor shows the stale-graph banner (#1367)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openFromPath(page, model);
  const banner = page.getByText("Showing the last version that built.");
  await expect(banner).toHaveCount(0);
  await shot(page, "01-1367-before-syntax-error");

  await replaceBuffer(page, BROKEN);

  // The preview fails; the graph is held, and now it says so.
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const compare = page.getByRole("button", { name: "Compare with that version" });
  await expect(compare).toBeVisible();
  await shot(page, "02-1367-banner-after-syntax-error");

  // The comparison is against the code that built: the broken line is new.
  await compare.click();
  const diff = page.getByTestId("last-good-diff");
  await expect(diff).toBeVisible();
  await expect(diff.getByTestId("line-diff")).toContainText("this is not python (");
  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);

  // Typing never writes the file, banner or not.
  expect(readFileSync(model, "utf8")).toBe(BASE);

  // Fixed again: the code builds, and the banner goes.
  await replaceBuffer(page, `${BASE}# fixed\n`);
  await expect(banner).toHaveCount(0, { timeout: 60_000 });
  expect(readFileSync(model, "utf8")).toBe(BASE);
});

test("a typed line that fails when it runs shows the same banner (#1367)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openFromPath(page, model);
  const banner = page.getByText("Showing the last version that built.");

  // Parses, fails at run time: the backend skips it and builds the rest,
  // which used to replace the graph silently.
  await typeAtLine(page, "sender_mech = pnl.TransferMechanism", "gain = not_defined_yet\n");

  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("name 'not_defined_yet' is not defined (line 15)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare with that version" })).toBeVisible();
  await expect(page.getByText("sync error")).toBeVisible();
  expect(readFileSync(model, "utf8")).toBe(BASE);

  await shot(page, "03-1367-banner-after-run-time-error");

  // Fixed: it builds, and the banner goes.
  await replaceBuffer(page, BASE + "# fixed\n");
  await expect(banner).toHaveCount(0, { timeout: 60_000 });
});

test("fast typing previews once, after the pause, with no banner on the way (#1367)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openFromPath(page, model);
  const banner = page.getByText("Showing the last version that built.");
  let previews = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/model/preview")) previews += 1;
  });

  // Half-typed, this line is broken most of the way ("extra = pnl.Tra" is an
  // AttributeError); finished, it builds.
  await typeAtLine(page, "sender_mech = pnl.TransferMechanism", "extra = pnl.TransferMechanism(name='extra')\n");

  await expect.poll(() => previews, { timeout: 30_000 }).toBe(1);
  await expect(page.getByText("synced")).toBeVisible({ timeout: 60_000 });
  await holdsFor(page, 3_000, async () => {
    await expect(banner).toHaveCount(0);
    expect(previews).toBe(1);
  });
});
