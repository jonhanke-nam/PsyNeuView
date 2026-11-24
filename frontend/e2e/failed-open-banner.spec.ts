/**
 * A failed open is marked on the canvas, not only in a message (#401).
 *
 * Opening a file that isn't there opens nothing, so the model that was open
 * (Stroop here) stays on screen with its title. A banner over the graph says
 * so: "Couldn't open X: reason. Still showing Y.", with Try again and Dismiss.
 * Stroop stays open and usable under it, Try again asks for the same file
 * again (and opens it once it exists), and the × and Escape put it away.
 * The banner is a strip above the canvas, so it covers no node, and the graph
 * is fitted to the smaller canvas so no node is cut off either.
 */
import { mutatingTest as test, expect } from "./test-base";
import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { fixturePath } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STROOP = path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_basic.py");

type Box = { x: number; y: number; width: number; height: number };

/**
 * Nodes the banner overlaps, and nodes not wholly inside the canvas: both must
 * be none, so nothing on the graph is hidden while the banner is up.
 */
async function hiddenNodes(page: Page): Promise<{ underBanner: string[]; cutOff: string[] }> {
  const banner = (await page.getByTestId("failed-open-banner").boundingBox()) as Box;
  const canvas = (await page.getByTestId("graph-canvas-viewport").boundingBox()) as Box;
  const nodes = page.getByTestId("graph-canvas").locator(".react-flow__node");
  const underBanner: string[] = [];
  const cutOff: string[] = [];
  for (let i = 0; i < (await nodes.count()); i++) {
    const n = nodes.nth(i);
    const id = (await n.getAttribute("data-id")) ?? `#${i}`;
    const b = (await n.boundingBox()) as Box;
    const overlaps =
      b.x < banner.x + banner.width && banner.x < b.x + b.width && b.y < banner.y + banner.height && banner.y < b.y + b.height;
    if (overlaps) underBanner.push(id);
    const inside =
      b.x >= canvas.x - 1 && b.y >= canvas.y - 1 &&
      b.x + b.width <= canvas.x + canvas.width + 1 && b.y + b.height <= canvas.y + canvas.height + 1;
    if (!inside) cutOff.push(id);
  }
  return { underBanner, cutOff };
}

async function openFromPath(page: Page, file: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
}

/**
 * Stroop's title, graph and code. Selecting a node scrolls the editor to its
 * line, so after that the code is checked by that line rather than the header.
 */
async function expectStroopOpen(page: Page, code = "Model: stroop_basic") {
  const canvas = page.getByTestId("graph-canvas");
  await expect(page.getByTestId("model-name")).toContainText("stroop_model", { timeout: 60_000 });
  await expect(canvas.locator('.react-flow__node[data-id="color_input"]')).toBeVisible();
  await expect(canvas.locator('.react-flow__node[data-id="decision"]')).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(code);
}

test.describe("a failed open is marked on the canvas (#401)", () => {
  test("names both files, keeps Stroop open and usable, and Try again re-attempts", { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(120_000);
    // A path that doesn't exist yet; the test puts a model there before the last Try again.
    const missing = path.join(mkdtempSync(path.join(tmpdir(), "failed-open-401-")), "not_there_yet.py");
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/model/load") && (r.postData() ?? "").includes("not_there_yet.py")) asked.push(r.url());
    });

    await page.goto("/");
    await openFromPath(page, STROOP);
    await expectStroopOpen(page);

    await openFromPath(page, missing);
    const banner = page.getByTestId("failed-open-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    const message = banner.getByTestId("failed-open-message");
    await expect(message).toContainText("Couldn't open not_there_yet.py:");
    await expect(message).toContainText("Still showing stroop_reference_basic.py.");
    expect(asked).toHaveLength(1);

    // The banner covers no node, and every node is still wholly in view: the
    // canvas gives up the banner's height and the graph is fitted to the rest.
    await expect.poll(() => hiddenNodes(page), { timeout: 10_000 }).toEqual({ underBanner: [], cutOff: [] });

    // Stroop is still the open model: its title, graph and code, and it still
    // answers a click while the banner is up.
    await expectStroopOpen(page);
    const decision = page.getByTestId("graph-canvas").locator('.react-flow__node[data-id="decision"]');
    await decision.click();
    await expect(decision).toHaveClass(/selected/);
    const DECISION_LINE = "name='decision'";

    // Try again asks for the same file again; still missing, so the banner returns.
    await banner.getByTestId("failed-open-retry").click();
    await expect.poll(() => asked.length).toBe(2);
    await expect(banner).toBeVisible();
    await expect(message).toContainText("Couldn't open not_there_yet.py:");
    await expectStroopOpen(page, DECISION_LINE);

    // The × puts it away; Stroop stays.
    await banner.getByTestId("failed-open-dismiss").click();
    await expect(banner).toHaveCount(0);
    await expectStroopOpen(page, DECISION_LINE);

    // So does Escape.
    await openFromPath(page, missing);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(banner).toHaveCount(0);
    await expectStroopOpen(page, DECISION_LINE);

    // Once the file is there, Try again opens it, and the banner goes.
    await openFromPath(page, missing);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    copyFileSync(fixturePath("two_mech_projection"), missing);
    await banner.getByTestId("failed-open-retry").click();
    await expect(page.locator(".cm-content")).not.toContainText("Model: stroop_basic", { timeout: 60_000 });
    await expect(page.getByTestId("graph-canvas").locator('.react-flow__node[data-id="color_input"]')).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });
});
