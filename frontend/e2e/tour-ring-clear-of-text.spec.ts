/**
 * The walkthrough ring never runs through text outside what it marks (#102).
 *
 * For every step of First Steps part 1, points along the ring's border must
 * land on the anchor itself or the background round it, never on another
 * panel's text. In 0.6.6-rc2 the graph panel's ring crossed "Watching for
 * changes" in the row above.
 */
import { mutatingTest as test, expect } from "./test-base";
import { loadWalkthrough, runWalkthrough } from "./tourDriver";

test.describe("Walkthrough ring clear of text", { tag: "@ci" }, () => {
  test("no step's ring crosses text outside its anchor", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const part = loadWalkthrough("orientation-window");
    await page.goto(`/?tour=${part.id}`);
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    await runWalkthrough(page, part, async (step) => {
      await page.waitForTimeout(300);
      const crossings = await page.evaluate((testid) => {
        const ring = document.querySelector('[data-testid="tour-highlight"]') as HTMLElement | null;
        const anchor = testid ? document.querySelector(`[data-testid="${testid}"]`) : null;
        if (!ring || !anchor) return [];
        const r = ring.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const w = parseFloat(getComputedStyle(ring).borderTopWidth) / 2;
        const pts: [number, number][] = [];
        for (let i = 1; i < 12; i++) {
          const x = r.left + (r.width * i) / 12, y = r.top + (r.height * i) / 12;
          pts.push([x, r.top + w], [x, r.bottom - w], [r.left + w, y], [r.right - w, y]);
        }
        const out: string[] = [];
        for (const [x, y] of pts) {
          const el = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-testid="tour-overlay"]'));
          if (!el || anchor.contains(el)) continue;
          const b = el.getBoundingClientRect();
          const around = b.left <= a.left + 1 && b.top <= a.top + 1 && b.right >= a.right - 1 && b.bottom >= a.bottom - 1;
          const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!around && text) out.push(`${Math.round(x)},${Math.round(y)}: "${el.textContent!.trim().slice(0, 30)}"`);
        }
        return out;
      }, step.anchor?.testid ?? null);
      expect(crossings, `step "${step.id}" ring crosses text`).toEqual([]);
    });
  });
});
