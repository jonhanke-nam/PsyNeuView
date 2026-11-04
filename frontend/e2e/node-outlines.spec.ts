/**
 * Node outlines are heavier by default and adjustable in Settings ▸
 * Appearance ▸ Node outlines. INPUT/OUTPUT/CONTROL nodes are 4 px heavier
 * (#190; 2 px before), and a selected node 2 px heavier than its own outline
 * (#42). Widths are checked as drawn: Chrome draws borders at whole pixels.
 * The default colours are show_graph's as its own PDF draws them (#190):
 * green #00ff00 for INPUT, red #ff0000 for OUTPUT, black for an ordinary
 * node. The show_graph tab draws the same green, so the two pictures agree.
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

/** Each canvas node's oval outline as drawn, by node id: its width in px and its colour. */
async function outlines(page: Page): Promise<Record<string, { width: number; color: string }>> {
  return page.locator(".react-flow__node").evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.flatMap((n) => {
        const oval = Array.from(n.querySelectorAll<HTMLElement>("div")).find((d) => d.style.borderRadius === "50%");
        if (!oval) return [];
        const cs = getComputedStyle(oval);
        return [[n.getAttribute("data-id") ?? "", { width: parseFloat(cs.borderTopWidth), color: cs.borderTopColor }]];
      }),
    ),
  );
}

/** Each canvas node's oval outline width as drawn, in px, by node id. */
async function outlineWidths(page: Page): Promise<Record<string, number>> {
  return Object.fromEntries(Object.entries(await outlines(page)).map(([id, o]) => [id, o.width]));
}

test("node outlines: show_graph's colours and heavier defaults, one width in Settings, emphasis and selection follow", { tag: "@ci" }, async ({ page }) => {
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

  // The defaults: 4 px black for an ordinary node; 8 px for INPUT (green)
  // and OUTPUT (red) nodes, show_graph's colours.
  expect(await outlines(page)).toEqual({
    colour: { width: 8, color: "rgb(0, 255, 0)" },
    hidden: { width: 4, color: "rgb(0, 0, 0)" },
    response: { width: 8, color: "rgb(255, 0, 0)" },
  });
  const before = await outlineWidths(page);

  // Choose 5 px in Settings; the canvas follows without a reload, and the
  // heavier outlines move with it.
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-node-outline").selectOption("5");
  await page.keyboard.press("Escape");
  const after = await outlineWidths(page);
  for (const [id, w] of Object.entries(after)) expect(w, id).toBe(before[id] + 1);

  // A selected node is 2 px heavier than its own outline.
  await clickCanvasNode(page, "hidden");
  await expect.poll(async () => (await outlineWidths(page)).hidden).toBe(7);

  // Remembered across a reload.
  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await expect(page.getByTestId("setting-node-outline")).toHaveValue("5");
});
