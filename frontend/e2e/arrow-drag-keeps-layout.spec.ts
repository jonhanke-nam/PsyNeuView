/**
 * Moving an arrow changes that arrow only (#164).
 *
 * Reported on MontagueDayanSejnowski96 with Layout: Auto and ports shown:
 * moving one arrow re-laid out the whole graph. Whatever the gesture —
 * reshaping the arrow's route, moving its end around its node, or letting go
 * of an end over another node — and whatever the layout setting, no node
 * moves. In Auto the first such gesture makes the layout Custom where it
 * stands (edge-shaping-auto-layout.spec.ts covers the line itself).
 *
 * Nor does a reload afterwards. A custom layout lost its arrangement on any
 * load that brought no layout with it (the file saved in another editor, an
 * unsaved edit's preview), and one with nothing saved yet was laid out afresh
 * on every reload: every node moved, and shaped arrows lost their shape.
 */
import { mutatingTest as test, expect } from "./test-base";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

/**
 * Three mechanisms, one projection. `third_mech` starts beside `sender_mech`
 * in the Layered layout; a projection from `sender_mech` to it would put it a
 * rank further on, so re-laying out after one is added moves it.
 */
const MODEL = `import psyneulink as pnl

sender_mech = pnl.TransferMechanism(input_shapes=[3], name='sender_mech')
receiver_mech = pnl.TransferMechanism(input_shapes=[3], name='receiver_mech')
third_mech = pnl.TransferMechanism(input_shapes=[3], name='third_mech')

sender_to_receiver = pnl.MappingProjection(sender=sender_mech, receiver=receiver_mech, name='sender_to_receiver')

arrow_drag = pnl.Composition(name='arrow_drag')
arrow_drag.add_node(sender_mech)
arrow_drag.add_node(receiver_mech)
arrow_drag.add_node(third_mech)
arrow_drag.add_projection(sender_to_receiver)
`;

/** A copy with no saved layout beside it, so it opens in Auto. */
function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arrow-drag-164-"));
  const file = path.join(dir, "arrow_drag.py");
  writeFileSync(file, MODEL);
  return file;
}

async function openModel(page: Page, model: string) {
  await page.addInitScript(() => {
    // Ports shown, as in the report: the arrows' ends get their dots.
    localStorage.setItem("psyneuview.graph.showPorts", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node")).toHaveCount(3, { timeout: 60_000 });
  // The whole graph in view, so every node can be reached.
  await page.getByRole("button", { name: "Fit view" }).click();
}

/** Every node's place on the canvas, by name, in the graph's own coordinates. */
async function positions(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
      const id = (el.dataset.id ?? "").replace(/-\d+$/, "");
      out[id] = el.style.transform;
    });
    return out;
  });
}

/** Wait for the layout to settle (boxes measured, any refit done), then read it. */
async function settled(page: Page): Promise<Record<string, string>> {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await positions(page));
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [300, 300, 300, 500, 500, 1000] })
    .toBe(true);
  return JSON.parse(last);
}

const node = (page: Page, name: string) => page.locator(`.react-flow__node[data-id^="${name}"]`);

/** Press on the middle of the arrow's line and drag sideways. */
async function dragRoute(page: Page) {
  const at = await page.locator(".projection-edge-hit").first().evaluate((el) => {
    const p = el as unknown as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(at.x + 6 * i, at.y + 3 * i);
  await page.mouse.up();
}

/** Grab the dot at one end of the arrow and move it around its node. */
async function dragEnd(page: Page, which: number) {
  const box = (await page.getByTestId("edge-port-dot").nth(which).locator("div").first().boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + 5 * i, y - 2 * i);
  await page.mouse.up();
}

/** Grab the dot at one end of the arrow and let go of it over another node. */
async function dropEndOn(page: Page, which: number, name: string) {
  const dot = (await page.getByTestId("edge-port-dot").nth(which).locator("div").first().boundingBox())!;
  const over = (await node(page, name).boundingBox())!;
  const a = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  const b = { x: over.x + over.width / 2, y: over.y + over.height / 2 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
  await page.mouse.up();
}

/** The drawn line of the arrow from sender_mech to receiver_mech. */
async function firstArrow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll<SVGPathElement>(".react-flow__edge path[data-ends]")).find((el) => {
      const [s, t] = (el.getAttribute("data-ends") ?? "").split("\u0000");
      return s.startsWith("sender_mech") && t.startsWith("receiver_mech");
    });
    return p?.getAttribute("d") ?? null;
  });
}

/** Move a node by hand (Custom only). */
async function dragNode(page: Page, name: string, dx: number, dy: number) {
  const box = (await node(page, name).locator("text=" + name).first().boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
  await page.mouse.up();
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("moving an arrow, in Auto or Custom, moves no node, nor does a reload after (#164)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();
  await openModel(page, model);
  const layout = page.getByRole("button", { name: /^Layout: (Auto|Custom)$/ });
  await expect(layout).toHaveText("Layout: Auto");
  let start = await settled(page);
  expect(Object.keys(start).sort()).toEqual(["receiver_mech", "sender_mech", "third_mech"]);

  // Auto: moving an end of the arrow makes the layout Custom where it stands
  // (#164), shapes the arrow, and leaves every node in place.
  const straight = await firstArrow(page);
  await dragEnd(page, 0);
  await expect(layout).toHaveText("Layout: Custom");
  expect(await settled(page)).toEqual(start);
  expect(await firstArrow(page)).not.toBe(straight);

  // Custom: reshaping the route, moving an end, and letting an end go over
  // another node shape the arrow, and still move no node.
  await dragRoute(page);
  await dragEnd(page, 0);
  await dropEndOn(page, 1, "third_mech");
  expect(await settled(page)).toEqual(start);
  const shaped = await firstArrow(page);
  expect(shaped).not.toBe(straight);

  // One node moved by hand, so the layout has positions saved as well.
  await dragNode(page, "third_mech", 120, 0);
  start = await settled(page);

  // The file saved in another editor, with a projection that would put
  // third_mech a rank further on in a fresh layout, and a new node. The model
  // reloads; the nodes on screen keep their places, and the shaped arrow its
  // shape.
  writeFileSync(
    model,
    readFileSync(model, "utf8") +
      [
        "",
        "sender_to_third = pnl.MappingProjection(sender=sender_mech, receiver=third_mech, name='sender_to_third')",
        "fourth_mech = pnl.TransferMechanism(input_shapes=[3], name='fourth_mech')",
        "arrow_drag.add_projection(sender_to_third)",
        "arrow_drag.add_node(fourth_mech)",
        "",
      ].join("\n"),
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(4, { timeout: 60_000 });
  await expect(page.locator(".projection-edge-hit")).toHaveCount(2, { timeout: 60_000 });
  const after = await settled(page);
  for (const name of Object.keys(start)) expect(after[name], name).toBe(start[name]);
  expect(await firstArrow(page)).toBe(shaped);
});
