/**
 * However a model is opened, it shows in the view the view menu names (#428).
 *
 * Opened from the Open menu's Reference Models section, EGO showed its EM
 * composition folded while the view menu read "Flatten (all compositions)",
 * and EM's Expand reloaded the model but left it folded. That open (with the
 * demo, PsyNeuLink example, project and upload opens) did not send the view,
 * so the backend built the model nested, its default; and Expand, reading only
 * the settings, took the press for a fold, since a flattened view has nothing
 * folded in it.
 *
 * Each route here opens EGO and checks that EM is open in the flattened view,
 * then, in the nested view, that EM is folded and Expand opens it:
 * the Reference Models section, the PsyNeuLink Library, the Recent list, and
 * Open from path.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");
const EGO_LABEL = "EGO — Giallanza et al. 2024 (Study 2)";

const loaded = (page: Page) =>
  page.waitForResponse(
    (r) => /\/api\/(model\/load|reference-models\/load)/.test(r.url()) && r.request().method() === "POST",
    { timeout: 60_000 },
  );

const openMenu = (page: Page) => page.getByTestId("open-menu").click();
const menuList = (page: Page) => page.getByTestId("open-menu-list");

/** The view menu: Flatten (all compositions), PyTorch, the compositions. */
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

const canvas = (page: Page) => page.getByTestId("graph-canvas");
/** EM drawn as a frame, open, with its members inside. */
const emFrame = (page: Page) =>
  canvas(page).locator('.react-flow__node-compositionNode[data-id="EM"], .react-flow__node-compositionNode[data-id="cluster::EM"]');
/** EM folded to a single node. */
const emFolded = (page: Page) => canvas(page).locator('.react-flow__node-mechanismNode[data-id="EM"]');
const emMember = (page: Page) => canvas(page).getByText("COMBINED SCORES", { exact: true });

type Route = (page: Page) => Promise<void>;

const ROUTES: Record<string, Route> = {
  "the Reference Models section": async (page) => {
    await openMenu(page);
    await Promise.all([loaded(page), menuList(page).getByText(EGO_LABEL, { exact: true }).first().click()]);
  },
  "the PsyNeuLink Library": async (page) => {
    await openMenu(page);
    await Promise.all([
      loaded(page),
      menuList(page).locator('button[title$="library/models/Giallanza2024_EGO_Study2.py"]').first().click(),
    ]);
  },
  "the Recent list": async (page) => {
    // Opened once from its path, then something else, so EGO is in Recent.
    await ROUTES["Open from path"](page);
    await openPath(page, path.resolve(__dirname, "..", "..", "backend", "reference_models", "stroop_reference_basic.py"));
    await openMenu(page);
    await expect(page.getByTestId("open-menu-section-recent")).toBeVisible();
    // The bundled catalog lists the same file higher up; Recent is the last.
    await Promise.all([loaded(page), menuList(page).locator(`button[title="${EGO}"]`).last().click()]);
  },
  "Open from path": async (page) => openPath(page, EGO),
};

async function openPath(page: Page, file: string) {
  await openMenu(page);
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page), prompt.press("Enter")]);
}

/** EM is open in the flattened view, as the view menu says. */
async function expectFlattenedAndOpen(page: Page) {
  await expect(viewMenu(page)).toHaveValue("__flat__", { timeout: 60_000 });
  await expect(emFrame(page)).toBeVisible({ timeout: 60_000 });
  await expect(emMember(page)).toBeVisible();
  await expect(emFolded(page)).toHaveCount(0);
}

test.describe("every open route shows EGO in the view menu's view (#428)", { tag: "@ci" }, () => {
  for (const [name, open] of Object.entries(ROUTES)) {
    test(`from ${name}: EM open when flattened; folded when nested, and Expand opens it`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto("/");
      await closePalette(page);

      await open(page);
      await expectFlattenedAndOpen(page);

      // The nested view folds EM on first sight (#395), and says so.
      const menu = viewMenu(page);
      const nested = await menu.locator("option").filter({ hasText: /^EGO$/ }).first().getAttribute("value");
      await Promise.all([loaded(page), menu.selectOption(nested!)]);
      await expect(emFolded(page)).toBeVisible({ timeout: 60_000 });
      await expect(emMember(page)).toHaveCount(0);

      // Expand opens it, and the view stays nested.
      const expand = canvas(page).getByRole("button", { name: /^Expand composition EM$/ }).first();
      await Promise.all([loaded(page), expand.click()]);
      await expect(emFrame(page)).toBeVisible({ timeout: 60_000 });
      await expect(emMember(page)).toBeVisible();
      await expect(emFolded(page)).toHaveCount(0);
      await expect(menu).toHaveValue(nested!);

      // Opened again the same way, in the nested view: still nested, as the menu says.
      await open(page);
      await expect(menu).toHaveValue(nested!, { timeout: 60_000 });
      await expect(emFrame(page).or(emFolded(page))).toBeVisible({ timeout: 60_000 });
      if (await emFolded(page).isVisible()) await expect(emMember(page)).toHaveCount(0);
      else await expect(emMember(page)).toBeVisible();
    });
  }
});
