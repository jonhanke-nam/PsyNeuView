/**
 * Tutorial capture + verification — "Configuring the PsyNeuLink source" (#670).
 *
 * Settings (⚙) shows which PsyNeuLink build is active — one line in About,
 * in full in Developer ▸ PsyNeuLink details — and lets you change it, in
 * Developer ▸ Which PsyNeuLink is installed (#1290, #1295). This spec opens
 * both and verifies the readout and the
 * "Change install" control are present. The form starts on what is installed,
 * so there is nothing to apply and no "Apply & restart" button (#1303): a
 * quiet "In use now" line stands in its place. Nothing is reinstalled.
 *
 * Read-only.
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/source-config",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1400, height: 1000 } });

test.describe("Tutorial: Configuring the PsyNeuLink source", () => {
  test("Settings shows the active source in About, and a Change install control in Developer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    // About: which PsyNeuLink is active, in one line.
    await page.getByTestId("settings-section-about").click();
    await expect(page.getByText(/^PsyNeuLink \d/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/PsyNeuView version/)).toBeVisible();

    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("01-settings.png") });

    // Developer: the control to switch sources (we don't apply it here), and
    // the full readout under PsyNeuLink details.
    await page.getByTestId("settings-section-developer").click();
    await expect(page.getByText("Change install")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("install-in-use")).toContainText("In use now:");
    await expect(page.getByTestId("install-apply")).toHaveCount(0);
    await expect(page.getByText("Currently installed")).toBeVisible();

    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("02-developer.png") });
  });
});
