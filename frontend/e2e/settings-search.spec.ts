/**
 * Settings search (#271): a field at the top of Settings finds a setting by
 * its name, its section or the words people use for it, and takes you there.
 *
 * The last test is the guard: every setting in docs/settings-inventory.yaml
 * (outside the Mac app's own) is reachable from search, its control shown
 * after choosing its result.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
}

const search = (page: Page) => page.getByTestId("settings-search");
const result = (page: Page, id: string) => page.locator(`[data-testid="settings-search-result"][data-setting="${id}"]`);

test.describe("Settings search (#271)", { tag: "@ci" }, () => {
  test("“preview” finds the live preview and takes you to it, flashed", async ({ page }) => {
    await openSettings(page);
    await page.getByTestId("settings-section-about").click();
    await search(page).fill("preview");
    await expect(page.getByTestId("settings-search-result").first()).toHaveAttribute("data-setting", "live-preview");
    await expect(result(page, "live-preview")).toContainText("General");
    await result(page, "live-preview").click();
    await expect(page.getByTestId("settings-content-general")).toBeVisible();
    const control = page.getByTestId("setting-live-preview");
    await expect(control).toBeInViewport();
    await expect(page.locator(".pnv-setting-flash")).toHaveCount(1);
    await expect(page.locator(".pnv-setting-flash")).toHaveCount(0, { timeout: 5000 });
  });

  test("Return takes you to the best match", async ({ page }) => {
    await openSettings(page);
    await search(page).fill("narration voice");
    await search(page).press("Enter");
    await expect(page.getByTestId("settings-content-tutorials-voice")).toBeVisible();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
  });

  test("no match says so, with the closest", async ({ page }) => {
    await openSettings(page);
    await search(page).fill("voice zzqx");
    await expect(page.getByTestId("settings-search-none")).toContainText("No setting matches “voice zzqx”");
    await expect(result(page, "narration-voice")).toBeVisible();
  });

  test("⌘F / Ctrl+F focuses the field; Esc clears it, then closes Settings", async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press("ControlOrMeta+f");
    await expect(search(page)).toBeFocused();
    await page.keyboard.type("outline");
    await expect(result(page, "node-outline")).toBeVisible();
    await expect(page.getByTestId("settings-section-general")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(page.getByTestId("settings-section-general")).toBeVisible();
    await expect(page.getByTestId("settings-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });

  test("a setting shown only sometimes says when", async ({ page }) => {
    await openSettings(page);
    await search(page).fill("after N seconds");
    await expect(result(page, "autosave-delay").getByTestId("settings-search-shown-when")).toContainText("Autosave is on");
  });

  test("every inventoried setting is reachable from search", async ({ page }) => {
    test.setTimeout(240_000);
    const inventory = (
      yaml.load(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/settings-inventory.yaml"), "utf8")) as {
        settings: {
          id: string; label: string; home: string; control: string;
          simple_control?: string; simple_section?: string; shown_when?: string;
        }[];
      }
    ).settings.filter((e) => e.home === "settings");
    await openSettings(page);
    const unreachable: string[] = [];
    for (const e of inventory) {
      const name = e.label.split("▸").pop()!.trim().replace(/\(.*$/, "").trim();
      // A simple view, or its full form where the simple one isn't shown.
      const controls = e.simple_control && e.simple_section ? [e.simple_control, e.control] : [e.control];
      await search(page).fill(name);
      const r = result(page, e.id);
      if (!(await r.isVisible())) {
        unreachable.push(`${e.id}: not in the results for “${name}”`);
        continue;
      }
      // One shown only sometimes says when, in its result; that is enough.
      if (e.shown_when) {
        await expect(r).toContainText(e.shown_when);
        continue;
      }
      await r.click();
      const shown = page.locator(controls.map((c) => `[data-testid="${c}"]`).join(", "));
      try {
        await expect(shown.first()).toBeAttached({ timeout: 8000 });
      } catch {
        unreachable.push(`${e.id}: ${controls.join(" or ")} not shown`);
      }
    }
    expect(unreachable).toEqual([]);
  });
});
