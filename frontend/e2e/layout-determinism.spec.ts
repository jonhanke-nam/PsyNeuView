/**
 * The same model, view and settings always give the same layout (#432).
 *
 * EGO's PyTorch view came out laid out differently from one open to the next
 * in Auto Layered: the node order and the EM frame's width changed, and seemed
 * to depend on which model was open before. PsyNeuLink builds that view from a
 * set of the model's nodes, so the order the nodes arrived in followed memory
 * addresses and changed on every open, and the layered layout places nodes in
 * the order it is given them.
 *
 * Here EGO's PyTorch view is opened three times, each after a different model,
 * and every node must be in the same place with the same size each time.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..", "..", "backend");
const EGO = path.join(BACKEND, "reference_models", "Giallanza2024_ego_study2.py");
const BEFORE = [
  path.join(BACKEND, "reference_models", "stroop_reference_basic.py"),
  path.join(BACKEND, "demos", "nested_compositions.py"),
  path.join(BACKEND, "reference_models", "Botvinick_conflict_monitoring_model.py"),
];

test.use({ viewport: { width: 1600, height: 1000 } });

const canvas = (page: Page) => page.getByTestId("graph-canvas");
const viewSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();
const layoutSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();
const loaded = (page: Page, file?: string) =>
  page.waitForResponse(
    (r) =>
      r.url().includes("/api/model/load") &&
      r.request().method() === "POST" &&
      (!file || (r.request().postData() ?? "").includes(path.basename(file))),
    { timeout: 60_000 },
  );

async function openPath(page: Page, file: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await Promise.all([loaded(page, file), prompt.press("Enter")]);
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 3000 }).catch(() => {});
  await expect(canvas(page).locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

/** Every node's place and size, in the graph's own units (not the screen's). */
async function positions(page: Page) {
  return canvas(page)
    .locator(".react-flow__node")
    .evaluateAll((els) =>
      Object.fromEntries(
        els
          .map((el) => {
            const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform);
            const box = el as HTMLElement;
            return [
              box.dataset.id ?? "",
              m ? [Math.round(+m[1]), Math.round(+m[2]), box.offsetWidth, box.offsetHeight] : null,
            ] as const;
          })
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
}

/** Read the positions until two reads a moment apart agree. */
async function settledPositions(page: Page) {
  await expect(page.getByTestId("busy-wheel")).toHaveCount(0, { timeout: 60_000 }).catch(() => {});
  let last = JSON.stringify(await positions(page));
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(300);
    const now = JSON.stringify(await positions(page));
    if (now === last) break;
    last = now;
  }
  return JSON.parse(last) as Record<string, number[] | null>;
}

test.describe("layout determinism (#432)", { tag: "@ci" }, () => {
  test("EGO's PyTorch view in Auto Layered is laid out the same whichever model was open before", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    await closePalette(page);

    const layouts: Record<string, number[] | null>[] = [];
    for (const before of BEFORE) {
      await openPath(page, before);
      await openPath(page, EGO);
      const view = viewSelect(page);
      if ((await view.inputValue()) !== "__pytorch__") {
        await Promise.all([loaded(page), view.selectOption("__pytorch__")]);
      }
      await expect(view).toHaveValue("__pytorch__");
      // Auto Layered, Bottom-Up, as the #389 check measures it.
      const layout = layoutSelect(page);
      if ((await layout.inputValue()) !== "layered") await layout.selectOption("layered");
      await page.getByTestId("graph-view-options-button").click();
      await page.getByTestId("graph-view-option-direction").selectOption("BT");
      await page.keyboard.press("Escape");
      await expect(canvas(page).getByText("COMBINED SCORES", { exact: true })).toBeVisible({ timeout: 60_000 });
      layouts.push(await settledPositions(page));
    }

    expect(Object.keys(layouts[0]).length).toBeGreaterThan(10);
    expect(Object.values(layouts[0]).every(Boolean)).toBe(true);
    expect(layouts[1], "after a different model, the same layout").toEqual(layouts[0]);
    expect(layouts[2], "after a third model, the same layout").toEqual(layouts[0]);
  });
});
