/**
 * Node outlines are heavier by default and adjustable in Settings ▸
 * Appearance ▸ Node outlines. INPUT/OUTPUT/CONTROL nodes are 2 px heavier,
 * and a selected node 2 px heavier than its own outline (#42). Widths are
 * checked as drawn: Chrome draws borders at whole pixels.
 */
import { mutatingTest as test, expect, clickCanvasNode } from "./test-base";
import { writeFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// A hidden layer, so ordinary nodes are drawn beside INPUT and OUTPUT ones.
const THREE_LAYER = `import psyneulink as pnl

colour = pnl.TransferMechanism(name="colour", input_shapes=2)
hidden = pnl.TransferMechanism(name="hidden", input_shapes=2, function=pnl.Logistic)
response = pnl.TransferMechanism(name="response", input_shapes=2)

comp = pnl.Composition(name="three_layer")
comp.add_linear_processing_pathway([colour, hidden, response])
`;

type Page = import("@playwright/test").Page;

/** Each canvas node's oval outline width as drawn, in px, by node id. */
async function outlineWidths(page: Page): Promise<Record<string, number>> {
  return page.locator(".react-flow__node").evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.flatMap((n) => {
        const oval = Array.from(n.querySelectorAll<HTMLElement>("div")).find((d) => d.style.borderRadius === "50%");
        return oval ? [[n.getAttribute("data-id") ?? "", parseFloat(getComputedStyle(oval).borderTopWidth)]] : [];
      }),
    ),
  );
}

test("node outlines: heavier defaults, one width in Settings, emphasis and selection follow", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "outlines42-"));
  const model = path.join(dir, "three_layer.py");
  writeFileSync(model, THREE_LAYER);

  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  // The defaults: 2 px, or 4 px for INPUT/OUTPUT/CONTROL nodes.
  const before = await outlineWidths(page);
  expect(before).toEqual({ colour: 4, hidden: 2, response: 4 });

  // Choose 3 px in Settings; the canvas follows without a reload, and the
  // heavier outlines move with it.
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-node-outline").selectOption("3");
  await page.keyboard.press("Escape");
  const after = await outlineWidths(page);
  for (const [id, w] of Object.entries(after)) expect(w, id).toBe(before[id] + 1);

  // A selected node is 2 px heavier than its own outline.
  await clickCanvasNode(page, "hidden");
  await expect.poll(async () => (await outlineWidths(page)).hidden).toBe(5);

  // Remembered across a reload.
  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-node-outline")).toHaveValue("3");
});
