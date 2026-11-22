/**
 * Drag to connect, second part (#253).
 *
 * Ports hidden, as by default:
 *  - a mechanism dropped on a collapsed composition connects into one of its
 *    input nodes, and asks which when there are several;
 *  - while dragging, the nodes the drop would connect light up, the others
 *    dim and, under the pointer, say why;
 *  - Undo removes a connection made by dragging;
 *  - on the Stroop and EGO reference models (copies, so the originals stay
 *    as they are). EGO builds its nodes inside a function, so the file has no
 *    name to connect them by: the drop is refused with that reason.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import { copyFileSync, writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE = path.resolve(__dirname, "..", "..", "backend", "reference_models");

const NESTED = `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')
ctrl = pnl.ControlMechanism(name='ctrl')
x = pnl.ProcessingMechanism(name='x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
y = pnl.ProcessingMechanism(name='y', input_ports=['p', 'q'])
w = pnl.ProcessingMechanism(name='w')
two_in = pnl.Composition(name='two_in', pathways=[[y, w]])

outer = pnl.Composition(name='outer')
outer.add_node(a)
outer.add_node(b)
outer.add_node(ctrl)
outer.add_node(inner)
outer.add_node(two_in)
`;

/** Zoom in around a node, so a small one on a big model can be dragged from. */
async function zoomAt(page: Page, id: string) {
  await expect(async () => {
    const b = (await node(page, id).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -400);
    expect((await node(page, id).boundingBox())!.width).toBeGreaterThan(80);
  }).toPass({ timeout: 30_000 });
}

/** A copy in a fresh temp dir: the drag writes to the file. */
function scratch(name: string, source?: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "connect253b-")), name);
  if (source !== undefined) writeFileSync(file, source);
  else copyFileSync(path.join(REFERENCE, name), file);
  return file;
}

async function open(page: Page, file: string) {
  await page.goto("/");
  await closePalette(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const edges = (page: Page) => page.locator(".react-flow__edge");

/** Start a drag from the sender's connector; returns the pointer, still down. */
async function startDrag(page: Page, from: string) {
  const connector = node(page, from).getByTestId("node-connector");
  // The layout may still be settling after a load: hover until it shows.
  await expect(async () => {
    await node(page, from).hover();
    await expect(connector).toHaveCSS("opacity", "1", { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const c = (await connector.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
}

async function moveOnto(page: Page, to: string) {
  const t = (await node(page, to).boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
}

async function dragConnect(page: Page, from: string, to: string) {
  await startDrag(page, from);
  await moveOnto(page, to);
  await page.mouse.up();
}

const written = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 60_000 });

function structuralChanges(page: Page) {
  const seen: any[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/model/structural-change")) seen.push(r.postDataJSON()?.changes);
  });
  return seen;
}

async function collapse(page: Page, label: string) {
  const button = page.getByTestId("graph-canvas").getByRole("button", { name: `Collapse composition ${label}` });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/model/load"), { timeout: 60_000 }),
    button.click(),
  ]);
  await expect(node(page, label).getByTestId("node-connector")).toHaveCount(1, { timeout: 30_000 });
}

test.describe("drag to connect, second part (#253)", { tag: "@ci" }, () => {
  test("onto a collapsed composition: into its input node", async ({ page }) => {
    const file = scratch("nested.py", NESTED);
    await open(page, file);
    await collapse(page, "inner");
    const before = await edges(page).count();
    const done = written(page);
    await dragConnect(page, "a", "inner");
    await done;
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/pnl\.MappingProjection\(\s*sender=a\.output_ports\[[^\]]+\],\s*receiver=x\.input_ports\[/);
    expect(source).toContain("outer.add_projection(a_to_x)");
    // It builds, and the arrow reaches the collapsed composition.
    await expect(edges(page)).toHaveCount(before + 1, { timeout: 30_000 });
  });

  test("onto a collapsed composition whose input node has two inputs: it asks which", async ({ page }) => {
    const file = scratch("nested.py", NESTED);
    await open(page, file);
    await collapse(page, "two_in");
    await dragConnect(page, "a", "two_in");
    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toBeVisible({ timeout: 30_000 });
    await expect(chooser.getByTestId("port-chooser-option")).toHaveText(["y: p", "y: q"]);
    const done = written(page);
    await chooser.getByRole("menuitem", { name: "y: q" }).click();
    await done;
    expect(readFileSync(file, "utf8")).toContain("receiver=y.input_ports['q']");
  });

  test("while dragging, valid targets light up and an invalid one says why", async ({ page }) => {
    const file = scratch("nested.py", NESTED);
    const changes = structuralChanges(page);
    await open(page, file);
    const shape = (id: string) => node(page, id).locator("[data-node-shape]").first();

    // From a control mechanism nothing can be connected yet: all dim, and
    // the one under the pointer says why. Dropped there: refused, nothing written.
    await startDrag(page, "ctrl");
    await moveOnto(page, "b");
    await expect(shape("b")).toHaveAttribute("data-connect-target", "invalid", { timeout: 30_000 });
    await expect(shape("a")).toHaveAttribute("data-connect-target", "invalid");
    await expect(page.getByTestId("connect-refusal-reason")).toContainText("is a control mechanism");
    await expect(shape("b")).toHaveCSS("opacity", "0.4");
    // The reason sits outside the dimmed node, so it reads at full strength.
    await expect(page.getByTestId("connect-refusal-reason")).toHaveCSS("opacity", "1");
    await page.mouse.up();
    await expect(page.getByText(/is a control mechanism/).first()).toBeVisible({ timeout: 30_000 });
    expect(changes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(NESTED);
    await expect(shape("b")).not.toHaveAttribute("data-connect-target", /.*/);

    // From a: the mechanisms and the compositions it could go into light up.
    await startDrag(page, "a");
    await moveOnto(page, "b");
    await expect(shape("b")).toHaveAttribute("data-connect-target", "valid", { timeout: 30_000 });
    await expect(shape("ctrl")).toHaveAttribute("data-connect-target", "valid");
    await expect(shape("b")).toHaveCSS("outline-style", "solid");
    // The node dragged from stays as it is, and a valid target gives no reason.
    await expect(shape("a")).not.toHaveAttribute("data-connect-target", /.*/);
    await expect(page.getByTestId("connect-refusal-reason")).toHaveCount(0);
    const done = written(page);
    await page.mouse.up();
    await done;
    // Afterwards, nothing is lit or dim.
    await expect(shape("b")).not.toHaveAttribute("data-connect-target", /.*/);
  });

  test("Stroop: connect by dragging, then Undo removes it", async ({ page }) => {
    const file = scratch("stroop_reference_basic.py");
    const original = readFileSync(file, "utf8");
    await open(page, file);
    await expect(node(page, "word_hidden")).toBeVisible();
    const before = await edges(page).count();
    const done = written(page);
    await dragConnect(page, "color_input", "word_hidden");
    await done;
    await expect(edges(page)).toHaveCount(before + 1, { timeout: 30_000 });
    const arrow = page.getByTestId("rf__edge-color_input_to_word_hidden");
    await expect(arrow).toHaveCount(1);
    expect(readFileSync(file, "utf8")).toContain("receiver=word_hidden.input_ports[");

    const undo = page.getByTestId("undo-button");
    await expect(undo).toBeEnabled();
    await undo.click();
    // One Undo removes it. The restored code is previewed, as typing is, and
    // the file waits for Save (#1029), so the check is on the graph.
    await expect(arrow).toHaveCount(0, { timeout: 30_000 });
    await expect(edges(page)).toHaveCount(before, { timeout: 30_000 });
    expect(original).not.toContain("color_input_to_word_hidden");
  });

  test("EGO: a node built inside a function is refused with the reason", async ({ page }) => {
    test.setTimeout(180_000);
    const file = scratch("Giallanza2024_ego_study2.py");
    const original = readFileSync(file, "utf8");
    const changes = structuralChanges(page);
    await open(page, file);
    await expect(node(page, "CONTEXT")).toBeVisible({ timeout: 60_000 });
    await zoomAt(page, "STATE");
    await startDrag(page, "STATE");
    await moveOnto(page, "CONTEXT");
    const target = node(page, "CONTEXT");
    await expect(target.locator("[data-node-shape]").first()).toHaveAttribute("data-connect-target", "invalid", { timeout: 60_000 });
    await expect(target.getByTestId("connect-refusal-reason")).toContainText("inside a function");
    await page.mouse.up();
    await expect(page.getByText(/is made inside a function/).first()).toBeVisible({ timeout: 60_000 });
    expect(changes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});
