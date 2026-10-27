/**
 * A node shows just its name by default, as PsyNeuLink's show_graph() draws
 * it (#122). The graph toolbar's Elements toggle brings back the type and
 * role tags and the function line, and the choice is remembered across a
 * reload. The role is still shown by the outline colour either way.
 */
import { mutatingTest as test, expect, canvasNode } from "./test-base";
import { writeFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const THREE_LAYER = `import psyneulink as pnl

colour = pnl.TransferMechanism(name="colour", input_shapes=2)
hidden = pnl.TransferMechanism(name="hidden", input_shapes=2, function=pnl.Logistic)
response = pnl.TransferMechanism(name="response", input_shapes=2)

comp = pnl.Composition(name="three_layer")
comp.add_linear_processing_pathway([colour, hidden, response])
`;

type Page = import("@playwright/test").Page;

const elementsToggle = (page: Page) => page.getByRole("button", { name: "Elements", exact: true });

/** Open a model by path (a reload doesn't reopen it). */
async function openModel(page: Page, model: string) {
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(canvasNode(page, "hidden").first()).toBeVisible({ timeout: 60_000 });
}

/** The oval's own text and border colour, as drawn. */
async function oval(page: Page, name: string) {
  const node = canvasNode(page, name).first();
  return node.evaluate((n) => {
    const o = Array.from(n.querySelectorAll<HTMLElement>("div")).find((d) => d.style.borderRadius === "50%")!;
    return { text: o.innerText.trim(), border: getComputedStyle(o).borderTopColor };
  });
}

test("node names: just the name by default, Elements brings the details back and is remembered", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "names122-"));
  const model = path.join(dir, "three_layer.py");
  writeFileSync(model, THREE_LAYER);

  await page.goto("/");
  await openModel(page, model);

  // Default: only the name, no tags or function line.
  const hidden = canvasNode(page, "hidden").first();
  await expect(hidden.getByTestId("node-type-tag")).toHaveCount(0);
  await expect(hidden.getByTestId("node-function-line")).toHaveCount(0);
  await expect(page.getByTestId("node-role-tag")).toHaveCount(0);
  for (const name of ["colour", "hidden", "response"]) expect((await oval(page, name)).text).toBe(name);
  // The role still shows in the outline: input and output differ from an
  // internal node.
  const [c, h, r] = [await oval(page, "colour"), await oval(page, "hidden"), await oval(page, "response")];
  expect(c.border).not.toBe(h.border);
  expect(r.border).not.toBe(h.border);

  // Elements brings the details back.
  await elementsToggle(page).click();
  await expect(hidden.getByTestId("node-type-tag")).toHaveText(/transfer/i);
  await expect(hidden.getByTestId("node-function-line")).toHaveText("f: Logistic");
  await expect(canvasNode(page, "colour").first().getByTestId("node-role-tag")).toHaveText(/input/i);

  // Remembered across a reload.
  await page.reload();
  await openModel(page, model);
  await expect(canvasNode(page, "hidden").first().getByTestId("node-function-line")).toHaveText("f: Logistic");

  // And turning it off again is remembered too.
  await elementsToggle(page).click();
  await page.reload();
  await openModel(page, model);
  await expect(canvasNode(page, "hidden").first().getByTestId("node-function-line")).toHaveCount(0);
});
