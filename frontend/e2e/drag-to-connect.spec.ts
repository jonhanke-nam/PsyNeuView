/**
 * Draw a projection by dragging from one node to another (#253, stage 1).
 *
 * Ports hidden, as by default: drag from a node's connector (shown on hover,
 * on its output side) to anywhere on another node. PsyNeuLink is asked what
 * that connects: a MappingProjection, into the input port chosen when there
 * are several; a control, gating or learning sender is refused with a reason
 * until stage 2.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
two = pnl.ProcessingMechanism(name='two', input_ports=['left', 'right'])
ctrl = pnl.ControlMechanism(name='ctrl')

comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(two)
comp.add_node(ctrl)
`;

function scratch(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "connect253-")), "connect.py");
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
  await expect(page.locator(".react-flow__node")).toHaveCount(4, { timeout: 60_000 });
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

function structuralChanges(page: Page) {
  const seen: any[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/model/structural-change")) seen.push(r.postDataJSON()?.changes);
  });
  return seen;
}

test.describe("drag from one node to another to connect them (#253)", { tag: "@ci" }, () => {
  test("a to b: a MappingProjection, with ports hidden", async ({ page }) => {
    const file = scratch();
    const changes = structuralChanges(page);
    await open(page, file);
    const edges = await page.locator(".react-flow__edge").count();
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 30_000 });
    await dragConnect(page, "a", "b");
    await done;
    await expect(page.locator(".react-flow__edge")).toHaveCount(edges + 1, { timeout: 30_000 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ action: "add_projection", sender: "a", receiver: "b", type: "MappingProjection" });
    expect(readFileSync(file, "utf8")).toMatch(/pnl\.MappingProjection\(\s*sender=a\.output_ports\[/);
    // It builds: no "not defined" from a declaration placed after its use.
    await expect(page.getByText(/is not defined/)).toHaveCount(0);
  });

  test("into a node with several inputs: it asks which", async ({ page }) => {
    const file = scratch();
    await open(page, file);
    const edges = await page.locator(".react-flow__edge").count();
    await dragConnect(page, "a", "two");
    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toBeVisible({ timeout: 30_000 });
    await expect(chooser.getByTestId("port-chooser-option")).toHaveText(["left", "right"]);
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 30_000 });
    await chooser.getByRole("menuitem", { name: "right" }).click();
    await done;
    expect(readFileSync(file, "utf8")).toContain("receiver=two.input_ports['right']");
    // Made, not just written: the model builds with the new arrow in it.
    await expect(page.locator(".react-flow__edge")).toHaveCount(edges + 1, { timeout: 30_000 });
  });

  test("from a control mechanism: refused, with the reason, and nothing written", async ({ page }) => {
    const file = scratch();
    const changes = structuralChanges(page);
    await open(page, file);
    await dragConnect(page, "ctrl", "a");
    await expect(page.getByText(/is a control mechanism/).first()).toBeVisible({ timeout: 30_000 });
    expect(changes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(MODEL);
  });

  test("a plain click on a node still selects it", async ({ page }) => {
    await open(page, scratch());
    await node(page, "b").click();
    await expect(node(page, "b")).toHaveClass(/selected/);
  });
});
