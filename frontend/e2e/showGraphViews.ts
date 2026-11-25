/**
 * Opening a bundled model in each of its views, for the specs that compare
 * the canvas with show_graph: the layout agreement (#34) and the node shapes
 * (#385). Shared so both walk the same models and views the same way.
 */
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { expect, VIEW_OPTION_IDS } from "./test-base";
import type { Box, ShapedBox } from "../src/utils/layoutAgreement";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

/** Every bundled reference model, relative to backend/. */
export const REFERENCE_MODELS = [
  "Botvinick_conflict_monitoring_model.py",
  "Cohen_Huston1994_horse_race.py",
  "Cohen_Huston1994.py",
  "Giallanza2024_ego_study2.py",
  "GilzenratModel.py",
  "Kalanthroff_PCTC_2018.py",
  "MontagueDayanSejnowski96.py",
  "Nieuwenhuis2005Model.py",
  "stroop_reference_basic.py",
  "stroop_reference_with_lc.py",
].map((f) => `reference_models/${f}`);

export const viewSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();

/** Open a model by its path relative to backend/, or by an absolute path (a Library model's, #425). */
export async function openModel(page: Page, model: string) {
  const file = path.basename(model);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.isAbsolute(model) ? model : path.join(BACKEND_DIR, model));
  // The previous model stays drawn until this one's load returns.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/load") && (r.request().postData() ?? "").includes(file),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  // The view menu appears once the load has finished drawing.
  await settledBoxes(page);
}

/** The view menu's choices, in order, or just the one view when there is no menu. */
export async function views(page: Page): Promise<{ value: string; label: string }[]> {
  const select = viewSelect(page);
  if (!(await select.isVisible().catch(() => false))) return [{ value: "", label: "the model" }];
  return select.locator("option").evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? "").trim() })),
  );
}

/** Canvas node boxes, read until two reads a moment apart agree. */
export async function settledBoxes(page: Page): Promise<Map<string, Box>> {
  const read = () =>
    page
      .getByTestId("graph-canvas")
      .locator(".react-flow__node-mechanismNode")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return [el.getAttribute("data-id") ?? "", { x: r.left, y: r.top, w: r.width, h: r.height }] as const;
        }),
      );
  let last = JSON.stringify(await read());
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(400);
    const now = JSON.stringify(await read());
    if (now === last) break;
    last = now;
  }
  return new Map(JSON.parse(last));
}

export const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), { timeout: 60000 });

/** Switch to a view; returns whether it opened on saved positions. */
export async function enterView(page: Page, view: { value: string; label: string }): Promise<boolean> {
  const select = viewSelect(page);
  if (view.value && (await select.inputValue()) !== view.value) {
    await Promise.all([loaded(page), select.selectOption(view.value)]);
  }
  await settledBoxes(page);
  // A view with saved positions opens in Custom; what's measured here is the
  // automatic layout, so switch to it (nothing is saved).
  const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
  const savedLayout = await custom.isVisible().catch(() => false);
  if (savedLayout) {
    // Switching mode reloads the view.
    await Promise.all([loaded(page), custom.click()]);
    await settledBoxes(page);
  }
  return savedLayout;
}

/** Flip one of the graph's show_graph options (Controller, Learning, CIMs), in Advanced Graph View Options (#123). */
export async function toggleOption(page: Page, label: string) {
  await page.getByTestId("graph-view-options-button").click();
  const item = page.getByTestId(VIEW_OPTION_IDS[label]);
  await Promise.all([loaded(page), item.click()]);
  await page.keyboard.press("Escape");
  await settledBoxes(page);
}

/** Each canvas node's shape kind and the size of the shape's own box (#385). */
export async function drawnShapes(page: Page): Promise<Map<string, ShapedBox>> {
  const read = await page
    .getByTestId("graph-canvas")
    .locator(".react-flow__node-mechanismNode")
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const body = el.querySelector<HTMLElement>('[data-testid="mechanism-node-body"]');
        if (!body) return [];
        const r = body.getBoundingClientRect();
        return [[el.getAttribute("data-id") ?? "", { shape: body.dataset.nodeShape ?? "", w: r.width, h: r.height }] as const];
      }),
    );
  return new Map(read);
}
