/**
 * An obvious way to recentre the graph (#289).
 *
 * After panning the graph right out of sight, each of the ways back brings
 * every node into view: the Fit button, ⌘9 (Ctrl+9 off the Mac), and
 * ⇧1 for browsers that keep ⌘9 for their tabs. ⌘0 shows the graph at 100%.
 * While the whole graph is out of sight, the "N nodes off-screen · Fit" badge
 * says so.
 *
 * The button shows the corner-brackets icon by default (no translation
 * needed); Settings ▸ Appearance ▸ Canvas controls can make it the word "Fit".
 * Either way it is the 26px square the zoom buttons are.
 *
 * PW_FIT_CONTROLS_SCREENSHOT_DIR, if set, saves a picture of the canvas
 * controls under each setting there (fit-controls-icon.png,
 * fit-controls-word.png), for comparing the controls column.
 */
import { mutatingTest as test, expect } from "./test-base";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { modLabel } from "./hostPlatform";

type Page = import("@playwright/test").Page;

const MODEL = `import psyneulink as pnl

first_mech = pnl.TransferMechanism(input_shapes=[2], name='first_mech')
second_mech = pnl.TransferMechanism(input_shapes=[2], name='second_mech')
third_mech = pnl.TransferMechanism(input_shapes=[2], name='third_mech')

fit_keys = pnl.Composition(name='fit_keys', pathways=[[first_mech, second_mech, third_mech]])
`;

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fit-keys-289-"));
  const file = path.join(dir, "fit_keys.py");
  writeFileSync(file, MODEL);
  return file;
}

async function openModel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(scratchModel());
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node")).toHaveCount(3, { timeout: 60_000 });
}

/** How many nodes are wholly inside the canvas, and how many there are. */
async function nodesInView(page: Page): Promise<{ inside: number; total: number }> {
  return page.evaluate(() => {
    const pane = document.querySelector(".react-flow")!.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    const inside = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= pane.left - 1 && r.right <= pane.right + 1 && r.top >= pane.top - 1 && r.bottom <= pane.bottom + 1;
    }).length;
    return { inside, total: nodes.length };
  });
}

async function zoom(page: Page): Promise<number> {
  const transform = await page.locator(".react-flow__viewport").evaluate((el) => (el as HTMLElement).style.transform);
  const m = /scale\(([\d.]+)\)/.exec(transform);
  return m ? Number(m[1]) : NaN;
}

/** Drag the empty canvas until the whole graph has left the window. */
async function panAway(page: Page) {
  const pane = (await page.locator(".react-flow").boundingBox())!;
  for (let i = 0; i < 3; i++) {
    // Start on the pane itself, not on a node or an overlay.
    const start = await page.evaluate(({ x, y, w, h }) => {
      for (let fy = 0.1; fy < 0.95; fy += 0.05) {
        for (let fx = 0.05; fx < 0.3; fx += 0.05) {
          const px = x + w * fx;
          const py = y + h * fy;
          const el = document.elementFromPoint(px, py);
          if (el?.classList.contains("react-flow__pane")) return { px, py };
        }
      }
      return null;
    }, { x: pane.x, y: pane.y, w: pane.width, h: pane.height });
    if (!start) break;
    await page.mouse.move(start.px, start.py);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 5, start.py, { steps: 8 });
    await page.mouse.up();
    if ((await nodesInView(page)).inside === 0) break;
  }
  await expect.poll(async () => (await nodesInView(page)).inside).toBe(0);
  // Every node is out of sight, and the badge says so (#1183's indicator).
  await expect(page.getByTestId("offscreen-nodes-indicator")).toContainText("3 nodes off-screen");
}

/** The Fit button is the same size as the zoom-in button above it. */
async function expectSquare(page: Page) {
  const zoomIn = (await page.locator(".react-flow__controls-zoomin").boundingBox())!;
  const fit = (await page.locator(".react-flow__controls-fitview").boundingBox())!;
  expect(Math.round(fit.width)).toBe(Math.round(zoomIn.width));
  expect(Math.round(fit.height)).toBe(Math.round(zoomIn.height));
  expect(Math.round(fit.x)).toBe(Math.round(zoomIn.x));
}

async function shootControls(page: Page, name: string) {
  const dir = process.env.PW_FIT_CONTROLS_SCREENSHOT_DIR;
  if (!dir) return;
  const box = (await page.locator(".react-flow__controls").boundingBox())!;
  await page.screenshot({
    path: path.join(dir, name),
    clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 120, height: box.height + 32 },
  });
}

async function expectAllInView(page: Page) {
  await expect.poll(async () => nodesInView(page)).toEqual({ inside: 3, total: 3 });
}

test("Fit: the labelled button, ⌘9 and ⇧1 bring the graph back; ⌘0 gives 100% (#289)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openModel(page);

  const fit = page.locator(".react-flow__controls-fitview");
  await expect(fit).toBeVisible();
  // The icon by default, in the zoom buttons' 26px square, with a tooltip
  // that names the keys.
  await expect(fit.locator("svg")).toHaveCount(1);
  await expect(fit).toHaveText("");
  await expectSquare(page);
  await expect(fit).toHaveAttribute("aria-label", "Fit the graph to the window");
  await expect(fit).toHaveAttribute("title", /^Fit the graph to the window \((⌘9|Ctrl\+9) or (⇧1|Shift\+1)\)$/);
  await shootControls(page, "fit-controls-icon.png");

  // The button.
  await panAway(page);
  await fit.click();
  await expectAllInView(page);

  // ⌘9 (Ctrl+9 off the Mac): the test browser reports the platform it runs
  // on (#402), so ControlOrMeta is the key the app expects.
  await panAway(page);
  await page.keyboard.press("ControlOrMeta+9");
  await expectAllInView(page);

  // ⇧1.
  await panAway(page);
  await page.keyboard.press("Shift+Digit1");
  await expectAllInView(page);

  // ⌘0: actual size.
  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(() => zoom(page)).toBe(1);

  // The Layout menu lists them, with their keys.
  await page.getByTestId("layout-menu-button").click();
  await expect(page.getByTestId("layout-menu-fit")).toContainText(modLabel("9"));
  await expect(page.getByTestId("layout-menu-fit")).toContainText(/⇧1|Shift\+1/);
  await expect(page.getByTestId("layout-menu-actual-size")).toContainText(modLabel("0"));
});

test("⇧1 does not fire while typing in a text field (#289)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openModel(page);
  await panAway(page);

  // The Open-from-path box is an ordinary text field: ⇧1 types "!" there and
  // leaves the view alone.
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path…" }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill("");
  await prompt.press("Shift+Digit1");
  await expect(prompt).toHaveValue("!");
  expect((await nodesInView(page)).inside).toBe(0);
});

test("Settings can make the Fit button the word \u201cFit\u201d, and it still fits (#289)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openModel(page);

  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-appearance").click();
  const control = page.getByTestId("setting-graph-fit-button-style");
  await expect(control).toHaveValue("icon");
  await control.selectOption("word");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toBeHidden();

  const fit = page.locator(".react-flow__controls-fitview");
  await expect(fit).toHaveText("Fit");
  await expect(fit.locator("svg")).toHaveCount(0);
  await expectSquare(page);
  await shootControls(page, "fit-controls-word.png");

  await panAway(page);
  await fit.click();
  await expectAllInView(page);

  // Remembered across a reload.
  await openModel(page);
  await expect(page.locator(".react-flow__controls-fitview")).toHaveText("Fit");
});
