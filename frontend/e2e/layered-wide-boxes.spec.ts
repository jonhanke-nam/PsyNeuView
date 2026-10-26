/**
 * The Layered layout doesn't overlap boxes wider than it assumes (#72).
 *
 * EGO's EM members have long names, so their boxes are up to 320px wide, and
 * Layered spaced them as 180px boxes. A model opened while Layered is picked
 * is laid out before it is drawn; once drawn, it is laid out again, with the
 * CIMs, when shown, put back against their frame.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..", "..", "backend");

async function openModel(page: Page, model: string) {
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(path.join(BACKEND_DIR, model));
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/model/load") &&
        (r.request().postData() ?? "").includes(path.basename(model)),
      { timeout: 60000 },
    ),
    prompt.press("Enter"),
  ]);
  await expect(
    page.getByTestId("graph-canvas").locator(".react-flow__node").first(),
  ).toBeVisible({ timeout: 60000 });
}

const loaded = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/model/load") && r.ok(), {
    timeout: 60000,
  });

/** Flip one of the graph's More ▸ options (Learning, CIMs). */
async function toggleOption(page: Page, label: string) {
  await page.getByTestId("graph-more-button").click();
  await Promise.all([
    loaded(page),
    page
      .getByTestId("graph-more-menu")
      .getByRole("button")
      .filter({ hasText: new RegExp(`^${label}`) })
      .click(),
  ]);
  await page.keyboard.press("Escape");
}

type Box = { id: string; x: number; y: number; w: number; h: number };

/** Boxes of one kind of node, read once the canvas has stopped moving. */
async function settled(page: Page, kind: string): Promise<Box[]> {
  const nodes = page
    .getByTestId("graph-canvas")
    .locator(`.react-flow__node-${kind}`);
  const read = () =>
    nodes.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute("data-id") ?? "",
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
        };
      }),
    );
  let boxes = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = await read();
    if (JSON.stringify(now) === JSON.stringify(boxes)) break;
    boxes = now;
  }
  return boxes;
}

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w - 1 &&
  b.x < a.x + a.w - 1 &&
  a.y < b.y + b.h - 1 &&
  b.y < a.y + a.h - 1;

/** Pairs of node boxes that overlap, once the canvas has stopped moving. */
async function overlaps(page: Page): Promise<string[]> {
  const boxes = await settled(page, "mechanismNode");
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlap(boxes[i], boxes[j]))
        found.push(`${boxes[i].id} / ${boxes[j].id}`);
    }
  }
  return found;
}

test(
  "Layered doesn't overlap EGO's wide boxes, opened fresh or reloaded",
  { tag: "@ci" },
  async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await closePalette(page);
    await openModel(page, "demos/simple_stroop.py");
    await page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
      .first()
      .selectOption("layered");

    // Opened while Layered is picked: laid out before its boxes are drawn.
    await openModel(page, "reference_models/Giallanza2024_ego_study2.py");
    expect(await overlaps(page), "opened fresh").toEqual([]);

    // Reloaded with Learning shown: laid out with the boxes already drawn.
    await toggleOption(page, "Learning");
    expect(await overlaps(page), "reloaded with Learning shown").toEqual([]);
    await toggleOption(page, "Learning");
  },
);

// A layout run again over the drawn graph (Layered once boxes are drawn, Like
// show_graph once show_graph answers) puts the CIMs back against their frame.
for (const [style, name] of [
  ["layered", "Layered"],
  ["showgraph", "Like show_graph"],
] as const) {
  test(
    `${name} with CIMs shown: EM opened in EGO's nested view`,
    { tag: "@ci" },
    async ({ page }) => {
      test.setTimeout(3 * 60_000);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto("/");
      await closePalette(page);
      await openModel(page, "reference_models/Giallanza2024_ego_study2.py");
      await page
        .locator("select")
        .filter({ has: page.locator("option", { hasText: "Like show_graph" }) })
        .first()
        .selectOption(style);
      await toggleOption(page, "CIMs");
      const view = page
        .locator("select")
        .filter({
          has: page.locator("option", {
            hasText: "Flatten (all compositions)",
          }),
        })
        .first();
      await Promise.all([loaded(page), view.selectOption("EGO_comp")]);
      // A view with saved positions opens in Custom; this is about the automatic layout.
      const custom = page.getByRole("button", { name: /^Layout: Custom$/ });
      if (await custom.isVisible().catch(() => false))
        await Promise.all([loaded(page), custom.click()]);

      // Opening EM adds its members, laid out before they are drawn.
      await Promise.all([
        loaded(page),
        page
          .getByTestId("graph-canvas")
          .getByRole("button", { name: /^Expand composition / })
          .first()
          .click(),
      ]);
      expect(await overlaps(page), "EM opened").toEqual([]);

      // The CIMs are back against the EM frame: Input above it, Output below it,
      // clear of every node.
      const [frame] = await settled(page, "compositionNode");
      const cims = await settled(page, "cimNode");
      const nodes = await settled(page, "mechanismNode");
      expect(cims.length, "CIMs drawn").toBeGreaterThan(0);
      for (const c of cims) {
        if (/Input_CIM/.test(c.id))
          expect(c.y + c.h, `${c.id} above the frame`).toBeLessThanOrEqual(
            frame.y,
          );
        if (/Output_CIM/.test(c.id))
          expect(c.y, `${c.id} below the frame`).toBeGreaterThanOrEqual(
            frame.y + frame.h,
          );
        expect(
          nodes.filter((n) => overlap(c, n)).map((n) => n.id),
          `${c.id} clear of nodes`,
        ).toEqual([]);
      }
    },
  );
}
