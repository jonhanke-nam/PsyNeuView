/**
 * Node text in proportion to show_graph (#210).
 *
 * A node showing just its name is the size show_graph draws it, not the
 * 170 by 80 slot it used to fill, so the same graph fitted to the same window
 * has text about show_graph's size. Measured as drawn, with show_graph's own
 * sizes from Graphviz (here in the browser test's own process: CI's browser
 * machine has no Graphviz program, and doesn't need one for this).
 *
 * Also checked: every name stays inside its node's innermost outline, at the
 * default width and the heaviest; no two nodes overlap; a frame's header stays
 * clear of its members; selecting a node doesn't resize it; and the app's Text
 * size setting leaves the canvas alone.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..", "..", "backend");
const EGO = path.join(BACKEND, "reference_models", "Giallanza2024_ego_study2.py");
const STROOP = path.join(BACKEND, "demos", "stroop_basic.py");
const NESTED = path.join(BACKEND, "demos", "nested_compositions.py");
const DOUBLE_OUTLINES = path.join(BACKEND, "reference_models", "Kalanthroff_PCTC_2018.py");

/** Open a model and return the description show_graph draws, once placed. */
async function open(page: Page, file: string): Promise<string> {
  const described = page.waitForResponse(
    (r) => r.url().includes("/api/model/show-graph") && r.request().method() === "POST" && r.ok(),
    { timeout: 90_000 },
  );
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  const dot = ((await (await described).json()) as { dot?: string }).dot;
  expect(dot, "show_graph's description").toBeTruthy();
  await expect(page.locator(".react-flow__node-mechanismNode").first()).toBeVisible({ timeout: 60_000 });
  return dot!;
}

/** Use the model's automatic Like show_graph layout, whatever it shipped with. */
async function likeShowGraph(page: Page) {
  const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
  if (await custom.isVisible().catch(() => false)) await custom.click();
  const layout = page.locator("select").filter({ has: page.locator("option", { hasText: "Like show_graph" }) }).first();
  await expect(layout).toHaveValue("showgraph");
}

/** Fit, then wait until the nodes stop moving. */
async function fitAndSettle(page: Page) {
  const read = () =>
    page.locator(".react-flow__node").evaluateAll((els) =>
      JSON.stringify(els.map((e) => [e.getAttribute("data-id"), (e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight, (e as HTMLElement).style.transform])),
    );
  await expect
    .poll(async () => {
      const a = await read();
      await page.waitForTimeout(500);
      return a === (await read());
    }, { timeout: 30_000 })
    .toBe(true);
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(600);
}

/** What is drawn on the canvas now, in the graph's own units unless it says screen. */
function measure(page: Page) {
  return page.evaluate(() => {
    const vp = document.querySelector<HTMLElement>(".react-flow__viewport")!;
    const zoom = Number(/scale\(([\d.e-]+)\)/.exec(vp.style.transform)![1]);
    const notFitting: string[] = [];
    const overlaps: string[] = [];
    const insideHeader: string[] = [];
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node-mechanismNode")];
    const sizes = nodes.map((el) => {
      const id = el.getAttribute("data-id")!;
      const shapeEl = el.querySelector<HTMLElement>("[data-node-shape]")!;
      const nameEl = el.querySelector<HTMLElement>("[data-testid=node-name]")!;
      const n = nameEl.getBoundingClientRect();
      const s = shapeEl.getBoundingClientRect();
      const corners: [number, number][] = [[n.left, n.top], [n.right, n.top], [n.left, n.bottom], [n.right, n.bottom]];
      const svg = shapeEl.querySelector("[data-testid=node-shape-outline]");
      const line = svg?.querySelector<SVGGeometryElement>("[data-outline=inner]") ?? svg?.querySelector<SVGGeometryElement>("[data-outline=outer]");
      let fits: boolean;
      if (line) {
        const toSvg = line.getScreenCTM()!.inverse();
        fits = corners.every(([x, y]) => {
          const p = new DOMPoint(x, y).matrixTransform(toSvg);
          return line.isPointInFill(p) && !line.isPointInStroke(p);
        });
      } else if (shapeEl.getAttribute("data-node-shape") === "rectangle") {
        fits = n.left >= s.left && n.right <= s.right && n.top >= s.top && n.bottom <= s.bottom;
      } else {
        const border = parseFloat(getComputedStyle(shapeEl).borderTopWidth) * zoom;
        const rx = s.width / 2 - border, ry = s.height / 2 - border;
        const cx = s.left + s.width / 2, cy = s.top + s.height / 2;
        fits = corners.every(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0001);
      }
      if (!fits) notFitting.push(id);
      return { id, h: el.offsetHeight, box: el.getBoundingClientRect(), font: parseFloat(getComputedStyle(nameEl).fontSize) };
    });
    for (let i = 0; i < sizes.length; i++) {
      for (let j = i + 1; j < sizes.length; j++) {
        const [a, b] = [sizes[i].box, sizes[j].box];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${sizes[i].id} / ${sizes[j].id}`);
      }
    }
    for (const frame of document.querySelectorAll<HTMLElement>(".react-flow__node-compositionNode")) {
      const f = frame.getBoundingClientRect();
      const headerBottom = f.top + 29 * zoom; // the frame's name, its top row
      for (const m of sizes) {
        if (m.box.left >= f.left && m.box.right <= f.right && m.box.top >= f.top && m.box.top < headerBottom) insideHeader.push(m.id);
      }
    }
    const canvas = document.querySelector("[data-testid=graph-canvas] .react-flow")!.getBoundingClientRect();
    const all = [...document.querySelectorAll(".react-flow__node")].map((e) => e.getBoundingClientRect());
    return {
      zoom,
      font: sizes[0].font,
      textOnScreen: sizes[0].font * zoom,
      fontOverNodeHeight: sizes.reduce((t, s) => t + s.font / s.h, 0) / sizes.length,
      graphHeight: (Math.max(...all.map((r) => r.bottom)) - Math.min(...all.map((r) => r.top))) / zoom,
      canvas: { width: canvas.width, height: canvas.height },
      notFitting, overlaps, insideHeader,
    };
  });
}

/** show_graph's text on screen, fitted to the same canvas by the same rule as Fit. */
async function showGraphText(dot: string, canvas: { width: number; height: number }) {
  const gv = await Graphviz.load();
  const json = JSON.parse(gv.layout(dot, "json", "dot"));
  const [, , w, h] = String(json.bb).split(",").map(Number);
  const font = Number(/node \[[^\]]*fontsize=(\d+)/.exec(dot)?.[1] ?? 14);
  return { font, onScreen: font * Math.min((canvas.width * 0.9) / w, (canvas.height * 0.9) / h, 2) };
}

test.describe("node text in proportion to show_graph (#210)", { tag: "@ci" }, () => {
  test.beforeEach(async ({ page }) => {
    // The suite keeps Layered (test-base); this is about the default.
    await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await closePalette(page);
  });

  test("EGO: fitted to the same window, its text is about show_graph's size", async ({ page }) => {
    test.setTimeout(240_000);
    const dot = await open(page, EGO);
    await likeShowGraph(page);
    await fitAndSettle(page);
    const m = await measure(page);
    const sg = await showGraphText(dot, m.canvas);
    console.log(`EGO: text at Fit ${m.textOnScreen.toFixed(1)}px, show_graph ${sg.onScreen.toFixed(1)}px; font/node height ${m.fontOverNodeHeight.toFixed(3)}`);
    // Was 4.9 px against show_graph's 7.0.
    expect(m.textOnScreen).toBeGreaterThanOrEqual(sg.onScreen * 0.9);
    expect(m.textOnScreen).toBeLessThanOrEqual(sg.onScreen * 1.4);
    // Was 0.175; show_graph's is 12 / 36 = 0.333.
    expect(m.fontOverNodeHeight).toBeGreaterThan(0.28);
    expect(m.fontOverNodeHeight).toBeLessThan(0.42);
    expect(m.notFitting, "names outside their outline").toEqual([]);
    expect(m.overlaps, "nodes on top of each other").toEqual([]);
    expect(m.insideHeader, "nodes reaching into a frame's header").toEqual([]);
  });

  test("a small model and a nested one keep the proportion, and fit", async ({ page }) => {
    test.setTimeout(240_000);
    for (const file of [STROOP, NESTED]) {
      await open(page, file);
      await likeShowGraph(page);
      await fitAndSettle(page);
      const m = await measure(page);
      const where = path.basename(file);
      expect(m.fontOverNodeHeight, where).toBeGreaterThan(0.28);
      expect(m.fontOverNodeHeight, where).toBeLessThan(0.42);
      expect(m.notFitting, where).toEqual([]);
      expect(m.overlaps, where).toEqual([]);
      expect(m.insideHeader, where).toEqual([]);
    }
  });

  test("a double outline holds its name at the heaviest width; selecting and Text size don't resize a node", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, DOUBLE_OUTLINES);
    await likeShowGraph(page);
    await fitAndSettle(page);
    expect((await measure(page)).notFitting, "at the default width").toEqual([]);

    const response = page.locator('.react-flow__node-mechanismNode[data-id="RESPONSE_LAYER"]');
    const before = await response.evaluate((e) => [(e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight]);
    await response.click();
    await expect(response).toHaveClass(/\bselected\b/);
    expect(await response.evaluate((e) => [(e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight]), "selecting resizes").toEqual(before);

    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    await page.getByTestId("setting-text-size").selectOption("large");
    expect(await response.evaluate((e) => [(e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight]), "Text size resizes a node").toEqual(before);
    await page.getByTestId("setting-text-size").selectOption("default");

    await page.getByTestId("setting-node-outline").selectOption("6");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toBeHidden();
    await fitAndSettle(page);
    const heavy = await measure(page);
    expect(heavy.notFitting, "at the heaviest width").toEqual([]);
    expect(heavy.overlaps, "at the heaviest width").toEqual([]);
    const after = await response.evaluate((e) => (e as HTMLElement).offsetHeight);
    expect(after, "the box allows for a heavier outline").toBeGreaterThan(before[1]);
  });
});
