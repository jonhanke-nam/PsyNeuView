/**
 * Drag to connect, third part (#253): the type follows the sender.
 *
 * Ports hidden, as by default:
 *  - a control mechanism dropped on a mechanism asks which parameter, writes
 *    a ControlProjection into it, draws the arrow, and one Undo removes it;
 *  - a gating mechanism asks which input or output port, and writes a
 *    GatingProjection into it;
 *  - a learning mechanism is dropped on an arrow: the arrows it could train
 *    light up, the others dim and say why, and the drop writes a
 *    LearningProjection to that arrow's matrix;
 *  - a learning mechanism dropped on a mechanism is refused, with the reason.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import { writeFileSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

a = pnl.TransferMechanism(name='a', input_shapes=2)
b = pnl.TransferMechanism(name='b', input_shapes=2, function=pnl.Logistic)
c = pnl.TransferMechanism(name='c', input_shapes=2)
d = pnl.TransferMechanism(name='d', input_shapes=3)
ctrl = pnl.ControlMechanism(name='ctrl')
gate = pnl.GatingMechanism(name='gate')

ab = pnl.MappingProjection(sender=a, receiver=b, name='ab')
ac = pnl.MappingProjection(sender=a, receiver=c, name='ac')
ad = pnl.MappingProjection(sender=a, receiver=d, name='ad')

comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
comp.add_node(c)
comp.add_node(d)
comp.add_node(ctrl)
comp.add_node(gate)
comp.add_projection(ab)
comp.add_projection(ac)
comp.add_projection(ad)
pathway = comp.add_backpropagation_learning_pathway([a, ab, b])
lm = pathway.learning_components[pnl.LEARNING_MECHANISMS][0]
`;

/** The canvas knows the pathway's learning mechanism by its PsyNeuLink name. */
const LM = "Learning Mechanism for ab";

function scratch(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "connect253c-")), "modulatory.py");
  writeFileSync(file, MODEL);
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
  await expect(node(page, LM)).toBeVisible({ timeout: 90_000 });
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const shape = (page: Page, id: string) => node(page, id).locator("[data-node-shape]").first();
const arrowHit = (page: Page, id: string) => page.getByTestId(`rf__edge-${id}`).locator(".projection-edge-hit");

/** Start a drag from the sender's connector; the pointer stays down. */
async function startDrag(page: Page, from: string) {
  const connector = node(page, from).getByTestId("node-connector");
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

/** Onto the middle of an arrow, measured along its drawn path. */
async function moveOntoArrow(page: Page, id: string) {
  const at = await page.getByTestId(`rf__edge-${id}`).locator(".projection-edge-hit").evaluate((el) => {
    const p = el as SVGPathElement;
    const mid = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: mid.x * m.a + mid.y * m.c + m.e, y: mid.x * m.b + mid.y * m.d + m.f };
  });
  await page.mouse.move(at.x, at.y, { steps: 12 });
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

/** The running animation on a node's halo (its ::after), or "none". */
const haloAnimation = (page: Page, id: string) =>
  shape(page, id).evaluate((el) => getComputedStyle(el, "::after").animationName);

test.describe("drag to connect, third part: the type follows the sender (#253)", { tag: "@ci" }, () => {
  test("valid targets pulse; the one under the pointer holds steady; Reduce Motion stops the pulse", async ({ page }) => {
    await open(page, scratch());
    await startDrag(page, "ctrl");
    await moveOnto(page, "b");
    await expect(shape(page, "b")).toHaveClass(/pnv-connect-locked/, { timeout: 30_000 });
    // Not the selection's ring: a halo, pulsing on the others, steady here.
    await expect(shape(page, "a")).toHaveClass(/pnv-connect-target/);
    expect(await haloAnimation(page, "a")).toBe("pnv-connect-pulse");
    expect(await haloAnimation(page, "b")).toBe("none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await haloAnimation(page, "a")).toBe("none");
    await page.mouse.up();
    await page.keyboard.press("Escape");
  });


  test("a control mechanism asks which parameter, draws the arrow, and Undo removes it", async ({ page }) => {
    const file = scratch();
    await open(page, file);
    const edges = page.locator(".react-flow__edge");
    const before = await edges.count();

    await startDrag(page, "ctrl");
    await moveOnto(page, "b");
    await expect(shape(page, "b")).toHaveAttribute("data-connect-target", "valid", { timeout: 30_000 });
    // The arrow being drawn is a real arrow, in the drop-target colour.
    await expect(page.getByTestId("connect-rubber-band").locator("polygon")).toHaveCount(1);
    // The named learning mechanism's learning rate can be controlled too.
    await expect(shape(page, LM)).toHaveAttribute("data-connect-target", "valid");
    await page.mouse.up();

    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toContainText("Control which parameter of b?", { timeout: 30_000 });
    await expect(chooser.getByRole("menuitem", { name: "gain", exact: true })).toBeVisible();
    const done = written(page);
    await chooser.getByRole("menuitem", { name: "gain", exact: true }).click();
    await done;

    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/ctrl_controls_b_gain = pnl\.ControlProjection\(\s*sender=ctrl,\s*receiver=b\.parameter_ports\['gain'\]/);
    expect(source).toContain("comp.add_projection(ctrl_controls_b_gain)");
    // It builds, and the arrow is drawn.
    await expect(edges).toHaveCount(before + 1, { timeout: 30_000 });

    // One Undo removes it.
    const undo = page.getByTestId("undo-button");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(edges).toHaveCount(before, { timeout: 30_000 });
  });

  test("a gating mechanism asks which input or output port", async ({ page }) => {
    const file = scratch();
    await open(page, file);
    await startDrag(page, "gate");
    await moveOnto(page, "c");
    await page.mouse.up();
    const chooser = page.getByTestId("port-chooser");
    await expect(chooser).toContainText("Gate which port of c?", { timeout: 30_000 });
    await expect(chooser.getByTestId("port-chooser-option")).toHaveText(["input: InputPort-0", "output: RESULT"]);
    const done = written(page);
    await chooser.getByRole("menuitem", { name: "output: RESULT" }).click();
    await done;
    expect(readFileSync(file, "utf8")).toMatch(/pnl\.GatingProjection\(\s*sender=gate,\s*receiver=c\.output_ports\['RESULT'\]/);
  });

  test("a learning mechanism lights up the arrows it could train, and trains the one it's dropped on", async ({ page }) => {
    const file = scratch();
    const changes = structuralChanges(page);
    await open(page, file);

    // On a mechanism: refused, with the reason, under the pointer.
    await startDrag(page, LM);
    await moveOnto(page, "c");
    await expect(shape(page, "c")).toHaveAttribute("data-connect-target", "invalid", { timeout: 30_000 });
    await expect(node(page, "c").getByTestId("connect-refusal-reason")).toContainText("on an arrow");
    // The arrows: ac can be trained; ad's matrix is another shape; ab it trains already.
    await expect(arrowHit(page, "ac")).toHaveAttribute("data-connect-target", "valid");
    await expect(arrowHit(page, "ad")).toHaveAttribute("data-connect-target", "invalid");
    await expect(arrowHit(page, "ab")).toHaveAttribute("data-connect-target", "invalid");
    await moveOntoArrow(page, "ad");
    await expect(page.getByTestId("connect-refusal-reason")).toContainText("same shape");
    await page.mouse.up();
    await expect(page.getByText(/same shape/).first()).toBeVisible({ timeout: 30_000 });
    expect(changes).toEqual([]);

    // On ac: a LearningProjection to its matrix.
    await startDrag(page, LM);
    await moveOntoArrow(page, "ac");
    await expect(arrowHit(page, "ac")).toHaveAttribute("data-connect-target", "valid", { timeout: 30_000 });
    const done = written(page);
    await page.mouse.up();
    await done;
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/lm_learns_ac = pnl\.LearningProjection\(\s*sender=lm\.output_ports\['LearningSignal'\],\s*receiver=ac\.parameter_ports\['matrix'\]/);
    // Declared after `lm`, and added to the composition after that.
    expect(source.indexOf("lm = pathway")).toBeLessThan(source.indexOf("lm_learns_ac = pnl"));
    expect(source.indexOf("lm_learns_ac = pnl")).toBeLessThan(source.indexOf("comp.add_projection(lm_learns_ac)"));
  });
});
