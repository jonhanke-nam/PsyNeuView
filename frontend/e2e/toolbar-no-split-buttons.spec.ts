/**
 * Toolbar buttons never break onto two lines (#6).
 *
 * In a narrow window the toolbar used to squeeze its buttons until their text
 * wrapped inside them: "Open" on one line and its ▾ on the next. Every control
 * in the toolbar row is now kept on one line; when the row runs out of room,
 * whole controls move to a second row instead.
 *
 * "One line" is measured, not assumed: the text inside each control is laid
 * out as line boxes, and all of them must share one top.
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

async function openScratchModel(page: Page) {
  const dir = mkdtempSync(path.join(tmpdir(), "toolbar6-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, readFileSync(fixturePath("two_mech_projection"), "utf8"));
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** Each visible toolbar control's label, height and number of text lines. */
async function measure(page: Page) {
  return page.getByTestId("app-toolbar").evaluate((bar) => {
    const out: { label: string; height: number; lines: number }[] = [];
    for (const el of Array.from(bar.querySelectorAll("button, select, strong"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Skip anything inside an open menu or popover; only the row itself counts.
      if (el.closest('[role="menu"], [role="dialog"], [role="listbox"]')) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set<number>();
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top / 4));
      }
      out.push({ label: (el.textContent || "").trim().slice(0, 30), height: Math.round(box.height), lines: tops.size });
    }
    return out;
  });
}

test.describe("Toolbar buttons stay on one line", { tag: "@ci" }, () => {
  for (const width of [1440, 900, 760]) {
    test(`at ${width} px wide, no toolbar control breaks onto two lines`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openScratchModel(page);
      const controls = await measure(page);
      console.log(`toolbar @${width}: ${JSON.stringify(controls)}`);
      expect(controls.length).toBeGreaterThan(5);
      const split = controls.filter((c) => c.lines > 1);
      expect(split, `split controls: ${JSON.stringify(split)}`).toEqual([]);
    });
  }
});
