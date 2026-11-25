/**
 * The toolbar always says which model is open, as the menu names it (#422).
 *
 * Every Reference Model opened from the Open menu shows its exact menu label
 * on the title's first line and its file name on the second, tagged
 * "Reference"; the window title is the label. A PsyNeuLink Library model is
 * tagged "Library" and, being the same model as a Reference Model, carries
 * that model's label; a user's own file is named by its file, with its
 * folder, tagged "Your file". The model card has everything in full.
 */
import { copyFileSync, mkdirSync } from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";

interface Ref { name: string; label: string }

async function openMenu(page: Page) {
  if (!(await page.getByTestId("open-menu-list").isVisible())) await page.getByTestId("open-menu").click();
}

async function openByPath(page: Page, file: string) {
  await openMenu(page);
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 3000 }).catch(() => {});
}

async function expectTitle(page: Page, label: string, second: { file?: string; folder?: string }, tag: string) {
  await expect(page.getByTestId("model-title-label")).toHaveText(label, { timeout: 90_000 });
  if (second.file) await expect(page.getByTestId("model-title-file")).toHaveText(second.file);
  if (second.folder) await expect(page.getByTestId("model-title-folder")).toContainText(second.folder);
  await expect(page.getByTestId("model-title-source")).toHaveText(tag);
}

test.describe("which model is open (#422)", { tag: "@ci" }, () => {
  test.beforeEach(async ({ page }) => {
    // Wide enough that no label is shortened.
    await page.setViewportSize({ width: 1920, height: 900 });
  });

  test("every Reference Model shows its menu label and file", async ({ page }) => {
    test.setTimeout(600_000);
    const refs = (await (await page.request.get("/api/reference-models")).json()).models as Ref[];
    expect(refs.length).toBeGreaterThan(0);
    await page.goto("/");
    for (const ref of refs) {
      await openMenu(page);
      await page.getByTestId("open-menu-list").locator(`[data-catalog-label="${ref.label}"]`).click();
      await expectTitle(page, ref.label, { file: `${ref.name}.py` }, "Reference");
      await expect(page).toHaveTitle(`${ref.label} — PsyNeuView`);
      await expect(page.getByTestId("model-title")).toHaveAttribute("title", new RegExp(`${ref.name}\\.py`));
    }
  });

  test("a Library model carries the Reference Model's label, tagged Library", async ({ page }) => {
    const lib = (await (await page.request.get("/api/library-models")).json()).models as { name: string; label: string; path: string }[];
    const refs = (await (await page.request.get("/api/reference-models")).json()).models as Ref[];
    const same = lib.find((m) => m.name === "Cohen_Huston1994");
    test.skip(!same, "the active PsyNeuLink has no Library");
    const ref = refs.find((r) => r.name === "Cohen_Huston1994")!;
    expect(same!.label).toBe(ref.label); // one name everywhere
    await page.goto("/");
    await openByPath(page, same!.path);
    await expectTitle(page, ref.label, { file: path.basename(same!.path) }, "Library");
  });

  test("a user's own file is named by its file, with its folder", async ({ page }) => {
    const deep = path.join(process.env.PW_SESSION_TMP ?? "/tmp", "models", "research", "2026", "stroop-variants");
    mkdirSync(deep, { recursive: true });
    const mine = path.join(deep, "my_stroop_experiment.py");
    copyFileSync(fixturePath("two_mech_projection"), mine);
    await page.goto("/");
    await openByPath(page, mine);
    await expectTitle(page, "my_stroop_experiment.py", { folder: "stroop-variants" }, "Your file");
    await expect(page).toHaveTitle("my_stroop_experiment.py — PsyNeuView");

    // The model card has everything in full.
    await page.getByTestId("model-title").click();
    const card = page.getByTestId("model-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("model-card-source")).toHaveText(/Your own file/);
    await expect(card.getByTestId("model-card-path")).toContainText("research/2026/stroop-variants/my_stroop_experiment.py");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });
});
