/**
 * An edit sends the model back in the view the page shows (#431).
 *
 * After #428 every open built the model in the view the view menu names, but
 * the edit routes (a parameter, a port, a node name, saving typed code) still
 * re-read it nested. In "Flatten (all compositions)" an Inspector edit on EGO
 * then drew the nested graph, with EM folded into one node, while the menu
 * still read Flatten.
 *
 * Here a parameter is changed and a port renamed on EGO in the flattened
 * view. After each, the menu, EM's fold state and the drawn nodes and arrows
 * are the same as before; only the edit differs.
 */
import { mutatingTest as test, expect, closePalette, clickCanvasNode } from "./test-base";
import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");

test.use({ viewport: { width: 1600, height: 1000 } });

const canvas = (page: Page) => page.getByTestId("graph-canvas");
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();
const emFrame = (page: Page) =>
  canvas(page).locator('.react-flow__node-compositionNode[data-id="EM"], .react-flow__node-compositionNode[data-id="cluster::EM"]');
const emFolded = (page: Page) => canvas(page).locator('.react-flow__node-mechanismNode[data-id="EM"]');
const emMember = (page: Page) => canvas(page).getByText("COMBINED SCORES", { exact: true });

/** What is drawn: the view, and every node and arrow by id. */
async function drawn(page: Page) {
  const ids = (sel: string) =>
    canvas(page).locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? "").sort());
  return {
    view: await viewMenu(page).inputValue(),
    nodes: await ids(".react-flow__node"),
    arrows: await ids(".react-flow__edge"),
  };
}

/** Read what is drawn until two reads a moment apart agree. */
async function settled(page: Page) {
  let last = JSON.stringify(await drawn(page));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = JSON.stringify(await drawn(page));
    if (now === last) break;
    last = now;
  }
  return JSON.parse(last) as Awaited<ReturnType<typeof drawn>>;
}

/** EM is open in the flattened view, as the view menu says. */
async function expectFlattenedAndOpen(page: Page) {
  await expect(viewMenu(page)).toHaveValue("__flat__", { timeout: 60_000 });
  await expect(emFrame(page)).toBeVisible({ timeout: 60_000 });
  await expect(emMember(page)).toBeVisible();
  await expect(emFolded(page)).toHaveCount(0);
}

/** Wait for an edit route's answer, and check it was asked for the view shown. */
function edited(page: Page, route: string) {
  return page
    .waitForResponse((r) => r.url().endsWith(route) && r.request().method() === "POST", { timeout: 60_000 })
    .then((r) => {
      expect(r.ok(), `${route} failed`).toBe(true);
      expect(r.request().postDataJSON()).toMatchObject({ flat: true, pytorch: false });
      return r;
    });
}

test.describe("an edit keeps the view the page shows (#431)", { tag: "@ci" }, () => {
  test("EGO flattened: a parameter edit and a port rename leave the view, EM and the graph as they were", async ({ page }) => {
    test.setTimeout(240_000);
    // A copy, so the edits never touch the bundled model.
    const file = path.join(mkdtempSync(path.join(tmpdir(), "editview431-")), "Giallanza2024_ego_study2.py");
    copyFileSync(EGO, file);

    await page.goto("/");
    await closePalette(page);
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(file);
    await prompt.press("Enter");
    await expectFlattenedAndOpen(page);
    const before = await settled(page);

    // A parameter, from the Inspector.
    await clickCanvasNode(page, "CONTEXT");
    await page.getByTestId("tab-inspector").click();
    const rate = page.getByTestId("param-integration_rate");
    await expect(rate).toBeVisible({ timeout: 10_000 });
    const paramDone = edited(page, "/api/model/update-param");
    await rate.click();
    await rate.fill("0.37"); // not the class default, which an edit removes
    await rate.press("Enter");
    expect((await (await paramDone).json()).source).toMatch(/integration_rate=0\.37/);
    await expectFlattenedAndOpen(page);
    expect(await settled(page)).toEqual(before);

    // A port, renamed from the Inspector.
    await clickCanvasNode(page, "PREDICTION");
    await page.getByTestId("tab-inspector").click();
    const port = page.getByTestId("port-name-InputPort-0");
    await expect(port).toBeVisible({ timeout: 10_000 });
    const portDone = edited(page, "/api/model/rename-port");
    await port.click();
    await port.fill("PREDICTION_IN");
    await port.press("Enter");
    expect((await (await portDone).json()).source).toMatch(/input_ports=\['PREDICTION_IN'\]/);
    await expectFlattenedAndOpen(page);
    // The same graph, but for the arrow into the renamed port, whose id
    // names it.
    const renamed = before.arrows
      .map((a) => a.replace("PREDICTION[InputPort-0]", "PREDICTION[PREDICTION_IN]"))
      .sort();
    expect(renamed).not.toEqual(before.arrows);
    expect(await settled(page)).toEqual({ ...before, arrows: renamed });
    await expect(page.getByTestId("port-name-PREDICTION_IN")).toBeVisible();
  });
});
