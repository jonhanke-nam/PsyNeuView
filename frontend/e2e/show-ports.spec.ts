/**
 * Show ports (#112): ports are hidden by default, and the graph toolbar's one
 * Ports switch shows both the port dots on the graph and the Components
 * panel's Ports section. The choice is remembered across a reload.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_with_lc.py");
const SHOTS = process.env.PNV_SHOT_DIR;

async function openModel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 30000 });
}

test.describe("Show ports (#112)", { tag: "@ci" }, () => {
  test("off by default; one switch shows ports on the graph and in Components; remembered", async ({ page }) => {
    // The Components panel open and full width, so its sections show by name.
    await page.addInitScript(() => {
      localStorage.setItem("psynewview_palette_compact", "false");
      localStorage.setItem("psynewview_palette_open", "true");
    });
    await page.goto("/");
    await openModel(page);
    const sidebar = page.getByTestId("palette-sidebar");
    const portsSection = sidebar.getByText(/^\W*ports$/i);
    const toggle = page.getByTestId("toolbar-show-ports");

    // Default: off — no port dots drawn, no Ports section.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("edge-port-dot")).toHaveCount(0);
    await expect(sidebar.getByText(/^\W*mechanisms$/i)).toBeVisible();
    await expect(portsSection).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "1-ports-off.png") });

    // One switch turns both on.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edge-port-dot")).not.toHaveCount(0);
    await expect(portsSection).toBeVisible();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "2-ports-on.png") });

    // Remembered across a reload.
    await page.reload();
    await openModel(page);
    await expect(page.getByTestId("toolbar-show-ports")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edge-port-dot")).not.toHaveCount(0);
    await expect(page.getByTestId("palette-sidebar").getByText(/^\W*ports$/i)).toBeVisible();
  });
});
