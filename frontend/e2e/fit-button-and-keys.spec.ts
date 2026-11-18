/**
 * An obvious way to recentre the graph (#289).
 *
 * After panning the graph right out of sight, each of the ways back brings
 * every node into view: the labelled Fit button, ⌘9 (Ctrl+9 off the Mac), and
 * ⇧1 for browsers that keep ⌘9 for their tabs. ⌘0 shows the graph at 100%.
 * While the whole graph is out of sight, the "N nodes off-screen · Fit" badge
 * says so.
 *
 * PW_FIT_CONTROLS_SCREENSHOT, if set, saves a picture of the canvas controls
 * to that path, for comparing the controls column before and after a restyle.
 */
import { mutatingTest as test, expect } from "./test-base";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

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
  await page.getByRole("button", { name: "Open from path..." }).click();
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

async function expectAllInView(page: Page) {
  await expect.poll(async () => nodesInView(page)).toEqual({ inside: 3, total: 3 });
}

test("Fit: the labelled button, ⌘9 and ⇧1 bring the graph back; ⌘0 gives 100% (#289)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openModel(page);

  const fit = page.locator(".react-flow__controls-fitview");
  await expect(fit).toBeVisible();
  if (process.env.PW_FIT_CONTROLS_SCREENSHOT) {
    const box = (await page.locator(".react-flow__controls").boundingBox())!;
    await page.screenshot({
      path: process.env.PW_FIT_CONTROLS_SCREENSHOT,
      clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 120, height: box.height + 32 },
    });
  }

  // A word, not just an icon, and a tooltip that names the keys.
  await expect(fit).toHaveText("Fit");
  await expect(fit).toHaveAttribute("title", /^Fit the graph to the window \((⌘9|Ctrl\+9) or (⇧1|Shift\+1)\)$/);

  // The button.
  await panAway(page);
  await fit.click();
  await expectAllInView(page);

  // ⌘9. The test browser reports a Windows platform (Desktop Chrome), so the
  // app reads Mod as Ctrl there, as blank-screen-setting.spec.ts relies on.
  await panAway(page);
  await page.keyboard.press("Control+9");
  await expectAllInView(page);

  // ⇧1.
  await panAway(page);
  await page.keyboard.press("Shift+Digit1");
  await expectAllInView(page);

  // ⌘0: actual size.
  await page.keyboard.press("Control+0");
  await expect.poll(() => zoom(page)).toBe(1);

  // The Layout menu lists them, with their keys.
  await page.getByTestId("layout-menu-button").click();
  await expect(page.getByTestId("layout-menu-fit")).toContainText(/⌘9|Ctrl\+9/);
  await expect(page.getByTestId("layout-menu-fit")).toContainText(/⇧1|Shift\+1/);
  await expect(page.getByTestId("layout-menu-actual-size")).toContainText(/⌘0|Ctrl\+0/);
});

test("⇧1 does not fire while typing in a text field (#289)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openModel(page);
  await panAway(page);

  // The Open-from-path box is an ordinary text field: ⇧1 types "!" there and
  // leaves the view alone.
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill("");
  await prompt.press("Shift+Digit1");
  await expect(prompt).toHaveValue("!");
  expect((await nodesInView(page)).inside).toBe(0);
});
