/**
 * Occlusion audit — measures edges that pass behind nodes (#1006, #963, #967).
 *
 * The point of sampling here is that it tests the **rendered** path, not the
 * straight centreline. #963's thesis is that those disagree: clearance is
 * validated on the source->target line while the drawn Bézier bows elsewhere,
 * so a curve can enter a node the guard believed was cleared. Reading points
 * off the actual SVG geometry via getPointAtLength is the only check that
 * cannot be fooled by that gap.
 *
 * Reports per model: how many edges intersect a node they don't connect to,
 * and how deep the worst incursion is. Endpoints are excluded — an edge is
 * supposed to touch the nodes it joins.
 *
 * Asserts zero incursions on the models it covers, which is the regression
 * guard for #1006: the spline branch used to derive its bezier control points
 * from handle facing, so a feedback edge travelling against its port's
 * orientation bulged back across its own node. Partial coverage for #967.
 */
import { readOnlyTest as test, expect, closePalette } from "./test-base";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync, writeFileSync } from "fs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.curated");
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1600, height: 1000 } });

// Default covers both a feedforward model and a recurrent one. Botvinick is the
// case that regressed under #1006 — its RESPONSE->HIDDEN feedback edges travel
// against their port orientation — so it must be in the default set or CI never
// exercises the bug this guards.
const MODELS = (process.env.AUDIT_MODELS
  || "Stroop — Basic|stroop-basic;Conflict Monitoring — Stroop (Botvinick et al. 2001)|botvinick")
  .split(";")
  .map((s) => {
    const [label, slug] = s.split("|");
    return { label, slug };
  });

for (const m of MODELS) {
  test(`occlusion: ${m.slug}`, { tag: "@ci" }, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText(m.label, { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    await closePalette(page);
    await page.waitForTimeout(700);

    const routing = page.locator("select").filter({ has: page.locator('option[value="spline"]') }).first();
    await routing.selectOption("spline");
    await page.waitForTimeout(900);

    const report = await page.evaluate(() => {
      // Node boxes in *viewport* pixels, which is the same space the rendered
      // SVG path resolves to once transformed — so no coordinate conversion.
      const nodes: { id: string; l: number; t: number; r: number; b: number }[] = [];
      document.querySelectorAll<HTMLElement>(".react-flow__node").forEach((el) => {
        const b = el.getBoundingClientRect();
        nodes.push({ id: el.getAttribute("data-id") || "", l: b.left, t: b.top, r: b.right, b: b.bottom });
      });

      // Nodes render as ellipses; a rect test over-reports the corners. Use the
      // inscribed ellipse so "inside" means visually covered.
      const insideEllipse = (n: (typeof nodes)[0], x: number, y: number) => {
        const cx = (n.l + n.r) / 2, cy = (n.t + n.b) / 2;
        const rx = (n.r - n.l) / 2, ry = (n.b - n.t) / 2;
        if (rx <= 0 || ry <= 0) return 0;
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        return d < 1 ? 1 - d : 0; // 0 = outside, ->1 = dead centre
      };

      const findings: { edge: string; through: string; depth: number; frac: number }[] = [];
      document.querySelectorAll<SVGPathElement>(".react-flow__edge-path").forEach((p) => {
        const edgeEl = p.closest(".react-flow__edge");
        const id = edgeEl?.getAttribute("data-testid") || edgeEl?.id || "edge";
        const len = p.getTotalLength();
        if (!len) return;
        const STEPS = 120;
        const worst: Record<string, number> = {};
        let hits = 0;
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          // Skip the ends — an edge legitimately meets the nodes it connects.
          if (t < 0.12 || t > 0.88) continue;
          const pt = p.getPointAtLength(t * len);
          const sp = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM() || undefined);
          let hitThis = false;
          for (const n of nodes) {
            const d = insideEllipse(n, sp.x, sp.y);
            if (d > 0) {
              worst[n.id] = Math.max(worst[n.id] ?? 0, d);
              hitThis = true;
            }
          }
          if (hitThis) hits++;
        }
        for (const [through, depth] of Object.entries(worst)) {
          findings.push({ edge: id, through, depth: +depth.toFixed(3), frac: +(hits / STEPS).toFixed(3) });
        }
      });
      return { nodeCount: nodes.length, edgeCount: document.querySelectorAll(".react-flow__edge-path").length, findings };
    });

    const worst = report.findings.slice().sort((a, b) => b.depth - a.depth).slice(0, 6);
    // eslint-disable-next-line no-console
    console.log(
      `[occlusion] ${m.slug}: ${report.findings.length} incursion(s) across ` +
        `${report.edgeCount} edges / ${report.nodeCount} nodes` +
        (worst.length ? `\n   worst: ${worst.map((w) => `${w.through}(depth ${w.depth}, ${Math.round(w.frac * 100)}% of path)`).join(", ")}` : ""),
    );
    writeFileSync(path.join(OUT, `${m.slug}-occlusion.json`), JSON.stringify(report, null, 2));

    // The guard. An edge may touch the nodes it joins — the sampler already
    // excludes the end 12% of each path — so anything left is an edge crossing
    // a node it has no business being inside.
    expect(
      report.findings,
      `edges pass behind nodes:\n${report.findings.map((f) => `  ${f.edge} through ${f.through} (depth ${f.depth})`).join("\n")}`,
    ).toEqual([]);
  });
}
