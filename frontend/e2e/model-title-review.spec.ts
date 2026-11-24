/**
 * Review screenshots of the toolbar's model title (#422), not a test.
 *
 * Opens three reference models, a PsyNeuLink Library model and a user's file
 * deep in folders, at three window widths, and saves the toolbar of each, the
 * model card and the toolbar's height at each width, for the owner to choose
 * a title layout. Skipped unless PNV_TITLE_REVIEW_DIR names where to save:
 *
 *   PNV_TITLE_REVIEW_DIR=~/psyneuview-meetings/review-2026-11-24/model-identity-422 \
 *   PNV_TITLE_REVIEW_PREFIX=03-A PNV_TITLE_REVIEW_VARIANT=A \
 *   npx playwright test e2e/model-title-review.spec.ts
 *
 * PNV_TITLE_REVIEW_VARIANT picks the layout on trial ("A" or "B"; leave it
 * out for a build from before #422).
 */
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { readOnlyTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import type { Page } from "@playwright/test";

const OUT = process.env.PNV_TITLE_REVIEW_DIR;
const PREFIX = process.env.PNV_TITLE_REVIEW_PREFIX ?? "shot";
const VARIANT = process.env.PNV_TITLE_REVIEW_VARIANT;

const WIDTHS = [
  { name: "narrow", width: 1024 },
  { name: "medium", width: 1366 },
  { name: "wide", width: 1920 },
];

const REFERENCES = [
  "Stroop — Bidirectional (Cohen & Huston 1994)",
  "Stroop — PCTC (Kalanthroff, Davelaar & Usher 2018)",
  "Stroop — Basic",
];

async function openByPath(page: Page, file: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 3000 }).catch(() => {});
}

async function openReference(page: Page, label: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.locator(`[data-catalog-label="${label}"]`).first().click();
}

test("toolbar title review shots (#422)", async ({ page }) => {
  test.skip(!OUT, "review shots only: set PNV_TITLE_REVIEW_DIR");
  test.setTimeout(600_000);
  const out = (OUT as string).replace(/^~/, process.env.HOME ?? "~");
  mkdirSync(out, { recursive: true });
  if (VARIANT) await page.addInitScript((v) => localStorage.setItem("psyneuview.titleMock", v), VARIANT);

  const lib = (await (await page.request.get("/api/library-models")).json()).models as { label: string; path: string }[];
  const deep = path.join(process.env.PW_SESSION_TMP ?? "/tmp", "Documents", "research", "2026", "projects", "stroop-variants");
  mkdirSync(deep, { recursive: true });
  const mine = path.join(deep, "my_stroop_experiment.py");
  copyFileSync(fixturePath("two_mech_projection"), mine);

  const scenes: { name: string; open: (p: Page) => Promise<void> }[] = [
    ...REFERENCES.map((label, i) => ({ name: `ref${i + 1}`, open: (p: Page) => openReference(p, label) })),
    ...(lib.length ? [{ name: "library", open: (p: Page) => openByPath(p, lib[1]?.path ?? lib[0].path) }] : []),
    { name: "user", open: (p: Page) => openByPath(p, mine) },
  ];

  const heights: Record<string, number> = {};
  let n = 0;
  for (const scene of scenes) {
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto("/");
    await scene.open(page);
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
    await page.mouse.move(0, 700);
    // Toasts sit over the toolbar's right end; hide them for the picture.
    await page.addStyleTag({ content: '[data-testid="notification"] { display: none !important; }' });
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: 800 });
      await page.waitForTimeout(400);
      const bar = page.getByTestId("app-toolbar");
      const box = await bar.boundingBox();
      heights[`${scene.name} ${w.name}`] = Math.round(box?.height ?? 0);
      n += 1;
      await bar.screenshot({ path: path.join(out, `${PREFIX}-${String(n).padStart(2, "0")}-${scene.name}-${w.name}.png`) });
    }
    if (VARIANT && (scene.name === "ref1" || scene.name === "user")) {
      await page.setViewportSize({ width: 1366, height: 800 });
      await page.getByTestId("model-title").click();
      await expect(page.getByTestId("model-card")).toBeVisible();
      await page.waitForTimeout(300);
      n += 1;
      await page.screenshot({
        path: path.join(out, `${PREFIX}-${String(n).padStart(2, "0")}-${scene.name}-model-card.png`),
        clip: { x: 0, y: 0, width: 1366, height: 340 },
      });
      await page.keyboard.press("Escape");
      if (scene.name === "ref1") {
        writeFileSync(path.join(out, `${PREFIX}-window-title.txt`), `${await page.title()}\n`);
      }
    }
  }
  writeFileSync(path.join(out, `${PREFIX}-toolbar-heights.json`), JSON.stringify(heights, null, 2) + "\n");
});
