/**
 * The walkthrough ring never runs through text outside what it marks (#102).
 *
 * For every step of First Steps part 1, points along the ring's border must
 * land on the anchor itself or the background round it, never on another
 * panel's text. In 0.6.6-rc2 the graph panel's ring crossed "Watching for
 * changes" in the row above. Nor may it run through a small anchor's own
 * text: tucked inside the Open button, it cut the label in two (#9).
 */
import { mutatingTest as test, expect } from "./test-base";
import { loadWalkthrough, runWalkthrough } from "./tourDriver";

test.describe("Walkthrough ring clear of text", { tag: "@ci" }, () => {
  // First Steps part 1 rings every panel; PsyNeuLink lesson 7 rings the Open
  // button among its neighbours and the Run panel below its tabs (#9).
  for (const id of ["orientation-window", "pnl-simple-configurations"]) {
    test(`no step's ring crosses text (${id})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      const part = loadWalkthrough(id);
      await page.goto(`/?tour=${part.id}`);
      if (id === "orientation-window")
        await expect(page.locator(".react-flow__node").first()).toBeVisible({
          timeout: 30_000,
        });
      await runWalkthrough(page, part, async (step) => {
        if (step.anchor?.testid === "run-panel") {
          // Room above the panel is only the tab bar's padding: the ring goes
          // outside it, not through the Inputs row.
          await expect(page.getByTestId("tour-highlight")).toHaveAttribute(
            "data-sides",
            /^out /,
          );
        }
        await page.waitForTimeout(300);
        const crossings = await page.evaluate((testid) => {
          const ring = document.querySelector(
            '[data-testid="tour-highlight"]',
          ) as HTMLElement | null;
          const anchor = testid
            ? document.querySelector(`[data-testid="${testid}"]`)
            : null;
          if (!ring || !anchor) return [];
          const r = ring.getBoundingClientRect();
          const a = anchor.getBoundingClientRect();
          const w = parseFloat(getComputedStyle(ring).borderTopWidth) / 2;
          const pts: [number, number][] = [];
          for (let i = 1; i < 12; i++) {
            const x = r.left + (r.width * i) / 12,
              y = r.top + (r.height * i) / 12;
            pts.push(
              [x, r.top + w],
              [x, r.bottom - w],
              [r.left + w, y],
              [r.right - w, y],
            );
          }
          const out: string[] = [];
          for (const [x, y] of pts) {
            const el = document
              .elementsFromPoint(x, y)
              .find((e) => !e.closest('[data-testid="tour-overlay"]'));
            if (!el) continue;
            // Letters, measured: a button's padding round its label isn't text.
            const range = document.createRange();
            const text = Array.from(el.childNodes).some((n) => {
              if (n.nodeType !== 3 || !n.textContent!.trim()) return false;
              range.selectNodeContents(n);
              return Array.from(range.getClientRects()).some(
                (q) =>
                  x >= q.left && x <= q.right && y >= q.top && y <= q.bottom,
              );
            });
            // Nor through a small anchor's own text: tucked inside a toolbar
            // button, the ring cut its label in two. (A panel flush with the
            // window may have its ring over its own edge.)
            if (anchor.contains(el)) {
              if (text && Math.min(a.width, a.height) < 80)
                out.push(
                  `${Math.round(x)},${Math.round(y)}: inside, "${el.textContent!.trim().slice(0, 30)}"`,
                );
              continue;
            }
            const b = el.getBoundingClientRect();
            const around =
              b.left <= a.left + 1 &&
              b.top <= a.top + 1 &&
              b.right >= a.right - 1 &&
              b.bottom >= a.bottom - 1;
            if (!around && text)
              out.push(
                `${Math.round(x)},${Math.round(y)}: "${el.textContent!.trim().slice(0, 30)}"`,
              );
          }
          return out;
        }, step.anchor?.testid ?? null);
        expect(crossings, `step "${step.id}" ring crosses text`).toEqual([]);
      });
    });
  }
});
