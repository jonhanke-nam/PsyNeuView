/**
 * Clicking a graph-condition row selects its dashed edge (#1370).
 *
 * One condition draws one edge per target node, so since #651 an edge's id
 * names both endpoints (`gsc_<id>_<source>__<target>`). The Inspector's and
 * the Scheduler tab's rows still selected `gsc_<id>`, which no edge has, so a
 * click selected nothing. They now look the edge up.
 *
 * Uses the AfterNodes(A, B, C) on TARGET fixture from gsc-edge-ids.spec.ts:
 * one condition, three edges into TARGET.
 *
 * Screenshots land in `$SHOTS_DIR` when it is set.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "fixtures", "gsc_afternodes.py");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gscrow1370-"));
  const file = path.join(dir, "gsc_afternodes.py");
  copyFileSync(FIXTURE, file);
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
  await expect(page.locator('.react-flow__node[data-id="TARGET"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("gsc-edge-badge")).toHaveCount(3, { timeout: 30_000 });
  // The graph-condition legend floats over the canvas; it is not under test.
  // It opens collapsed by default (#7); hide it only if it was opened.
  const legendHide = page.getByTestId("gsc-legend-hide");
  if (await legendHide.isVisible().catch(() => false)) await legendHide.click();
}

/** Select a node by its top edge: an edge's badge can sit over its middle. */
async function selectNode(page: Page, id: string) {
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);
  const box = await node.boundingBox();
  await node.click({ position: { x: (box?.width ?? 40) / 2, y: 10 } });
}

const inspector = (page: Page) => page.getByTestId("panel-inspector");
const selectedBadges = (page: Page) => page.locator('[data-testid="gsc-edge-badge"][data-selected="true"]');

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("A graph-condition row selects its edge (#1370)", { tag: "@ci" }, () => {
  test("the owner's row in the Inspector selects the condition's edge", async ({ page }) => {
    test.setTimeout(180_000);
    await openFromPath(page, scratchModel());

    await selectNode(page, "TARGET");
    const row = inspector(page).getByText("→ A, B, C");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(selectedBadges(page)).toHaveCount(0);
    await shot(page, "04-1370-before-row-click");

    await row.click();

    await expect(selectedBadges(page)).toHaveCount(1);
    await expect(selectedBadges(page)).toHaveAttribute("data-edge-id", /^gsc_.+__TARGET$/);
    await expect(inspector(page).getByText("Scheduling Condition")).toBeVisible();
    await shot(page, "05-1370-row-clicked-edge-selected");
  });

  test("a target's row selects the edge from that target", async ({ page }) => {
    test.setTimeout(180_000);
    await openFromPath(page, scratchModel());

    await selectNode(page, "B");
    const row = inspector(page).getByText("TARGET →");
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.click();

    await expect(selectedBadges(page)).toHaveCount(1);
    await expect(selectedBadges(page)).toHaveAttribute("data-edge-id", /_B__TARGET$/);
  });

  test("the Scheduler tab's row selects the condition's edge", async ({ page }) => {
    test.setTimeout(180_000);
    await openFromPath(page, scratchModel());

    await page.getByRole("button", { name: "Scheduler", exact: true }).click();
    const row = page.getByTestId("panel-scheduler").getByTitle("Click to inspect AfterNodes");
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.click();

    await expect(selectedBadges(page)).toHaveCount(1);
    await expect(selectedBadges(page)).toHaveAttribute("data-edge-id", /^gsc_.+__TARGET$/);
  });
});
