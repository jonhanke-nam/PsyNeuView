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
 *   - on every reference model, every point inside every node resolves to it.
 */
import { readOnlyTest as test, expect, closePalette, fitGraph } from "./test-base";
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
});
