/**
 * The "Watching for changes" status sits in the diagnostics bar, explains
 * itself, and does something when clicked (#103).
 *
 * In 0.6.6-rc2 it took a whole row above the graph, its meaning was a guess,
 * and clicking it did nothing. Now: no row of its own, a tooltip that says
 * what it means, and a click opens a popover with the watched file, when it
 * last changed outside PsyNeuView, and a switch to pause watching.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

const WITH_EXTRA = BASE.replace(
  "two_mech_projection.add_projection(sender_to_receiver)",
  [
    "extra_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='extra_mech')",
    "two_mech_projection.add_projection(sender_to_receiver)",
    "two_mech_projection.add_node(extra_mech)",
  ].join("\n"),
);

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "watch103-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function openFromPath(page: any, model: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: /^Skip$/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

test.describe("Watching-for-changes status (#103)", { tag: "@ci" }, () => {
  test("lives in the diagnostics bar, explains itself, and opens a popover", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const model = scratchModel();
    await openFromPath(page, model);

    const indicator = page.getByTestId("sync-indicator");
    await expect(indicator).toHaveAttribute("data-sync-kind", "watching", { timeout: 30_000 });

    // No row of its own: it is inside the diagnostics bar, and nothing sits
    // between that bar and the panes below.
    const bar = page.locator(".diagnostics-collapsed-bar");
    await expect(bar.getByTestId("sync-indicator")).toBeVisible();
    await expect(page.getByText("Watching for changes")).toHaveCount(1);
    const barBox = (await bar.boundingBox())!;
    const paneBox = (await page.getByTestId("code-editor-pane").boundingBox())!;
    expect(paneBox.y - (barBox.y + barBox.height)).toBeLessThan(4);

    // The tooltip says what it means.
    const title = await indicator.getAttribute("title");
    expect(title).toMatch(/PsyNeuView is watching this file/);
    expect(title).toMatch(/Edits made outside PsyNeuView appear here automatically/);

    // A click opens the popover with the file path, and does not expand the bar.
    await indicator.click();
    const popover = page.getByTestId("sync-popover");
    await expect(popover).toBeVisible();
    await expect(page.getByTestId("sync-popover-path")).toHaveText(model);
    await expect(page.getByTestId("sync-popover-last-change")).toHaveText(/Not since you opened it/);
    await expect(bar).toBeVisible();

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });

  test("pausing stops outside edits; resuming catches up", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);

    const indicator = page.getByTestId("sync-indicator");
    await expect(indicator).toHaveAttribute("data-sync-kind", "watching", { timeout: 30_000 });
    await indicator.click();
    await page.getByTestId("sync-pause-toggle").uncheck();
    await expect(indicator).toHaveAttribute("data-sync-kind", "paused");
    await expect(indicator).toHaveText(/Watching paused/);

    writeFileSync(model, WITH_EXTRA);
    // Longer than the watcher's settle time: a live watch would have applied it.
    await page.waitForTimeout(2500);
    await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toHaveCount(0);

    await page.getByTestId("sync-pause-toggle").check();
    await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("sync-popover-last-change")).not.toHaveText(/Not since you opened it/);
  });
});
