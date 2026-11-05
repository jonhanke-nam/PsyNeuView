import { readOnlyTest as test, expect, canvasNode, closePalette, fitGraph } from "./test-base";
import { copyFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// #914 — hard rule: a projection edge must never pass through a node it doesn't
// connect to. EGO's PyTorch view is the dense stress case (22 nodes, 30 edges),
// exactly where straight routing used to cut across ovals. We sample every
// rendered edge path in screen space and assert none enters a non-endpoint
// node's box. The two nodes nearest an edge's endpoints are its source/target
// and are excluded; composition frames are skipped since edges legitimately
// cross their boundary to reach nodes inside.
//
// #1364: frames are recognised by their node type, not by on-screen size. The
// spec used to treat any box over 90,000 px² as a frame, but fit-to-view now
// lands at about 0.15 zoom in the default layout, which shrinks EGO's EM frame
// to ~34,000 px² — so the frame itself counted as an obstacle, and 21 of the
// 22 crossings reported were edges entering it. (The 22nd was real; see the
// router fix in utils/edgeRouter.ts.) The inset that forgives grazing a node's
// edge is likewise given in flow units and scaled by the zoom, so the check
// means the same thing at any zoom.
test("EGO PyTorch view: no projection edge crosses a node (#914)", { tag: "@ci" }, async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/");
  await page.getByTestId("app-toolbar").waitFor({ timeout: 30_000 });

  await page.getByRole("button", { name: /Open/ }).first().click();
  await page
    .getByText("EGO — Giallanza et al. 2024 (Study 2)", { exact: true })
    .first()
    .click();
  await page.locator(".react-flow__node").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1000);

  // Switch the composition selector to the PyTorch (inlined) view.
  const selects = page.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    if (await selects.nth(i).locator("option[value='__pytorch__']").count()) {
      await selects.nth(i).selectOption("__pytorch__");
      break;
    }
  }
  // Wait for the denser graph to materialise.
  await expect.poll(async () => page.locator(".react-flow__node").count(), {
    timeout: 60_000,
  }).toBeGreaterThan(15);
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    // Current zoom, from the transform React Flow writes on the viewport.
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement | null;
    const zoom = Number(/scale\(([\d.]+)\)/.exec(vp?.style.transform ?? "")?.[1] ?? 1);
    // 3 flow units of grace at each box edge, in screen px at this zoom.
    const inset = 3 * zoom;
    const nodes: { x: number; y: number; w: number; h: number; frame: boolean }[] = [];
    document.querySelectorAll(".react-flow__node").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      nodes.push({
        x: r.left, y: r.top, w: r.width, h: r.height,
        frame: el.classList.contains("react-flow__node-compositionNode"),
      });
    });
    const nearest = (p: { x: number; y: number }) => {
      let bi = -1, bd = Infinity;
      nodes.forEach((b, i) => {
        const d = (p.x - (b.x + b.w / 2)) ** 2 + (p.y - (b.y + b.h / 2)) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      return bi;
    };
    let edges = 0, crossing = 0;
    const offenders: string[] = [];
    document.querySelectorAll(".react-flow__edge").forEach((edge) => {
      const path = edge.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
      if (!path) return;
      let total = 0;
      try { total = path.getTotalLength(); } catch { return; }
      if (!total) return;
      edges++;
      const ctm = path.getScreenCTM();
      if (!ctm) return;
      const at = (l: number) => {
        const pt = path.getPointAtLength(l);
        return new DOMPoint(pt.x, pt.y).matrixTransform(ctm);
      };
      const si = nearest(at(0)), ti = nearest(at(total));
      let hit = false;
      for (let l = 6; l < total - 6 && !hit; l += 4) {
        const p = at(l);
        for (let i = 0; i < nodes.length; i++) {
          if (i === si || i === ti || nodes[i].frame) continue;
          const b = nodes[i];
          if (p.x > b.x + inset && p.x < b.x + b.w - inset && p.y > b.y + inset && p.y < b.y + b.h - inset) { hit = true; break; }
        }
      }
      if (hit) { crossing++; if (offenders.length < 6) offenders.push((edge.getAttribute("data-id") || "").slice(0, 60)); }
    });
    return { nodeCount: nodes.length, frames: nodes.filter((n) => n.frame).length, edges, crossing, offenders };
  });

  // Without a frame the exclusion above is never exercised, so a rename of the
  // node type would silently put the old size-based failure back.
  expect(report.frames, "expected EGO's PyTorch view to draw a composition frame").toBeGreaterThan(0);

  expect(report.edges, "expected projection edges to be present").toBeGreaterThan(20);
  expect(
    report.crossing,
    `${report.crossing}/${report.edges} edges cross a node: ${report.offenders.join(", ")}`,
  ).toBe(0);
});

// An edge routes again when a node that isn't on either of its ends moves onto
// it. Without this it kept the route it had made around the node's old place.
// Opening a graph does the same thing, less visibly: it is drawn, then laid out
// again at the boxes' measured sizes, and which edge that catches depends on the
// font (EGO's PyTorch view above, on the Linux runner only). So here it is done
// by hand, the same in any font.
test("an edge routes around a node moved onto it", { tag: "@ci" }, async ({ page }) => {
  // The drag saves a layout next to the model: use a copy.
  const model = test.info().outputPath("feedforward_network.py");
  copyFileSync(path.resolve(__dirname, "..", "..", "backend", "demos", "feedforward_network.py"), model);
  await page.goto("/");
  await closePalette(page);
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  const node = canvasNode(page, "output_layer").first();
  await expect(node).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Layout: Auto$/ }).click();
  await expect(page.getByRole("button", { name: /^Layout: Custom$/ })).toBeVisible();
  await fitGraph(page);

  const moveTo = async (name: string, to: { x: number; y: number }) => {
    const box = (await canvasNode(page, name).first().boundingBox())!;
    const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  };

  // Lengthen the edge, so the node can sit on it clear of both its ends: the
  // router can't go round a node with an end of the edge right beside it.
  const pane = (await page.getByTestId("graph-canvas").locator(".react-flow").boundingBox())!;
  const hidden = (await canvasNode(page, "hidden_layer").first().boundingBox())!;
  const centre = hidden.x + hidden.width / 2;
  await moveTo("output_layer", { x: centre + 260, y: pane.y + pane.height / 2 });
  await moveTo("hidden_layer", { x: centre, y: pane.y + 40 });

  const edge = page.locator('.react-flow__edge[data-id*="input_to_hidden"] path.react-flow__edge-path');
  await expect(edge).toHaveCount(1);
  const middle = await edge.evaluate((el) => {
    const path = el as unknown as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const at = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: at.x, y: at.y };
  });
  await moveTo("output_layer", middle);
  await page.mouse.move(5, 5); // off the edge, so hovering doesn't re-render it

  // Where the node is, and how far along the edge runs inside its box.
  const id = await node.getAttribute("data-id");
  const reading = () =>
    edge.evaluate((el, id) => {
      const b = document.querySelector(`.react-flow__node[data-id="${id}"]`)!.getBoundingClientRect();
      const path = el as unknown as SVGPathElement;
      const ctm = path.getScreenCTM()!;
      const total = path.getTotalLength();
      let inside = 0;
      for (let l = 0; l < total; l += 2) {
        const pt = path.getPointAtLength(l);
        const p = new DOMPoint(pt.x, pt.y).matrixTransform(ctm);
        if (p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom) inside += 2;
      }
      return { inside, left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    }, id);
  await expect.poll(async () => (await reading()).inside, {
    timeout: 5_000,
    message: "the edge runs through the node moved onto it",
  }).toBe(0);
  // And it is still on the line the edge used to take.
  const { left, right, top, bottom } = await reading();
  expect(middle.x > left && middle.x < right && middle.y > top && middle.y < bottom, "the node stayed where it was dropped").toBe(true);
});
