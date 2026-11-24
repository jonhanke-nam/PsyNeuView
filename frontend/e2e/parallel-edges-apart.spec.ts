/**
 * Two arrows between the same two nodes are drawn apart (#388, #389).
 *
 * Dragging a second connection between nodes that are already connected used
 * to draw the new arrow exactly on top of the old one, so it looked like one
 * arrow. Here d → c is dragged against an existing c → d (the drag that
 * PsyNeuLink allows: a second arrow the same way is refused as "already
 * connected"), and the model's code already has two arrows the same way,
 * a → b into each of b's two input ports. In the Auto, Like show_graph and
 * Custom layouts, each pair must stay a minimum distance apart over most of
 * its length, and each arrow must be selectable on its own.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b', input_ports=['left', 'right'])
c = pnl.ProcessingMechanism(name='c')
d = pnl.ProcessingMechanism(name='d')

comp = pnl.Composition(name='comp')
comp.add_nodes([a, b, c, d])
comp.add_projection(pnl.MappingProjection(sender=a, receiver=b.input_ports['left']), a, b)
comp.add_projection(pnl.MappingProjection(sender=a, receiver=b.input_ports['right']), a, b)
comp.add_projection(pnl.MappingProjection(sender=c, receiver=d), c, d)
`;

/** Arrows must stay at least this far apart (flow px) ... */
const MIN_GAP = 8;
/** ... over at least this share of the middle of their length. */
const MIN_SHARE = 0.8;

function scratch(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "parallel388-")), "parallel.py");
  writeFileSync(file, MODEL);
  return file;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

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

/** The ids of the arrows drawn between two nodes, either way round. */
async function edgesBetween(page: Page, n1: string, n2: string): Promise<string[]> {
  return page.evaluate(([x, y]) => {
    const ids: string[] = [];
    document.querySelectorAll<SVGPathElement>("path.react-flow__edge-path[data-ends]").forEach((p) => {
      const [s, t] = (p.getAttribute("data-ends") || "").split("\u0000");
      if ((s === x && t === y) || (s === y && t === x)) ids.push(p.id);
    });
    return ids.sort();
  }, [n1, n2]);
}

/**
 * The share of the middle 80% of arrow `e1` lying at least MIN_GAP from all of
 * `e2`, and the reverse; the smaller of the two.
 */
async function separatedShare(page: Page, e1: string, e2: string): Promise<number> {
  return page.evaluate(([id1, id2, gap]) => {
    const sample = (id: string, n: number) => {
      const p = document.getElementById(id) as unknown as SVGPathElement;
      const L = p.getTotalLength();
      return Array.from({ length: n + 1 }, (_, i) => p.getPointAtLength((L * i) / n));
    };
    const share = (a: DOMPoint[], b: DOMPoint[]) => {
      const mid = a.slice(Math.floor(a.length * 0.1), Math.ceil(a.length * 0.9));
      const far = mid.filter((pa) => Math.min(...b.map((pb) => Math.hypot(pa.x - pb.x, pa.y - pb.y))) >= (gap as number));
      return far.length / mid.length;
    };
    const p1 = sample(id1 as string, 80), p2 = sample(id2 as string, 80);
    return Math.min(share(p1, p2), share(p2, p1));
  }, [e1, e2, MIN_GAP] as const);
}

/** Click arrow `id` where it is farthest from `other`, and check it alone is selected. */
async function selectsAlone(page: Page, id: string, other: string) {
  const at = await page.evaluate(([mine, theirs]) => {
    const p = document.getElementById(mine) as unknown as SVGPathElement;
    const q = document.getElementById(theirs) as unknown as SVGPathElement;
    const L = p.getTotalLength(), M = q.getTotalLength();
    const qs = Array.from({ length: 61 }, (_, i) => q.getPointAtLength((M * i) / 60));
    let best = p.getPointAtLength(L / 2), bestD = -1;
    for (let i = 15; i <= 45; i++) {
      const pt = p.getPointAtLength((L * i) / 60);
      const d = Math.min(...qs.map((o) => Math.hypot(o.x - pt.x, o.y - pt.y)));
      if (d > bestD) { bestD = d; best = pt; }
    }
    const m = p.getScreenCTM()!;
    return { x: m.a * best.x + m.c * best.y + m.e, y: m.b * best.x + m.d * best.y + m.f };
  }, [id, other]);
  await page.mouse.click(at.x, at.y);
  const hit = (eid: string) => page.locator(`.react-flow__edge[data-id="${eid}"] path.projection-edge-hit`);
  await expect(hit(id)).toHaveAttribute("data-selected", "true");
  await expect(hit(other)).not.toHaveAttribute("data-selected", "true");
}

async function checkPairs(page: Page, layout: string) {
  for (const [n1, n2] of [["a", "b"], ["c", "d"]]) {
    // The whole graph in view, so the click below lands on the canvas.
    await page.keyboard.press("Escape");
    await page.locator(".react-flow__controls-fitview").click();
    const ids = await edgesBetween(page, n1, n2);
    expect(ids, `two arrows between ${n1} and ${n2}`).toHaveLength(2);
    const share = await separatedShare(page, ids[0], ids[1]);
    console.log(`#388 ${layout} ${n1}-${n2}: ${share.toFixed(2)} of the middle at least ${MIN_GAP}px apart`);
    expect.soft(share, `${layout}: ${n1}–${n2} arrows ${MIN_GAP}px apart over most of their length`).toBeGreaterThanOrEqual(MIN_SHARE);
    await selectsAlone(page, ids[0], ids[1]);
    await selectsAlone(page, ids[1], ids[0]);
  }
}

test.describe("a second arrow between connected nodes is drawn apart (#388)", { tag: "@ci" }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test("same and opposite direction, in Auto, Like show_graph and Custom", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, scratch());
    const before = await page.locator(".react-flow__edge").count();

    // d → c, the opposite way to c → d.
    const made2 = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok(), { timeout: 30_000 });
    await dragConnect(page, "d", "c");
    await made2;
    await expect(page.locator(".react-flow__edge")).toHaveCount(before + 1, { timeout: 30_000 });

    const layout = page.locator('select:has(option[value="showgraph"])');
    await layout.selectOption("layered");
    await expect(page.getByText(/^Layout: Auto$/)).toBeVisible({ timeout: 15_000 });
    await checkPairs(page, "Auto");

    await layout.selectOption("showgraph");
    await expect(page.locator(".react-flow__edge path.pnv-edge-showgraph").first()).toBeVisible({ timeout: 30_000 });
    await checkPairs(page, "Like show_graph");

    // Custom, with a node moved by hand: the arrows leave show_graph's
    // courses and are routed as PsyNeuView routes them.
    // Switching reloads the graph: wait for it, so the drag below isn't lost.
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/model/load") && r.ok(), { timeout: 30_000 }),
      page.getByRole("button", { name: /^Layout: Auto$/ }).click(),
    ]);
    await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible({ timeout: 15_000 });
    await page.locator(".react-flow__controls-fitview").click();
    const box = (await node(page, "d").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 160, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator(".react-flow__edge path.pnv-edge-showgraph")).toHaveCount(2);
    await checkPairs(page, "Custom");
  });
});
