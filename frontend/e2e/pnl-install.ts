/**
 * Helpers for specs about PsyNeuLink's own files (#1305, #1309).
 *
 * Which PsyNeuLink is active is read from the installed distribution's
 * metadata, which the harness can't point elsewhere. A spec builds a
 * temporary checkout tree (`<root>/psyneulink/library/models/…`) and declares
 * it through the test-only `/api/test/pnl-install` override as a local
 * checkout, a managed GitHub install, or a PyPI release — and puts the real
 * metadata back in its `finally` (`/test/reset` does so too).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

export const STANDIN = "Standin_Library_Model.py";

/** A minimal PsyNeuLink tree: `<root>/psyneulink/library/models/<stand-in>`. */
export function checkoutTree(label: string) {
  const root = mkdtempSync(path.join(tmpdir(), `pnl-${label}-`));
  const models = path.join(root, "psyneulink", "library", "models");
  mkdirSync(models, { recursive: true });
  const model = path.join(models, STANDIN);
  copyFileSync(fixturePath("two_mech_projection"), model);
  return { root, model };
}

export async function declareInstall(page: Page, kind: "local" | "github" | "pypi" | null, root?: string) {
  const resp = await page.request.post("/api/test/pnl-install", { data: { kind, root: root ?? null } });
  expect(resp.ok(), `/api/test/pnl-install ${kind}: ${resp.status()}`).toBe(true);
}

/** Open a model through Open ▸ Open from path…, and wait for its graph. */
export async function openModelFromPath(page: Page, model: string) {
  // Wide enough that the toolbar's badges stay in view beside the file name.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}
