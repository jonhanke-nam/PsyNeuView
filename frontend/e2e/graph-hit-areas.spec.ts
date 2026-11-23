/**
 * Anywhere in or on a node registers a click on it (#250).
 *
 * The rule: a node's active region is its whole drawn shape (fill, outline,
 * label, whitespace). What sits over its rim must hand a click on to it. With
 * ports shown, an arrow's connection dot sits half inside the node, above it,
 * and a click there used to do nothing; a click that wobbled a pixel even
 * reshaped the arrow and made the layout Custom.
 *
 *   - real clicks at points across every Stroop node select it, ports hidden or shown;
 *   - a click on a connection dot selects its node and leaves the layout Auto;
 *     a drag on it still shapes the arrow;
 *   - on every reference model, every point inside every node resolves to it;
 *   - and (#250's sweep) on every reference model, with interface nodes
 *     shown, at the fitted zoom, zoomed out and zoomed in: every node and
 *     interface node, every arrow along its line, and every open frame (its
 *     header is the frame; its inside is not).
 */
import { readOnlyTest as test, expect, closePalette, fitGraph, VIEW_OPTION_IDS } from "./test-base";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { fixturePath } from "./fixtures";
import path from "path";

type Page = import("@playwright/test").Page;

const MODELS_DIR = path.resolve(import.meta.dirname, "../../backend/reference_models");
const MODELS = readdirSync(MODELS_DIR).filter((f) => f.endsWith(".py")).sort();

/** Points inside an oval, as fractions of its half-width and half-height. */
const POINTS: { a: number; t: number }[] = [{ a: 0, t: 0 }];
for (const a of [0.5, 0.8]) for (let k = 0; k < 8; k++) POINTS.push({ a, t: (k / 8) * 2 * Math.PI });

/** A writable copy of the two-node test model, which opens in Auto. */
function scratchTwoNodes(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hit250-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, readFileSync(fixturePath("two_mech_projection"), "utf8"));
  return file;
}

async function openModel(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.isAbsolute(file) ? file : path.join(MODELS_DIR, file));
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
  await closePalette(page);
}

async function showPorts(page: Page, on: boolean) {
  await page.getByTestId("graph-view-options-button").click();
  const box = page.getByTestId("toolbar-show-ports");
  if ((await box.isChecked()) !== on) await box.click();
  await page.keyboard.press("Escape");
}

const layoutIsAuto = (page: Page) => page.getByRole("button", { name: /^Layout: Auto$/ });

test.describe("graph hit areas (#250)", { tag: "@ci" }, () => {
  for (const ports of [false, true]) {
    test(`a click anywhere in a node selects it (ports ${ports ? "shown" : "hidden"})`, async ({ page }) => {
      test.setTimeout(180_000);
      await openModel(page, "stroop_reference_basic.py");
      if (ports) await showPorts(page, true);
      await fitGraph(page);
      await page.waitForTimeout(600);
      const pane = page.locator(".react-flow__pane");
      const ids = await page.locator(".react-flow__node-mechanismNode").evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id!));
      expect(ids.length).toBeGreaterThan(3);
      const misses: string[] = [];
      for (const id of ids) {
        const node = page.locator(`.react-flow__node[data-id="${id}"]`);
        const b = (await node.boundingBox())!;
        for (const { a, t } of POINTS) {
          await pane.click({ position: { x: 4, y: 4 } });
          await page.mouse.click(b.x + b.width / 2 + (b.width / 2) * a * Math.cos(t), b.y + b.height / 2 + (b.height / 2) * a * Math.sin(t));
          if (!(await node.evaluate((n) => n.classList.contains("selected")))) misses.push(`${id} ${a}@${Math.round((t * 180) / Math.PI)}°`);
        }
      }
      expect(misses).toEqual([]);
    });
  }

  test("a connection dot: a click selects its node, a drag shapes the arrow", async ({ page }) => {
    await openModel(page, scratchTwoNodes());
    await showPorts(page, true);
    await fitGraph(page);
    await page.waitForTimeout(600);
    await expect(layoutIsAuto(page)).toBeVisible();
    // A dot at the receiving node's rim: the arrow's input end.
    const target = page.locator('.react-flow__node[data-id="receiver_mech"]');
    const tb = (await target.boundingBox())!;
    const dots = await page.locator('[data-testid="edge-port-dot"] .graph-control-point').all();
    // The dot whose centre is nearest the node's rim (it sits on it).
    let dot: { x: number; y: number; width: number; height: number } | null = null;
    let best = Infinity;
    for (const d of dots) {
      const db = (await d.boundingBox())!;
      const cx = db.x + db.width / 2, cy = db.y + db.height / 2;
      const dx = Math.max(tb.x - cx, 0, cx - (tb.x + tb.width));
      const dy = Math.max(tb.y - cy, 0, cy - (tb.y + tb.height));
      const off = Math.hypot(dx, dy);
      if (off < best) { best = off; dot = db; }
    }
    expect(best, "a connection dot on the node's rim").toBeLessThan(6);
    expect(dot, "a connection dot on the receiving node's rim").not.toBeNull();
    const x = dot!.x + dot!.width / 2, y = dot!.y + dot!.height / 2;

    // A click with a pixel's wobble: the node is selected, nothing reshaped.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();
    await expect(target).toHaveClass(/selected/);
    await expect(layoutIsAuto(page)).toBeVisible();

    // A real drag still shapes the arrow (and, in Auto, the layout becomes Custom).
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 10, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible();
  });

  for (const file of MODELS) {
    test(`every point inside every node resolves to it: ${file}`, async ({ page }) => {
      test.setTimeout(180_000);
      await openModel(page, file);
      const problems: string[] = [];
      for (const ports of [false, true]) {
        if (ports) await showPorts(page, true);
        await fitGraph(page);
        await page.waitForTimeout(600);
        const found = await page.evaluate(({ points, ports }) => {
          const out: string[] = [];
          const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
          for (const node of Array.from(document.querySelectorAll(".react-flow__node-mechanismNode")) as HTMLElement[]) {
            const b = node.getBoundingClientRect();
            const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
            for (const { a, t } of points) {
              const x = cx + (b.width / 2) * a * Math.cos(t), y = cy + (b.height / 2) * a * Math.sin(t);
              if (x < pane.left + 2 || x > pane.right - 2 || y < pane.top + 2 || y > pane.bottom - 2) continue;
              const hit = document.elementFromPoint(x, y) as HTMLElement | null;
              if (hit?.closest(".react-flow__node") === node) continue;
              // A connection dot over the rim hands its click on to the node.
              if (hit?.closest('[data-testid="edge-port-dot"]')) continue;
              out.push(`${ports ? "ports" : "plain"} ${node.dataset.id} ${a}@${Math.round((t * 180) / Math.PI)}°: ${hit?.tagName.toLowerCase()}.${(hit?.getAttribute("class") || "").split(" ")[0]}`);
            }
          }
          return out;
        }, { points: POINTS, ports });
        problems.push(...found);
      }
      expect(problems).toEqual([]);
    });
  }

  for (const file of MODELS) {
    test(`the sweep, at three zooms with interface nodes: ${file}`, async ({ page }) => {
      test.setTimeout(240_000);
      await openModel(page, file);
      await page.getByTestId("graph-view-options-button").click();
      const cims = page.getByTestId(VIEW_OPTION_IDS.CIMs);
      if (!(await cims.isChecked())) {
        // Showing interface nodes reloads the model (POST /api/model/load),
        // about 3 s on a CI runner. Sweep only once that has landed and the
        // graph has settled: a sweep that overlaps it samples nodes React Flow
        // has just remounted, hidden until measured, and every point falls
        // through to the pane.
        const reloaded = page.waitForResponse((r) => r.url().includes("/api/model/load") && r.request().method() === "POST", { timeout: 60_000 });
        await cims.click();
        await reloaded;
      }
      await page.keyboard.press("Escape");
      await expect(page.locator(".react-flow__node-cimNode").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("html.pnv-busy")).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(800);
      const problems: string[] = [];
      for (const zoom of ["fit", "out", "in"] as const) {
        await fitGraph(page);
        await page.waitForTimeout(400);
        const button = zoom === "out" ? ".react-flow__controls-zoomout" : ".react-flow__controls-zoomin";
        if (zoom !== "fit") for (let i = 0; i < 3; i++) await page.locator(button).click();
        await page.waitForTimeout(400);
        problems.push(...(await page.evaluate(({ points, zoom }) => {
          const out: string[] = [];
          const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
          // Clear of the canvas's edge, where a panel divider legitimately sits on top.
          const inPane = (x: number, y: number) => x > pane.left + 10 && x < pane.right - 10 && y > pane.top + 10 && y < pane.bottom - 10;
          const describe = (h: Element | null) => `${h?.tagName.toLowerCase()}.${(h?.getAttribute("class") || "").split(" ")[0]}`;
          // Nodes and interface nodes: every point inside resolves to the node.
          for (const node of Array.from(document.querySelectorAll(".react-flow__node-mechanismNode, .react-flow__node-cimNode")) as HTMLElement[]) {
            const b = node.getBoundingClientRect();
            if (b.width < 4) continue;
            for (const { a, t } of points) {
              const x = b.left + b.width / 2 + (b.width / 2) * a * Math.cos(t), y = b.top + b.height / 2 + (b.height / 2) * a * Math.sin(t);
              if (!inPane(x, y)) continue;
              const hit = document.elementFromPoint(x, y);
              if (hit?.closest(".react-flow__node") === node || hit?.closest('[data-testid="edge-port-dot"]')) continue;
              out.push(`${zoom} node ${node.dataset.id} ${a}@${Math.round((t * 180) / Math.PI)}°: ${describe(hit)}`);
            }
            // And, on a fine grid over the whole oval, no arrow's grab strip is
            // stacked above the node — whether or not it is the top element at
            // a sample point on this machine (CI's fonts lay the graph out a
            // little differently; an arrow into a nested node once sat above
            // every top-level node).
            grid: for (let gx = -0.9; gx <= 0.91; gx += 0.15) for (let gy = -0.9; gy <= 0.91; gy += 0.15) {
              if (gx * gx + gy * gy > 0.81) continue;
              const x = b.left + (b.width / 2) * (1 + gx), y = b.top + (b.height / 2) * (1 + gy);
              if (!inPane(x, y)) continue;
              const stack = document.elementsFromPoint(x, y);
              const at = stack.findIndex((e) => e.closest(".react-flow__node") === node);
              const over = stack.slice(0, Math.max(0, at)).find((e) => e.classList.contains("projection-edge-hit"));
              if (over) { out.push(`${zoom} node ${node.dataset.id}: under arrow ${over.closest(".react-flow__edge")?.getAttribute("data-id")}`); break grid; }
            }
          }
          // Arrows: a point on the line is an arrow (where two cross, the top one), never canvas or a frame.
          for (const edge of Array.from(document.querySelectorAll(".react-flow__edge-projectionEdge")) as HTMLElement[]) {
            const path = edge.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
            const m = path?.getScreenCTM();
            if (!path || !m) continue;
            for (const f of [0.3, 0.5, 0.7]) {
              const pt = path.getPointAtLength(path.getTotalLength() * f);
              const x = m.a * pt.x + m.c * pt.y + m.e, y = m.b * pt.x + m.d * pt.y + m.f;
              if (!inPane(x, y)) continue;
              const hit = document.elementFromPoint(x, y);
              if (hit?.closest(".react-flow__edge, .react-flow__edgelabel-renderer, .react-flow__node-mechanismNode, .react-flow__node-cimNode")) continue;
              out.push(`${zoom} arrow ${edge.dataset.id} at ${f}: ${describe(hit)}${hit?.closest(".react-flow__node-compositionNode") ? " (a frame)" : ""}`);
            }
          }
          // Open frames: the header is the frame; the inside is not.
          for (const frame of Array.from(document.querySelectorAll(".react-flow__node-compositionNode")) as HTMLElement[]) {
            const b = frame.getBoundingClientRect();
            if (b.width < 60 || b.height < 60) continue;
            // The header band, at whatever zoom (it scales with the graph).
            const band = (frame.querySelector(".pnv-frame-grab") as HTMLElement).getBoundingClientRect();
            const header = { x: band.left + Math.min(20, band.width * 0.1), y: band.top + band.height / 2 };
            if (inPane(header.x, header.y) && document.elementFromPoint(header.x, header.y)?.closest(".react-flow__node") !== frame) {
              const h = document.elementFromPoint(header.x, header.y);
              if (!h?.closest(".react-flow__node-mechanismNode, .react-flow__node-cimNode, .react-flow__edge")) out.push(`${zoom} frame ${frame.dataset.id} header: ${describe(h)}`);
            }
            for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.6], [0.8, 0.6], [0.5, 0.85]]) {
              const x = b.left + b.width * fx, y = b.top + b.height * fy;
              if (!inPane(x, y)) continue;
              if (document.elementFromPoint(x, y)?.closest(".react-flow__node") === frame) out.push(`${zoom} frame ${frame.dataset.id} inside ${fx},${fy}: the frame took it`);
            }
          }
          return out;
        }, { points: POINTS, zoom })));
      }
      expect(problems).toEqual([]);
    });
  }
});

