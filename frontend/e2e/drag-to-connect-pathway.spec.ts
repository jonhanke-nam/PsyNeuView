/**
 * Drag-to-connect in a model whose nodes are added by a pathway call (#404).
 *
 * The new `comp.add_projection(...)` line used to be written before
 * `comp.add_linear_processing_pathway(...)`, the statement that adds its ends,
 * so the model failed to build. It now goes after it: the model builds and
 * the new arrow appears.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
c = pnl.ProcessingMechanism(name='c')

comp = pnl.Composition(name='comp')
comp.add_linear_processing_pathway([a, b, c])
`;

function scratch(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "connect404-")), "pathway.py");
  writeFileSync(file, MODEL);
  return file;
}

async function open(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node")).toHaveCount(3, { timeout: 60_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** Hover the sender, drag from its connector, drop on the middle of the receiver. */
async function dragConnect(page: Page, from: string, to: string) {
  await node(page, from).hover();
  const connector = node(page, from).getByTestId("node-connector");
  await expect(connector).toHaveCSS("opacity", "1");
  const c = (await connector.boundingBox())!;
  const t = (await node(page, to).boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("drag-to-connect in a pathway-built model (#404)", { tag: "@ci" }, () => {
  test("the new line follows the pathway call; the model builds and the arrow appears", async ({ page }) => {
    const file = scratch();
    let varName = "";
    page.on("request", (r) => {
      if (r.url().endsWith("/api/model/structural-change")) varName = r.postDataJSON()?.changes?.var_name ?? "";
    });
    await open(page, file);
    const edges = await page.locator(".react-flow__edge").count();
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 30_000 });
    await dragConnect(page, "a", "c");
    await done;
    expect(varName).not.toBe("");

    // Written after the statement that adds a and c to the composition.
    const lines = readFileSync(file, "utf8").split("\n");
    const pathway = lines.indexOf("comp.add_linear_processing_pathway([a, b, c])");
    const use = lines.indexOf(`comp.add_projection(${varName})`);
    expect(pathway).toBeGreaterThanOrEqual(0);
    expect(use).toBeGreaterThan(pathway);

    // It builds, with the new arrow in it.
    await expect(page.locator(".react-flow__edge")).toHaveCount(edges + 1, { timeout: 30_000 });
    await expect(page.locator(`.react-flow__edge[data-id*="${varName}"]`)).toHaveCount(1);
    await expect(page.getByText(/broke the model|is not defined/)).toHaveCount(0);
  });
});
