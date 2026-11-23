/**
 * A model built in the graph is the model typed as code (#319).
 *
 * For each kind of projection (Mapping, Control, Gating, Learning, and one
 * into a nested composition), the same small model is made twice: once in
 * the graph, placing components with pick-then-place and connecting them by
 * dragging (and the chooser, where it asks), and once written by hand the way
 * a modeller would type it. PsyNeuLink loads both, and
 * backend/tests/model_equivalence.py checks they are the same composition
 * (the same nodes, projections, ports and key parameters) and run to the same
 * results on the same inputs.
 *
 * The hand-written versions say things the way PsyNeuLink's own docs do
 * (`pathways=`, `control=`, `gate=`), not the way the graph writes them, so a
 * difference in what the two mean shows up here.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Page = import("@playwright/test").Page;

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "backend");
const PYTHON = path.join(BACKEND, ".venv", "bin", "python");
const COMPARE = path.join(BACKEND, "tests", "model_equivalence.py");

/** Both files' models, compared in fresh Python processes. */
function compare(built: string, typed: string): { equal: boolean; differences: string[] } {
  try {
    const out = execFileSync(PYTHON, ["-W", "ignore", COMPARE, "compare", built, typed], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return JSON.parse(out.trim().split("\n").pop()!);
  } catch (e: any) {
    // Exit 1 is "they differ": the JSON is still on stdout.
    const out = String(e.stdout ?? "").trim();
    if (out) return JSON.parse(out.split("\n").pop()!);
    throw new Error(`model_equivalence.py failed: ${String(e.stderr ?? e).slice(-2000)}`);
  }
}

/** A model file in a fresh temp folder. */
function scratch(name: string, source: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "equiv319-")), name);
  writeFileSync(file, source);
  return file;
}

async function open(page: Page, file: string, palette = false) {
  await page.goto("/");
  if (!palette) await closePalette(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.getByTestId("graph-canvas").locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const written = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 60_000 });

/** Pick a component in the Components panel, then click an empty spot to put it there. */
async function place(page: Page, type: string, at: { fx: number; fy: number }) {
  await page.getByPlaceholder("Search components…").fill(type);
  const item = page.locator(`[data-testid="palette-item"][data-type="${type}"]`).first();
  await item.click();
  await expect(item).toHaveAttribute("data-armed", "true");
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  const done = written(page);
  await page.mouse.click(pane.x + pane.width * at.fx, pane.y + pane.height * at.fy);
  await done;
  await expect(node(page, `New_${type}_1`)).toBeVisible({ timeout: 30_000 });
}

/** Hover the sender until its connector shows, then drag from it onto the receiver's middle. */
async function dragConnect(page: Page, from: string, to: string) {
  const connector = node(page, from).getByTestId("node-connector");
  await expect(async () => {
    await node(page, from).hover();
    await expect(connector).toHaveCSS("opacity", "1", { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const c = (await connector.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  const t = (await node(page, to).boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** Built in the graph and typed by hand: the same model. */
function expectSame(built: string, typedSource: string) {
  const typed = path.join(path.dirname(built), "typed.py");
  writeFileSync(typed, typedSource);
  const result = compare(built, typed);
  expect(result.differences, `built in the graph:\n${readFileSync(built, "utf8")}`).toEqual([]);
  expect(result.equal).toBe(true);
}

test.describe("built in the graph, typed as code: the same model (#319)", { tag: "@ci" }, () => {
  test("MappingProjection: two mechanisms placed and connected by dragging", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch("mapping.py", "import psyneulink as pnl\n\nseed = pnl.ProcessingMechanism(name='seed')\ncomp = pnl.Composition(name='comp')\ncomp.add_node(seed)\n");
    await open(page, file, true);
    await place(page, "ProcessingMechanism", { fx: 0.25, fy: 0.8 });
    await place(page, "TransferMechanism", { fx: 0.75, fy: 0.25 });
    await closePalette(page);
    const done = written(page);
    await dragConnect(page, "New_ProcessingMechanism_1", "New_TransferMechanism_1");
    await done;

    expectSame(
      file,
      `import psyneulink as pnl

seed = pnl.ProcessingMechanism(name='seed')
New_ProcessingMechanism_1 = pnl.ProcessingMechanism(name='New_ProcessingMechanism_1')
New_TransferMechanism_1 = pnl.TransferMechanism(name='New_TransferMechanism_1')
comp = pnl.Composition(name='comp')
comp.add_node(seed)
comp.add_linear_processing_pathway([New_ProcessingMechanism_1, New_TransferMechanism_1])
`,
    );
  });

  test("ControlProjection: a control mechanism placed, dragged onto a mechanism, gain chosen", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch(
      "control.py",
      "import psyneulink as pnl\n\na = pnl.TransferMechanism(name='a', function=pnl.Logistic)\ncomp = pnl.Composition(name='comp')\ncomp.add_node(a)\n",
    );
    await open(page, file, true);
    await place(page, "ControlMechanism", { fx: 0.75, fy: 0.25 });
    await closePalette(page);
    await dragConnect(page, "New_ControlMechanism_1", "a");
    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toContainText("Control which parameter of a?", { timeout: 30_000 });
    const done = written(page);
    await chooser.getByRole("menuitem", { name: "gain", exact: true }).click();
    await done;

    expectSame(
      file,
      `import psyneulink as pnl

a = pnl.TransferMechanism(name='a', function=pnl.Logistic)
New_ControlMechanism_1 = pnl.ControlMechanism(name='New_ControlMechanism_1', control=[(pnl.GAIN, a)])
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(New_ControlMechanism_1)
`,
    );
  });

  test("GatingProjection: a gating mechanism placed, dragged onto a mechanism, its input chosen", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch(
      "gating.py",
      "import psyneulink as pnl\n\na = pnl.TransferMechanism(name='a')\nb = pnl.TransferMechanism(name='b')\ncomp = pnl.Composition(name='comp', pathways=[[a, b]])\n",
    );
    await open(page, file, true);
    await place(page, "GatingMechanism", { fx: 0.8, fy: 0.5 });
    await closePalette(page);
    await dragConnect(page, "New_GatingMechanism_1", "b");
    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toContainText("Gate which port of b?", { timeout: 30_000 });
    const done = written(page);
    await chooser.getByRole("menuitem", { name: "input: InputPort-0" }).click();
    await done;

    expectSame(
      file,
      `import psyneulink as pnl

a = pnl.TransferMechanism(name='a')
b = pnl.TransferMechanism(name='b')
New_GatingMechanism_1 = pnl.GatingMechanism(name='New_GatingMechanism_1', gate=[b.input_port])
comp = pnl.Composition(name='comp', pathways=[[a, b]])
comp.add_node(New_GatingMechanism_1)
`,
    );
  });

  // A learning mechanism comes from a learning pathway, which the graph doesn't
  // build; the drag is what's compared: onto the arrow it should train.
  test("LearningProjection: a pathway's learning mechanism dropped on another arrow", async ({ page }) => {
    test.setTimeout(150_000);
    const base = `import psyneulink as pnl

a = pnl.TransferMechanism(name='a', input_shapes=2)
b = pnl.TransferMechanism(name='b', input_shapes=2, function=pnl.Logistic)
c = pnl.TransferMechanism(name='c', input_shapes=2)
ab = pnl.MappingProjection(sender=a, receiver=b, name='ab')
ac = pnl.MappingProjection(sender=a, receiver=c, name='ac')
comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(c)
comp.add_projection(ab)
comp.add_projection(ac)
pathway = comp.add_backpropagation_learning_pathway([a, ab, b])
lm = pathway.learning_components[pnl.LEARNING_MECHANISMS][0]
`;
    const file = scratch("learning.py", base);
    await open(page, file);
    const lm = "Learning Mechanism for ab";
    await expect(node(page, lm)).toBeVisible({ timeout: 60_000 });
    const connector = node(page, lm).getByTestId("node-connector");
    await expect(async () => {
      await node(page, lm).hover();
      await expect(connector).toHaveCSS("opacity", "1", { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    const c = (await connector.boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    const at = await page.getByTestId("rf__edge-ac").locator(".projection-edge-hit").evaluate((el) => {
      const p = el as SVGPathElement;
      const mid = p.getPointAtLength(p.getTotalLength() / 2);
      const m = p.getScreenCTM()!;
      return { x: mid.x * m.a + mid.y * m.c + m.e, y: mid.x * m.b + mid.y * m.d + m.f };
    });
    await page.mouse.move(at.x, at.y, { steps: 12 });
    await expect(page.getByTestId("rf__edge-ac").locator(".projection-edge-hit")).toHaveAttribute("data-connect-target", "valid", {
      timeout: 30_000,
    });
    const done = written(page);
    await page.mouse.up();
    await done;

    expectSame(
      file,
      `${base}comp.add_projection(pnl.LearningProjection(sender=lm.output_ports[pnl.LEARNING_SIGNAL], receiver=ac.parameter_ports[pnl.MATRIX]))
`,
    );
  });

  test("into a nested composition: a mechanism dragged onto the folded composition", async ({ page }) => {
    test.setTimeout(150_000);
    const file = scratch(
      "nested.py",
      `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
x = pnl.ProcessingMechanism(name='x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
outer = pnl.Composition(name='outer')
outer.add_node(a)
outer.add_node(inner)
`,
    );
    await open(page, file);
    const fold = page.getByTestId("graph-canvas").getByRole("button", { name: "Collapse composition inner" });
    await Promise.all([page.waitForResponse((r) => r.url().includes("/api/model/load"), { timeout: 60_000 }), fold.click()]);
    await expect(node(page, "inner").getByTestId("node-connector")).toHaveCount(1, { timeout: 30_000 });
    const done = written(page);
    await dragConnect(page, "a", "inner");
    await done;

    expectSame(
      file,
      `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
x = pnl.ProcessingMechanism(name='x')
z = pnl.ProcessingMechanism(name='z')
inner = pnl.Composition(name='inner', pathways=[[x, z]])
outer = pnl.Composition(name='outer', pathways=[[a, inner]])
`,
    );
  });
});
