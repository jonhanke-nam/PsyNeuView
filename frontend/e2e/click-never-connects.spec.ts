/**
 * A click never adds a connection (#317).
 *
 * Every port dot and every node's connector is a React Flow handle, and React
 * Flow's default `connectOnClick` turned a click on one handle and then a click
 * on another into a projection. The graph-hit-areas sweep, which only clicks
 * inside nodes, sometimes added one to the Stroop model in CI. Only a drag past
 * a few pixels connects now (drag-to-connect*.spec.ts covers the drags).
 *
 * Each case is a pointer sequence that used to connect, or comes close, and
 * must leave the model alone: nothing asked of the server about connecting,
 * and no new arrow.
 */
import { readOnlyTest as test, expect, VIEW_OPTION_IDS } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
c = pnl.ProcessingMechanism(name='c')

comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(c)
`;

function scratch(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "click317-")), "click.py");
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

async function showPorts(page: Page) {
  await page.getByTestId("graph-view-options-button").click();
  const box = page.getByTestId("toolbar-show-ports");
  if (!(await box.isChecked())) await box.click();
  await page.keyboard.press("Escape");
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** The centre of a node's connector (there, and taking the pointer, even unseen). */
async function connectorAt(page: Page, id: string) {
  const b = (await node(page, id).getByTestId("node-connector").boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The centre of one of a node's port dots. */
async function portAt(page: Page, id: string) {
  const dot = node(page, id)
    .locator('.react-flow__handle:not([data-handleid="__connect__"]):not([data-handleid="__node__"])')
    .filter({ visible: true })
    .first();
  await expect(dot).toBeVisible();
  const b = (await dot.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Every request that asks about, or makes, a connection. */
function connectRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/model\/(connection-options|connection-targets|structural-change)$/.test(r.url())) seen.push(r.url());
  });
  return seen;
}

async function click(page: Page, p: { x: number; y: number }, wobble = 0) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  if (wobble) await page.mouse.move(p.x + wobble, p.y + wobble);
  await page.mouse.up();
}

test.describe("a click never connects (#317)", { tag: "@ci" }, () => {
  test("clicks on connectors and port dots, with and without a wobble, add nothing", async ({ page }) => {
    const seen = connectRequests(page);
    const file = scratch();
    await open(page, file);
    await showPorts(page);
    const arrows = await page.locator(".react-flow__edge").count();

    // The old click-to-connect: a click on one handle, then on another.
    await click(page, await connectorAt(page, "a"));
    await click(page, await connectorAt(page, "b"));
    await click(page, await portAt(page, "a"));
    await click(page, await portAt(page, "b"));
    await click(page, await connectorAt(page, "c"));
    await click(page, await portAt(page, "a"));

    // A press that wobbles a few pixels, under the drag threshold, then a
    // click on another node.
    await click(page, await connectorAt(page, "a"), 2);
    await click(page, await portAt(page, "b"), 2);
    const bBox = (await node(page, "b").boundingBox())!;
    await click(page, { x: bBox.x + bBox.width / 2, y: bBox.y + bBox.height / 2 });

    // A press on a's connector let go over c without moving there in steps:
    // one jump is one pointer move, short of a drag only if under the
    // threshold, so keep it within it.
    const ca = await connectorAt(page, "a");
    await page.mouse.move(ca.x, ca.y);
    await page.mouse.down();
    await page.mouse.move(ca.x + 3, ca.y);
    await page.mouse.up();

    await page.waitForTimeout(800);
    expect(seen).toEqual([]);
    await expect(page.locator(".react-flow__edge")).toHaveCount(arrows);
    expect(readFileSync(file, "utf8")).toBe(MODEL);
    // And a click on a port dot still selects its node (#250).
    await click(page, await portAt(page, "c"));
    await expect(node(page, "c")).toHaveClass(/selected/);
  });

  test("clicks on handles while the graph rebuilds add nothing", async ({ page }) => {
    const seen = connectRequests(page);
    const file = scratch();
    await open(page, file);
    await showPorts(page);
    const [a1, b1, a2, b2] = [
      await connectorAt(page, "a"), await connectorAt(page, "b"),
      await portAt(page, "a"), await portAt(page, "b"),
    ];

    // Showing interface nodes reloads the model and rebuilds the graph; click
    // the handles where they were, over and over, while it does.
    await page.getByTestId("graph-view-options-button").click();
    const reloaded = page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST", { timeout: 60_000 });
    await page.getByTestId(VIEW_OPTION_IDS.CIMs).click();
    await page.keyboard.press("Escape");
    for (let i = 0; i < 6; i++) for (const p of [a1, b1, a2, b2]) await click(page, p);
    await reloaded;
    for (const p of [a1, b1, a2, b2]) await click(page, p);
    await expect(page.locator("html.pnv-busy")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(800);

    expect(seen).toEqual([]);
    // (Interface nodes bring arrows of their own, so count nothing; the file
    // says whether a projection was added.)
    expect(readFileSync(file, "utf8")).toBe(MODEL);
  });
});
