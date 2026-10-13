/**
 * Tutorial capture + verification — "Building a model" (#665, under #662).
 *
 * Follows the executable-spec pattern. Two entry points, both scripted:
 *
 *  - **New Model** generates a valid two-node starter model (input_node ->
 *    output_node) plus its PsyNeuLink source.
 *  - **Clicking a palette item** adds that component to the model. This spec
 *    used to skip the palette entirely, on the grounds that adding a component
 *    meant an HTML5 drag-drop too brittle to script. That was wrong: click-add
 *    has always been a first-class path — `nodeActions.ts` says so in its own
 *    header ("Used by both PaletteSidebar (click) and GraphCanvas (drag-drop)")
 *    and the compact palette's tooltip reads "drag or click to add".
 *
 * That gap mattered: building a model in the GUI is the premise of the course
 * walkthroughs (#1180), and until now the interaction it rests on had no
 * coverage at all. Drag-add remains unscripted; click-add drives the same
 * `addNodeToModel` path, so the model-building contract is gated either way.
 *
 * Read-only w.r.t. backend reset (no PSYNEWVIEW_TEST_MODE required).
 */
import { readOnlyTest as test, expect } from "../test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const ASSETS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/tutorials/assets/building",
);
mkdirSync(ASSETS, { recursive: true });
const shot = (name: string) => path.join(ASSETS, name);

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("Tutorial: Building a model", () => {
  test("New Model creates a runnable two-node starter model", async ({ page }) => {
    await page.goto("/");

    // Open ▾ → + New Model… → name it.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /New Model/ }).click();
    const name = page.locator('input[placeholder="my_model"]');
    await expect(name).toBeVisible();
    await name.fill("tutorial_demo");
    await name.press("Enter");

    // Guarantee: a starter model appears — input_node -> output_node + an edge.
    // Node data-ids carry a session-counter suffix (e.g. "input_node-10"), so
    // match by prefix.
    await expect(page.locator('.react-flow__node[data-id^="input_node"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.react-flow__node[data-id^="output_node"]')).toBeVisible();
    expect(await page.locator(".react-flow__edge").count()).toBeGreaterThan(0);

    await page.waitForTimeout(600);
    await page.screenshot({ path: shot("01-new-model.png") });

    // The palette is where additional components come from.
    await page.getByTestId("palette-sidebar").screenshot({ path: shot("02-palette.png") });
  });

  test("clicking a palette component adds it to the model", async ({ page }) => {
    await page.goto("/");

    // Its own starter model, so a palette regression reports separately from a
    // New Model regression rather than the two failing as one.
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: /New Model/ }).click();
    const name = page.locator('input[placeholder="my_model"]');
    await expect(name).toBeVisible();
    await name.fill("tutorial_palette_add");
    await name.press("Enter");

    const nodes = page.locator(".react-flow__node");
    await expect(nodes).toHaveCount(2, { timeout: 30000 });

    // Search rather than walking the taxonomy tree: the groups start closed and
    // their nesting is a presentation choice that may well change, while
    // "type the name, click the result" is what a user does anyway.
    const palette = page.getByTestId("palette-sidebar");
    await palette.getByPlaceholder("Search components...").fill("TransferMechanism");
    // Target the tooltip, not the visible text. The palette shows a short
    // display label ("Transfer"), while the tooltip is built from the actual
    // PsyNeuLink type — so this stays correct if the labels are reworded, and
    // it can't drift onto RecurrentTransferMechanism, which the same search
    // also returns.
    // `exact` matters: without it this also matches
    // "RecurrentTransferMechanism — ...", which contains the same substring.
    await palette
      .getByTitle("TransferMechanism \u2014 drag or click to add", { exact: true })
      .click();

    // Guarantee: the component lands in the model under the #181 default name,
    // on the canvas and in the generated source together.
    await expect(nodes).toHaveCount(3, { timeout: 30000 });
    await expect(
      page.locator('.react-flow__node[data-id^="New_TransferMechanism_1"]'),
    ).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText(
      /New_TransferMechanism_1\s*=\s*pnl\.TransferMechanism/,
      { timeout: 10000 },
    );

    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("03-palette-click-add.png") });
  });
});
