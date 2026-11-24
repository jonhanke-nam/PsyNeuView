/**
 * Run panel, inputs arranged by node: each node's header sticks just below
 * the sticky Run row while its trials scroll past, and the next node's
 * header pushes it up (#363).
 *
 * Loads the two-input-nodes fixture, adds trials until the inputs scroll,
 * then scrolls step by step and checks that the header of the node showing
 * below the Run row sits exactly at the Run row's bottom (within 1 px),
 * never above it.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import type { Page } from "@playwright/test";

const NODES = ["input_a", "input_b"];

type Box = { top: number; bottom: number };

async function measure(page: Page) {
  return page.evaluate((nodes) => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    return {
      run: box(q("run-sticky-row"))!,
      nodes: nodes.map((n) => ({
        name: n,
        block: box(q(`run-input-${n}`))!,
        header: box(q(`run-input-header-${n}`))!,
      })),
    };
  }, NODES);
}

test.describe("Run panel sticky node headers (#363)", { tag: "@ci" }, () => {
  test("arranged by node, the current node's header stays just below the Run row", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path…" }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("two_input_nodes"));
    await prompt.press("Enter");
    await expect(page.getByText("two_input_nodes.py").first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Run", exact: true }).click();
    const panel = page.getByTestId("run-panel");
    await expect(panel.getByRole("button", { name: /Run Model/ })).toBeVisible();
    await page.getByRole("button", { name: "By node", exact: true }).click();

    // Enough trials that each node's block is taller than the panel.
    const add = panel.getByRole("button", { name: "+ Add trial" });
    for (let i = 0; i < 24; i++) await add.click();
    await expect(panel.getByTestId("run-input-input_b")).toContainText("Trial 25");

    const { scrollHeight, clientHeight } = await panel.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight + 200);

    const seen = new Set<string>();
    for (let y = 0; y <= scrollHeight - clientHeight; y += 40) {
      await panel.evaluate((el, top) => (el.scrollTop = top), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      const m = await measure(page);
      // The current node: its block reaches past the Run row's bottom with
      // room for its whole header (otherwise the next header is pushing it).
      const current = m.nodes.find(
        (n) =>
          n.block.top <= m.run.bottom &&
          n.block.bottom - (n.header.bottom - n.header.top) >= m.run.bottom + 1,
      );
      if (!current) continue;
      seen.add(current.name);
      expect(current.header.top, `${current.name} header at scrollTop ${y}`).toBeGreaterThanOrEqual(m.run.bottom - 1);
      expect(Math.abs(current.header.top - m.run.bottom), `${current.name} header at scrollTop ${y}`).toBeLessThanOrEqual(1);
    }
    // Both nodes took their turn stuck below the Run row.
    expect([...seen].sort()).toEqual(NODES);
  });
});
