/**
 * Components panel: pick a component, then click where it goes (#252).
 *
 * A user asked that clicking a component not create it at once, wherever the
 * layout put it (sometimes off-screen), but work like a drawing app's palette.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

function scratchModel(fixture: "two_mech_projection" | "nested_minimal" = "two_mech_projection"): string {
  const dir = mkdtempSync(path.join(tmpdir(), "place252-"));
  const file = path.join(dir, `${fixture}.py`);
  writeFileSync(file, readFileSync(fixturePath(fixture), "utf8"));
  return file;
}

async function open(page: Page, file: string = scratchModel()) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("palette-sidebar")).toBeVisible();
}

async function item(page: Page, type: string) {
  await page.getByPlaceholder("Search components…").fill(type);
  const el = page.locator(`[data-testid="palette-item"][data-type="${type}"]`).first();
  await expect(el).toBeVisible();
  return el;
}

function adds(page: Page) {
  const seen: unknown[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/model/structural-change") && r.postDataJSON()?.changes?.action === "add_node") seen.push(r.postDataJSON());
  });
  return seen;
}

/** Screen to graph coordinates, with the view as it is now. */
async function toFlow(page: Page, x: number, y: number) {
  return page.evaluate(({ x, y }) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement;
    const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
    return { x: (x - pane.left - m.e) / m.a, y: (y - pane.top - m.f) / m.d };
  }, { x, y });
}

/** A point on empty canvas, inside the visible graph. */
async function emptySpot(page: Page) {
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  return { x: pane.x + pane.width * 0.2, y: pane.y + pane.height * 0.8 };
}

test.describe("pick a component, then click where it goes (#252)", { tag: "@ci" }, () => {
  // A user put one down left of the graph in Like show_graph, Custom, and it
  // went to the top right: the reload used positions read before the click's
  // was saved. In Auto, the reload laid everything out again.
  for (const style of ["showgraph", "layered"] as const) {
    for (const start of ["Auto", "Custom"] as const) {
      test(`it goes where the click was: ${style === "showgraph" ? "Like show_graph" : "Layered"}, ${start}`, async ({ page }) => {
        await page.addInitScript((s) => localStorage.setItem("psyneuview.graph.layoutDefault", s), style);
        const dir = mkdtempSync(path.join(tmpdir(), "place252-"));
        const file = path.join(dir, "stroop_basic.py");
        writeFileSync(file, readFileSync(path.resolve(import.meta.dirname, "../../backend/demos/stroop_basic.py"), "utf8"));
        await open(page, file);
        await page.waitForTimeout(1500);
        if (start === "Custom") {
          await page.getByRole("button", { name: /^Layout: Auto$/ }).click();
          await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible();
        }
        const tm = await item(page, "ProcessingMechanism");
        await tm.click();
        // Empty canvas left of the graph, where the user clicked.
        const pane = (await page.locator(".react-flow__pane").boundingBox())!;
        const at = { x: pane.x + pane.width * 0.06, y: pane.y + pane.height * 0.45 };
        const clickedAt = await toFlow(page, at.x, at.y);
        const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
        await page.mouse.click(at.x, at.y);
        await done;
        const fresh = page.locator('.react-flow__node[data-id^="New_ProcessingMechanism"]').first();
        await expect(fresh).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        const box = (await fresh.boundingBox())!;
        const centre = await toFlow(page, box.x + box.width / 2, box.y + box.height / 2);
        const zoom = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform).a);
        expect(Math.hypot(centre.x - clickedAt.x, centre.y - clickedAt.y), JSON.stringify({ centre, clickedAt })).toBeLessThan(Math.max(box.width, box.height) / zoom);
        // Putting it somewhere, like dragging, makes the layout Custom.
        await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible();
      });
    }
  }

  test("a click on an arrow while placing puts it down there; the arrow isn't selected", async ({ page }) => {
    const added = adds(page);
    await open(page);
    const tm = await item(page, "TransferMechanism");
    await tm.click();
    const hit = (await page.locator(".projection-edge-hit").first().boundingBox())!;
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await done;
    expect(added.length).toBe(1);
    await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  });

  test("a click inside a composition's frame adds it to that composition, there", async ({ page }) => {
    const added = adds(page);
    const file = scratchModel("nested_minimal");
    await open(page, file);
    const frame = page.locator('.react-flow__node-compositionNode[data-id="inner_comp"], .react-flow__node-compositionNode[data-id="cluster::inner_comp"]').first();
    await expect(frame).toBeVisible();
    const tm = await item(page, "TransferMechanism");
    await tm.click();

    // An empty spot inside the frame: its lower-left corner, clear of its nodes.
    const box = (await frame.boundingBox())!;
    const at = { x: box.x + 30, y: box.y + box.height - 30 };
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.mouse.click(at.x, at.y);
    await done;
    expect((added[0] as any).changes.composition).toBe("inner_comp");
    await expect.poll(() => readFileSync(file, "utf8")).toMatch(/^inner_comp\.add_node\(New_TransferMechanism\w*\)/m);

    // It is drawn inside the frame, where the click was.
    const fresh = page.locator('.react-flow__node[data-id^="New_TransferMechanism"]').first();
    await expect(fresh).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const f = (await frame.boundingBox())!;
    const n = (await fresh.boundingBox())!;
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    expect(cx > f.x && cx < f.x + f.width && cy > f.y && cy < f.y + f.height, JSON.stringify({ f, n })).toBe(true);
  });

  test("a click on empty canvas, outside every frame, adds it to the top level", async ({ page }) => {
    const added = adds(page);
    const file = scratchModel("nested_minimal");
    await open(page, file);
    const tm = await item(page, "TransferMechanism");
    await tm.click();
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.mouse.click(pane.x + 12, pane.y + pane.height - 12);
    await done;
    expect((added[0] as any).changes.composition).not.toBe("inner_comp");
    await expect.poll(() => readFileSync(file, "utf8")).not.toMatch(/^inner_comp\.add_node\(New_/m);
  });

  test("a click on a component adds nothing; a click on the graph adds it there", async ({ page }) => {
    const added = adds(page);
    await open(page);
    const before = await page.locator(".react-flow__node").count();
    const tm = await item(page, "TransferMechanism");
    await tm.click();
    await expect(tm).toHaveAttribute("data-armed", "true");
    // The hint names it as the panel does.
    await expect(page.getByTestId("place-component-hint")).toContainText("Transfer");
    await page.waitForTimeout(500);
    expect(added).toEqual([]);

    const at = await emptySpot(page);
    const clickedAt = await toFlow(page, at.x, at.y);
    const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.mouse.click(at.x, at.y);
    await done;
    await expect(page.locator(".react-flow__node")).toHaveCount(before + 1, { timeout: 30_000 });
    expect(added.length).toBe(1);
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);
    await expect(tm).not.toHaveAttribute("data-armed", "true");

    // The new node's centre sits where the click was, in the graph's own
    // coordinates, and that centre is on screen (#346: the node is centred on
    // the click, so near the edge of the canvas part of it can be beyond).
    const ids = await page.locator(".react-flow__node").evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id!));
    const fresh = ids.find((id) => /New_TransferMechanism/.test(id))!;
    await page.waitForTimeout(400);
    const box = (await page.locator(`.react-flow__node[data-id="${fresh}"]`).boundingBox())!;
    const centre = await toFlow(page, box.x + box.width / 2, box.y + box.height / 2);
    const zoom = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform).a);
    expect(Math.hypot(centre.x - clickedAt.x, centre.y - clickedAt.y), JSON.stringify({ centre, clickedAt })).toBeLessThan(Math.max(box.width, box.height) / zoom);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    expect(box.x + box.width / 2).toBeGreaterThanOrEqual(pane.x);
    expect(box.y + box.height / 2).toBeLessThanOrEqual(pane.y + pane.height);
  });

  test("Esc, the same component again, or another one: nothing is added", async ({ page }) => {
    const added = adds(page);
    await open(page);
    const tm = await item(page, "TransferMechanism");
    await tm.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);

    await tm.click();
    await tm.click();
    await expect(tm).not.toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);

    await tm.click();
    const pm = await item(page, "ProcessingMechanism");
    await pm.click();
    await expect(pm).toHaveAttribute("data-armed", "true");
    await expect(page.getByTestId("place-component-hint")).toContainText("Processing");
    await page.keyboard.press("Escape");

    const at = await emptySpot(page);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(800);
    expect(added).toEqual([]);
  });

  test("Option-click puts down several", async ({ page }) => {
    await open(page);
    const before = await page.locator(".react-flow__node").count();
    const tm = await item(page, "TransferMechanism");
    await tm.click();
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    for (const fx of [0.15, 0.35]) {
      const done = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
      // mouse.click takes no modifiers: hold Option (Alt) on the keyboard.
      await page.keyboard.down("Alt");
      await page.mouse.click(pane.x + pane.width * fx, pane.y + pane.height * 0.85);
      await page.keyboard.up("Alt");
      await done;
      await expect(page.locator(".react-flow__node")).toHaveCount(before + (fx === 0.15 ? 1 : 2), { timeout: 30_000 });
    }
    await expect(page.getByTestId("place-component-hint")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);
  });
});
