/**
 * Dragging a function from the Components panel onto a mechanism sets its
 * function=, as picking it up and clicking the mechanism does (#354, #348):
 * the same glow on the mechanisms that can take it, the same reasons on those
 * that can't, one Undo step. Dropped on empty canvas, nothing is written.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

function scratchStroop(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "drag-fn-354-"));
  const file = path.join(dir, "stroop_basic.py");
  writeFileSync(file, readFileSync(path.resolve(import.meta.dirname, "../../backend/demos/stroop_basic.py"), "utf8"));
  return file;
}

async function open(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id="decision"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("palette-sidebar")).toBeVisible();
  await page.locator(".react-flow__controls-fitview").click();
  await expect(page.locator('.react-flow__node[data-id="decision"]')).toBeInViewport();
}

async function paletteItem(page: Page, type: string): Promise<Locator> {
  await page.getByPlaceholder("Search components…").fill(type);
  const el = page.locator(`[data-testid="palette-item"][data-type="${type}"]`).first();
  await expect(el).toBeVisible();
  return el;
}

/** Start dragging `item`, and leave the pointer over (x, y) without dropping. */
async function dragOver(page: Page, item: Locator, x: number, y: number) {
  await item.hover();
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}

/** Clear the notices, which stack over the top right of the graph, where decision is. */
async function dismissNotices(page: Page) {
  const close = page.getByTestId("notification-dismiss");
  while ((await close.count()) > 0) await close.first().click();
}

async function centre(loc: Locator) {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The class in `decision = pnl.DDM(... function=pnl.X(...) ...)`, or null for the default. */
function decisionFunction(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const decl = src.slice(src.indexOf("decision = pnl.DDM("));
  const end = decl.indexOf("\n)");
  const m = decl.slice(0, end).match(/function\s*=\s*pnl\.(\w+)/);
  return m ? m[1] : null;
}

test.describe("drag a function onto a mechanism (#354)", { tag: "@ci" }, () => {
  test("empty canvas writes nothing; the DDM refuses Logistic; DriftDiffusionIntegrator goes onto decision; one Undo", async ({ page }) => {
    const file = scratchStroop();
    const original = readFileSync(file, "utf8");
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/model/structural-change")) writes.push(r.postData() ?? "");
    });
    await open(page, file);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const emptyX = pane.x + pane.width * 0.95;
    const emptyY = pane.y + pane.height * 0.5;

    // While Logistic is dragged, the mechanisms that can take it glow and
    // the DDM is marked as one that can't.
    await dragOver(page, await paletteItem(page, "Logistic"), emptyX, emptyY);
    await expect(page.locator('.react-flow__node[data-id="color_input"] [data-function-target="valid"]')).toHaveClass(/pnv-connect-target/);
    await expect(page.locator('.react-flow__node[data-id="decision"] [data-function-target="invalid"]')).toBeVisible();

    // Dropped on empty canvas: the message, and nothing written.
    await page.mouse.up();
    await expect(page.getByTestId("notification-message").filter({ hasText: "A function belongs to a mechanism." })).toBeVisible();
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
    // The drag is over: nothing glows.
    await expect(page.locator("[data-function-target]")).toHaveCount(0);
    await dismissNotices(page);

    // Dropped on the DDM: the reason it can't, and nothing written.
    const decision = page.locator('.react-flow__node[data-id="decision"]');
    let at = await centre(decision);
    await dragOver(page, await paletteItem(page, "Logistic"), at.x, at.y);
    await page.mouse.up();
    await expect(page.getByTestId("notification-message").filter({ hasText: "can't use Logistic" })).toBeVisible();
    expect(readFileSync(file, "utf8")).toBe(original);
    await dismissNotices(page);

    // Dropped on decision, a function it can take: its function= changes.
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/update-function-type") && r.ok());
    at = await centre(decision);
    await dragOver(page, await paletteItem(page, "DriftDiffusionIntegrator"), at.x, at.y);
    await expect(page.locator('.react-flow__node[data-id="decision"] [data-function-target="valid"]')).toHaveClass(/pnv-connect-target/);
    await page.mouse.up();
    await done;
    await expect(page.getByTestId("notification-message").filter({ hasText: "decision now uses DriftDiffusionIntegrator" })).toBeVisible();
    await expect.poll(() => decisionFunction(file)).toBe("DriftDiffusionIntegrator");
    expect(writes).toEqual([]);

    // The Inspector shows it.
    await decision.click();
    await expect(page.locator('select[title^="Change function class"]')).toHaveValue("DriftDiffusionIntegrator");

    // One Undo step puts it back.
    await page.getByTestId("undo-button").click();
    await expect(page.locator('select[title^="Change function class"]')).toHaveValue("DriftDiffusionAnalytical");
    await expect(page.locator(".cm-content")).not.toContainText("DriftDiffusionIntegrator");
  });
});
