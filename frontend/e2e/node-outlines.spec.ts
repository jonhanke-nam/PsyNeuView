/**
 * Node outlines are heavier by default and adjustable in Settings ▸
 * Appearance ▸ Node outlines; a selected node stays heavier (#42).
 */
import { mutatingTest as test, expect, clickCanvasNode } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

/**
 * Each canvas node's oval outline width, in px, by node id: the width asked
 * for, not the computed one, since Chrome rounds a border down to whole device
 * pixels (3.5 px shows as 3 px on a standard display, 3.5 px on Retina). Read
 * from the `border` shorthand: its colour is a variable, which leaves the
 * longhands blank.
 */
async function outlineWidths(page: Page): Promise<Record<string, number>> {
  return page.locator(".react-flow__node").evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.flatMap((n) => {
        const oval = Array.from(n.querySelectorAll<HTMLElement>("div")).find((d) => d.style.borderRadius === "50%");
        return oval ? [[n.getAttribute("data-id") ?? "", parseFloat(oval.style.border)]] : [];
      }),
    ),
  );
}

test("node outlines: heavier defaults, set in Settings, selection still heavier", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "outlines42-"));
  const model = path.join(dir, "two_mech_projection.py");
  writeFileSync(model, readFileSync(fixturePath("two_mech_projection"), "utf8"));

  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  // The defaults: 2 px, or 3.5 px for INPUT/OUTPUT/CONTROL nodes.
  const before = await outlineWidths(page);
  expect(Object.keys(before).length).toBeGreaterThan(0);
  for (const w of Object.values(before)) expect([2, 3.5]).toContain(w);

  // Choose 4 px and 5 px in Settings; the canvas follows without a reload.
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-node-outline").selectOption("4");
  await page.getByTestId("setting-node-outline-emphasis").selectOption("5");
  await page.keyboard.press("Escape");
  const after = await outlineWidths(page);
  for (const [id, w] of Object.entries(after)) expect(w, id).toBe(before[id] === 2 ? 4 : 5);

  // A selected node is 1.5 px heavier than its own outline.
  const [id] = Object.keys(after);
  await clickCanvasNode(page, id);
  await expect.poll(async () => (await outlineWidths(page))[id]).toBe(after[id] + 1.5);

  // Remembered across a reload.
  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-node-outline")).toHaveValue("4");
  await expect(page.getByTestId("setting-node-outline-emphasis")).toHaveValue("5");
});
