/**
 * An expanded node holds its text inside its own shape (#333).
 *
 * Double-clicking a node expands it to show its ports, function and roles.
 * The box grew to fit that text as a rectangle, but the node is drawn as an
 * oval, an octagon or a double outline inscribed in that box, so the text's
 * corners ran over the outline: the top line and the widest line most of all.
 * Now an expanded node is as big as its shape needs to be to hold the text.
 *
 * For each shape a node can be expanded in (oval, octagon, double circle,
 * double octagon), at each Text size, this double-clicks the node and checks
 * that every line of text lies inside the shape's innermost outline with room
 * to spare, and that no two lines overlap. A collapsed composition, the
 * rectangle, opens rather than expands on a double-click, so it isn't here.
 * Neighbour spacing is a different question, not asked here.
 *
 * Double-clicking also has to expand a node in an automatic layout, where the
 * canvas's own double-click zoom used to take the event first (EGO, Botvinick).
 *
 * Set EXPAND_SHOTS to a folder to also save a numbered close-up of each node.
 */
import { mutatingTest as test, expect, canvasNode, closePalette, fitGraph } from "./test-base";
import type { Page } from "@playwright/test";
import { fixturePath } from "./fixtures";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(__dirname, "..", "..", "backend", "reference_models");
const SHOTS = process.env.EXPAND_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Settings ▸ Appearance ▸ Text size: 1.0, 1.1 (the default) and 1.2. */
const TEXT_SIZES = ["small", "default", "large"] as const;
const SCALE = { small: "1.0", default: "1.1", large: "1.2" } as const;

/** Least clear space between a line of text and the inside of the outline, px. */
const CLEARANCE = 2;

interface Case {
  /** Where the screenshots number from, so before and after shots pair up. */
  n: number;
  model: string;
  file: string;
  nodes: [name: string, shape: string][];
}

const STROOP: Case = { n: 0, model: "stroop", file: path.join(REF, "stroop_reference_basic.py"), nodes: [["color_input", "oval"]] };
const EGO: Case = {
  n: 100,
  model: "ego",
  file: path.join(REF, "Giallanza2024_ego_study2.py"),
  nodes: [["STATE", "oval"], ["COMBINED SCORES", "octagon"]],
};
const BOTVINICK: Case = {
  n: 200,
  model: "botvinick",
  file: path.join(REF, "Botvinick_conflict_monitoring_model.py"),
  nodes: [["RESPONSE", "doublecircle"]],
};
// No reference model has a controller drawn on the canvas.
const CONTROLLER: Case = { n: 300, model: "controller", file: fixturePath("with_controller"), nodes: [["ctrl", "doubleoctagon"]] };

async function openModel(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expect(page.getByText(path.basename(file)).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
}

async function setTextSize(page: Page, size: (typeof TEXT_SIZES)[number]) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  await page.getByTestId("setting-text-size").selectOption(size);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--pnv-text-scale").trim()))
    .toBe(String(Number(SCALE[size])));
}

/**
 * Every line of text in the node, and how far the worst one runs past the
 * inside of the outline less CLEARANCE (≤ 0 is inside), and which lines overlap.
 * Text on the port dots is the ports' own and sits on the outline; left out.
 */
async function measure(body: ReturnType<Page["locator"]>) {
  return body.evaluate((el, clearance) => {
    const shape = el.getAttribute("data-node-shape")!;
    const r = el.getBoundingClientRect();
    const scale = r.width / (el as HTMLElement).offsetWidth;
    const W = (el as HTMLElement).offsetWidth, H = (el as HTMLElement).offsetHeight;
    // The inside of the outline: the CSS border for an oval, the innermost
    // drawn line (its inner edge) for the others.
    let inset = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
    const outer = el.querySelector('[data-testid="node-shape-outline"] [data-outline="outer"]');
    if (outer) {
      const sw = parseFloat(outer.getAttribute("stroke-width") || "1");
      const inner = el.querySelector('[data-testid="node-shape-outline"] [data-outline="inner"]');
      inset = inner ? 2 * sw + 3 : sw; // DOUBLE_OUTLINE_GAP is 3
    }
    const a = W / 2 - inset, b = H / 2 - inset;
    const K = Math.tan(Math.PI / 8);
    // How far out a point is, in px past the outline (negative = inside).
    const past = (x: number, y: number) => {
      const nx = Math.abs(x - W / 2) / a, ny = Math.abs(y - H / 2) / b;
      const rad =
        shape === "octagon" || shape === "doubleoctagon"
          ? Math.max(nx, ny, (nx + ny) / (1 + K))
          : shape === "rectangle"
          ? Math.max(nx, ny)
          : Math.hypot(nx, ny);
      return (rad - 1) * Math.min(a, b);
    };
    const lines: { text: string; x0: number; y0: number; x1: number; y1: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (!t.data.trim() || t.parentElement?.closest(".react-flow__handle")) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const q of Array.from(range.getClientRects())) {
        if (q.width < 0.5) continue;
        lines.push({
          text: t.data.trim().slice(0, 40),
          x0: (q.left - r.left) / scale, y0: (q.top - r.top) / scale,
          x1: (q.right - r.left) / scale, y1: (q.bottom - r.top) / scale,
        });
      }
    }
    let worst = -Infinity, worstText = "";
    for (const l of lines) {
      for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y0], [l.x0, l.y1], [l.x1, l.y1]]) {
        const p = past(x, y) + clearance;
        if (p > worst) { worst = p; worstText = l.text; }
      }
    }
    const overlaps: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const p = lines[i], q = lines[j];
        const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
        const oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
        if (ox > 0.5 && oy > 0.5) overlaps.push(`"${p.text}" / "${q.text}"`);
      }
    }
    return { shape, lines: lines.length, worst: Math.round(worst * 10) / 10, worstText, overlaps, W, H };
  }, CLEARANCE);
}

/**
 * Double-click the node, as a person would, and time it to settled: until its
 * size and drawn outline have held still for ten frames.
 */
async function expandTimed(page: Page, body: ReturnType<Page["locator"]>) {
  // On the window, on the way down: the first to hear the double-click.
  await page.evaluate(() => {
    (window as any).__expandT0 = undefined;
    window.addEventListener("dblclick", () => ((window as any).__expandT0 = performance.now()), { capture: true, once: true });
  });
  await body.dblclick();
  return body.evaluate(async (el) => {
    const t0 = (window as any).__expandT0 as number;
    let last = "", changedAt = t0, still = 0;
    while (still < 10) {
      await new Promise((res) => requestAnimationFrame(res));
      const o = el.querySelector('[data-outline="outer"]');
      const sig = `${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}|${o?.getAttribute("points") ?? o?.getAttribute("rx") ?? ""}`;
      if (sig !== last) { last = sig; changedAt = performance.now(); still = 0; } else still++;
    }
    return Math.round((changedAt - t0) * 10) / 10;
  });
}

/** For review: pan the node to the canvas's middle and zoom in on it. */
async function closeUp(page: Page, name: string, file: string) {
  if (!SHOTS) return;
  const node = canvasNode(page, name).first();
  await fitGraph(page);
  const canvas = (await page.locator(".react-flow").first().boundingBox())!;
  const r = (await node.boundingBox())!;
  // Drag the pane from a spot no node covers.
  const empty = await page.evaluate(({ c }) => {
    for (let y = c.y + 10; y < c.y + c.height - 10; y += 15) {
      for (let x = c.x + 10; x < c.x + c.width - 10; x += 15) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  }, { c: canvas });
  if (empty) {
    const dx = canvas.x + canvas.width / 2 - (r.x + r.width / 2);
    const dy = canvas.y + canvas.height / 2 - (r.y + r.height / 2);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + dx, empty.y + dy, { steps: 8 });
    await page.mouse.up();
  }
  for (let i = 0; i < 40; i++) {
    const b = (await node.boundingBox())!;
    if (b.width >= 300 || b.height >= Math.min(300, canvas.height * 0.8)) break;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);
  const b = (await node.boundingBox())!;
  const pad = 24;
  await page.screenshot({
    path: path.join(SHOTS, file),
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad },
  });
}

/**
 * Open the model and, at each Text size, expand each node: its text inside
 * its shape, no line over another, and collapsing gives back the same node.
 */
async function expandEach(page: Page, c: Case) {
  await openModel(page, c.file);
  await closePalette(page);
  for (const [si, size] of TEXT_SIZES.entries()) {
    await setTextSize(page, size);
    for (const [ni, [name, shape]] of c.nodes.entries()) {
      await fitGraph(page);
      const body = canvasNode(page, name).first().locator("[data-node-shape]");
      await expect(body).toHaveAttribute("data-node-shape", shape);
      const before = await body.evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));

      const ms = await expandTimed(page, body);
      test.info().annotations.push({ type: "expand-ms", description: `${c.model} ${name} ${size}: ${ms} ms` });
      await expect(body.getByText("Input Ports"), `${name} expanded on a double-click`).toBeVisible();
      const m = await measure(body);
      const n = c.n + ni * 10 + si;
      await closeUp(page, name, `${String(n).padStart(3, "0")}-${c.model}-${shape}-${name.replace(/\W+/g, "_")}-text-${SCALE[size]}.png`);

      expect.soft(m.worst, `${name} (${shape}, Text size ${SCALE[size]}): "${m.worstText}" runs ${m.worst} px past the outline`).toBeLessThanOrEqual(0);
      expect.soft(m.overlaps, `${name} (${shape}, Text size ${SCALE[size]}): lines overlap`).toEqual([]);

      // Collapsing gives back exactly the node it was: the collapsed layout
      // is unchanged.
      await body.dblclick();
      await expect(body.getByText("Input Ports")).toHaveCount(0);
      await expect
        .poll(() => body.evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight })))
        .toEqual(before);
    }
  }
}

test.describe("an expanded node holds its text inside its shape (#333)", { tag: "@ci" }, () => {
  test.use({ deviceScaleFactor: SHOTS ? 2 : 1, viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => {
    // The graph alone, so a close-up has room.
    await page.addInitScript(() => {
      localStorage.setItem("psyneuview_layout_code_visible", "false");
      localStorage.setItem("psyneuview_layout_bottom_visible", "false");
    });
  });

  test("Stroop: an oval", async ({ page }) => expandEach(page, STROOP));
  test("EGO: an oval and an octagon, in an automatic layout", async ({ page }) => expandEach(page, EGO));
  test("Botvinick: a double circle", async ({ page }) => expandEach(page, BOTVINICK));
  test("a controller: a double octagon", async ({ page }) => expandEach(page, CONTROLLER));
});
