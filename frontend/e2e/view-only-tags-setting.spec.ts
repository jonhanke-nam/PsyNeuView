/**
 * Settings ▸ Appearance ▸ Node tags hides a node's "view only" tag (#211).
 *
 * A node whose declaration PsyNeuView can't edit (here, three mechanisms
 * unpacked from a list) carried a small "view only" tag above its name, which
 * PsyNeuLink's show_graph() doesn't draw. Hidden by default, with no empty
 * row left where it was; the node's hover text still says it; Settings shows
 * the tags again, and the choice holds across a reload.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";
import { writeFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Unpacked from a list: no `var = pnl.Type(...)` line, so each node is view
// only (backend/app/services/introspector.py, _build_declaration_index).
const UNPACKED = `import psyneulink as pnl

colour, hidden, response = [
    pnl.TransferMechanism(name=n, input_shapes=2) for n in ("colour", "hidden", "response")
]

comp = pnl.Composition(name="unpacked")
comp.add_linear_processing_pathway([colour, hidden, response])
`;

type Page = import("@playwright/test").Page;

async function openModel(page: Page, model: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(canvasNode(page, "hidden").first()).toBeVisible({ timeout: 60_000 });
}

/** The oval's own text, as drawn, and whether a tag row sits above the name. */
async function drawn(page: Page, name: string) {
  const node = canvasNode(page, name).first();
  return node.evaluate((n) => ({
    text: (n as HTMLElement).innerText.trim(),
    tagRow: n.querySelector("[data-testid=node-tags]") !== null,
    viewOnlyTag: n.querySelector("[data-testid=node-view-only-tag]") !== null,
    title: n.querySelector<HTMLElement>("[data-node-shape]")?.title ?? "",
  }));
}

test("view only tags: hidden by default, shown from Settings, remembered (#211)", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "viewonly211-"));
  const model = path.join(dir, "unpacked.py");
  writeFileSync(model, UNPACKED);

  await page.goto("/");
  await openModel(page, model);

  // Hidden by default: just the name, no tag row above it, and the hover
  // text still says the node is view only.
  for (const name of ["colour", "hidden", "response"]) {
    const d = await drawn(page, name);
    expect(d.text, name).toBe(name);
    expect(d.tagRow, `${name}: an empty tag row`).toBe(false);
    expect(d.viewOnlyTag, name).toBe(false);
    expect(d.title, `${name}: hover text`).toMatch(/view only/i);
  }

  // Settings ▸ Appearance ▸ Node tags shows them, at once.
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  const control = page.getByTestId("setting-graph-view-only-tags");
  await expect(control).toHaveValue("hidden");
  await control.selectOption("shown");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();
  await expect(canvasNode(page, "hidden").first().getByTestId("node-view-only-tag")).toHaveText("view only");
  expect((await drawn(page, "colour")).viewOnlyTag).toBe(true);

  // Remembered across a reload.
  await page.reload();
  await openModel(page, model);
  await expect(canvasNode(page, "hidden").first().getByTestId("node-view-only-tag")).toHaveText("view only");

  // And hiding them again is remembered too.
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-graph-view-only-tags").selectOption("hidden");
  await page.keyboard.press("Escape");
  await expect(canvasNode(page, "hidden").first().getByTestId("node-view-only-tag")).toHaveCount(0);
  await page.reload();
  await openModel(page, model);
  expect((await drawn(page, "hidden")).viewOnlyTag).toBe(false);
});
