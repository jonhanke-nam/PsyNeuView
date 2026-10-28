/**
 * Spline straightness — a clear edge must not wander (#1023).
 *
 * The rule this guards: a default edge with no handles, routed around nothing,
 * should be drawn straight. It may only curve to accomplish something — to
 * detour around a node, to hold a lane offset, or to smooth a real bend.
 *
 * Before #1023 the spline branch derived its Bézier control points from React
 * Flow's handle facing, pushing c1 out along the source port's cardinal
 * direction and c2 back along the target's. When an edge travelled diagonally,
 * or against its port orientation, those two pushes landed on opposite sides of
 * the straight line and the edge rendered as a visible S — most obviously on
 * EGO's CONTEXT [BIAS] -> CONTEXT [NORMALIZED].
 *
 * The measure is geometric rather than visual: for each plain two-point cubic,
 * take the signed perpendicular distance of both control points from the
 * straight source->target line. Opposite signs means the curve crosses its own
 * chord, which is exactly what an S is.
 *
 * Two things make this test honest, and both were wrong in a first draft:
 *
 *  - Only single-segment cubics are examined. A multi-segment path came from
 *    the obstacle router — a detour or a lane bow — and is *supposed* to curve.
 *    Counting those reports failures for edges doing their job.
 *
 *  - Sides are compared with a real-pixel tolerance. Control points placed on
 *    the line land at a perpendicular distance of ~1e-13 rather than exactly 0,
 *    and Math.sign() turns that float dust into a phantom S. Without the
 *    tolerance this test reports 6 failures against a fix that has none.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";

test.use({ viewport: { width: 1500, height: 950 } });

// EGO is the model the report came from. Botvinick is recurrent, so its
// feedback edges travel against their port orientation — the case that made
// the old handle-derived control points diverge most sharply.
const MODELS = [
  { label: "EGO — Giallanza et al. 2024 (Study 2)", slug: "ego" },
  { label: "Conflict Monitoring — Stroop (Botvinick et al. 2001)", slug: "botvinick" },
  { label: "Stroop — Basic", slug: "stroop-basic" },
];

for (const m of MODELS) {
  test(`spline straightness: ${m.slug}`, { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText(m.label, { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    await closePalette(page);
    await page.waitForTimeout(700);

    // Line style lives in Advanced Graph View Options (#123).
    await page.getByTestId("graph-view-options-button").click();
    await page.getByTestId("graph-view-option-edge-style").selectOption("spline");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);

    const report = await page.evaluate(() => {
      const offenders: { id: string; d: string; c1: number; c2: number }[] = [];
      let total = 0;

      document.querySelectorAll<SVGPathElement>(".react-flow__edge-path").forEach((p) => {
        const d = p.getAttribute("d") || "";

        // Multi-segment paths come from the obstacle router: detours and lane
        // bows, which curve deliberately. Only a lone cubic is a clear edge.
        if ((d.match(/C/g) || []).length !== 1) return;

        const m = d.match(
          /^M\s*([-\d.]+)[, ]([-\d.]+)\s*C\s*([-\d.]+)[, ]([-\d.]+)[, ]\s*([-\d.]+)[, ]([-\d.]+)[, ]\s*([-\d.]+)[, ]([-\d.]+)/,
        );
        if (!m) return;
        total++;

        const [, sx, sy, c1x, c1y, c2x, c2y, tx, ty] = m.map(Number);
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;

        // Signed perpendicular distance from the chord, in screen pixels.
        const dist = (px: number, py: number) => (dx * (py - sy) - dy * (px - sx)) / len;
        // Sub-pixel deviation is not a bend anyone can see; treat it as on-line
        // so float error at exactly 0 cannot masquerade as a side.
        const side = (v: number) => (Math.abs(v) < 0.5 ? 0 : Math.sign(v));

        const c1 = dist(c1x, c1y);
        const c2 = dist(c2x, c2y);
        if (side(c1) * side(c2) < 0) {
          const id = (p.closest(".react-flow__edge")?.getAttribute("data-testid") || "?")
            .replace("rf__edge-", "");
          offenders.push({ id, d: d.slice(0, 120), c1, c2 });
        }
      });

      return { total, offenders };
    });

    console.log(`[spline:${m.slug}] plain two-point edges=${report.total} S-curves=${report.offenders.length}`);
    for (const o of report.offenders) {
      console.log(`[spline:${m.slug}]   ${o.id}  c1=${o.c1.toFixed(1)}px c2=${o.c2.toFixed(1)}px`);
    }

    // A model with no plain edges would pass vacuously and hide a regression.
    expect(report.total, "expected some unrouted two-point edges to measure").toBeGreaterThan(0);
    expect(
      report.offenders.map((o) => `${o.id} (c1=${o.c1.toFixed(1)}px, c2=${o.c2.toFixed(1)}px)`),
      "clear edges must not cross their own chord",
    ).toEqual([]);
  });
}
