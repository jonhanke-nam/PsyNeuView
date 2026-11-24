/**
 * A function picked up in the Components panel goes onto a mechanism, as its
 * function= (#348). It is never written into the code by itself: placing one
 * on empty canvas used to write `x = pnl.DualAdaptiveIntegrator(name=...)`,
 * which broke the model (#349).
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

function scratchStroop(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "place-fn-348-"));
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
  // The whole graph in view, decision included.
  await page.locator(".react-flow__controls-fitview").click();
  await expect(page.locator('.react-flow__node[data-id="decision"]')).toBeInViewport();
}

async function pickUp(page: Page, type: string) {
  await page.getByPlaceholder("Search components…").fill(type);
  const el = page.locator(`[data-testid="palette-item"][data-type="${type}"]`).first();
  await expect(el).toBeVisible();
  await el.click();
  await expect(page.getByTestId("place-component-hint")).toContainText("Click a mechanism to give it this function");
}

/** The class in `decision = pnl.DDM(... function=pnl.X(...) ...)`, or null for the default. */
function decisionFunction(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const decl = src.slice(src.indexOf("decision = pnl.DDM("));
  const end = decl.indexOf("\n)");
  const m = decl.slice(0, end).match(/function\s*=\s*pnl\.(\w+)/);
  return m ? m[1] : null;
}

test.describe("a function goes onto a mechanism (#348, #349)", { tag: "@ci" }, () => {
  test("empty canvas: a message, the pick stays, nothing is written; decision: its function changes; Undo puts it back", async ({ page }) => {
    const file = scratchStroop();
    const original = readFileSync(file, "utf8");
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/model/structural-change")) writes.push(r.postData() ?? "");
    });
    await open(page, file);

    // Logistic: the processing mechanisms can take it and glow; the DDM can't.
    await pickUp(page, "Logistic");
    await expect(page.locator('.react-flow__node[data-id="color_input"] [data-function-target="valid"]')).toHaveClass(/pnv-connect-target/);
    const ddm = page.locator('.react-flow__node[data-id="decision"] [data-function-target="invalid"]');
    await expect(ddm).toBeVisible();
    await expect(ddm).toHaveCSS("cursor", "not-allowed");

    // Empty canvas: nothing added, a clear message, still picked up.
    // Right of the graph, clear of the Components panel over the pane's left.
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.click(pane.x + pane.width * 0.95, pane.y + pane.height * 0.5);
    await expect(page.getByTestId("notification-message").filter({ hasText: "A function belongs to a mechanism." })).toHaveText(
      "A function belongs to a mechanism. Click one of the highlighted mechanisms, or press Esc.",
    );
    await expect(page.getByTestId("place-component-hint")).toBeVisible();
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);

    // The DDM refuses Logistic and says why; nothing changes.
    await ddm.click();
    await expect(page.getByTestId("notification-message").filter({ hasText: "can't use Logistic" })).toBeVisible();
    expect(readFileSync(file, "utf8")).toBe(original);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);

    // A function the DDM can take: decision's function= changes in the code.
    await pickUp(page, "DriftDiffusionIntegrator");
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/update-function-type") && r.ok());
    await page.locator('.react-flow__node[data-id="decision"] [data-function-target="valid"]').click();
    await done;
    await expect(page.getByTestId("notification-message").filter({ hasText: "decision now uses DriftDiffusionIntegrator" })).toBeVisible();
    await expect.poll(() => decisionFunction(file)).toBe("DriftDiffusionIntegrator");
    expect(writes).toEqual([]);
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);

    // The Inspector shows it.
    await page.locator('.react-flow__node[data-id="decision"]').click();
    await expect(page.locator('select[title^="Change function class"]')).toHaveValue("DriftDiffusionIntegrator");

    // One Undo step puts it back, in the code and the Inspector. (Undo
    // restores the code in the editor; the file is written on Save.)
    await page.getByTestId("undo-button").click();
    await expect(page.locator('select[title^="Change function class"]')).toHaveValue("DriftDiffusionAnalytical");
    await expect(page.locator(".cm-content")).toContainText("name='decision'");
    await expect(page.locator(".cm-content")).not.toContainText("DriftDiffusionIntegrator");
  });
});
