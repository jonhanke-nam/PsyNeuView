/**
 * The live preview runs in the background, has a setting, and checks fast
 * (#255, #256). Reported by a PsyNeuLink developer: each automatic update
 * showed the busy wheel and pointer for 3–4 s while they typed, there was no
 * setting for it, and it ran with autosave off.
 *
 *   - typing updates the graph with no busy wheel; the request says background;
 *   - Settings ▸ Model files ▸ Update the graph while typing: Off sends no
 *     preview while typing; saving still updates;
 *   - an undefined name is answered by the fast check, without running.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "livepreview255-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function replaceBuffer(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

function previews(page: Page) {
  const seen: { background: boolean }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/model/preview") {
      seen.push({ background: r.headers()["x-psyneuview-background"] === "1" });
    }
  });
  return seen;
}

test.describe("live preview (#255, #256)", { tag: "@ci" }, () => {
  test("typing updates the graph in the background, with no busy wheel", async ({ page }) => {
    const seen = previews(page);
    await openFromPath(page, scratchModel());
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/model/preview"), { timeout: 30_000 });
    await replaceBuffer(page, `${BASE}\n# a note\n`);
    // Until the preview has answered, and a moment after, no wheel.
    const watch = (async () => {
      for (let i = 0; i < 20; i++) {
        await expect(page.getByTestId("busy-wheel")).toHaveCount(0);
        await page.waitForTimeout(150);
      }
    })();
    await answered;
    await watch;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.background)).toBe(true);
  });

  test("Off: typing sends no preview, and saving still updates", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("psyneuview.editor.livePreviewMs", "0"));
    const seen = previews(page);
    await openFromPath(page, scratchModel());
    await replaceBuffer(page, `${BASE}\n# a note\n`);
    await page.waitForTimeout(3500);
    expect(seen).toEqual([]);
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/model/save-source") && r.ok(), { timeout: 30_000 });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await saved;
  });

  test("the setting is in Settings ▸ Model files", async ({ page }) => {
    await openFromPath(page, scratchModel());
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    const select = page.getByTestId("setting-live-preview");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("1500");
    await select.selectOption("0");
    await expect(select).toHaveValue("0");
  });

  test("an undefined name is answered by the fast check, without running", async ({ page }) => {
    await openFromPath(page, scratchModel());
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/model/preview") && r.ok(), { timeout: 30_000 });
    await replaceBuffer(page, `${BASE}\nx = NOT_DEFINED_ANYWHERE\n`);
    const model = (await (await answered).json()).model;
    expect(model.quickCheck).toBe(true);
    expect(model.error).toBe("name 'NOT_DEFINED_ANYWHERE' is not defined");
    await expect(page.getByText(/NOT_DEFINED_ANYWHERE/).first()).toBeVisible();
  });
});
