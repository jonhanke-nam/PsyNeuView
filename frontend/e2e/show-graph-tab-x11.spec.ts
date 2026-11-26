/**
 * #424: the show_graph tab draws show_graph's colours as its PDF does.
 *
 * Graphviz leaves colour names in its SVG ("green"), which a browser reads
 * from the CSS table (#008000), not the X11 one show_graph's PDF draws with
 * (#00ff00). The backend rewrites every name to its X11 hex value before the
 * tab gets the SVG. Checked here in the page itself: the colours the browser
 * actually computes for the INPUT, OUTPUT and grey nodes.
 *
 * Needs the Graphviz programs on the machine running the backend (the tab
 * renders show_graph's picture with them); skipped where there are none.
 */
import { mutatingTest as test, expect } from "./test-base";
import { writeFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// INPUT (green), OUTPUT (red), and an ordinary node drawn grey through the
// composition's own show_graph settings.
const MODEL = `import psyneulink as pnl

stimulus = pnl.TransferMechanism(name="stimulus")
hidden = pnl.TransferMechanism(name="hidden")
decision = pnl.TransferMechanism(name="decision")

comp = pnl.Composition(name="every_role", show_graph_attributes={"default_node_color": "grey"})
comp.add_linear_processing_pathway([stimulus, hidden, decision])
`;

test("show_graph tab: nodes take show_graph's X11 colours, not the browser's", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "x11-424-"));
  const model = path.join(dir, "every_role.py");
  writeFileSync(model, MODEL);

  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  const picture = page.waitForResponse(
    (r) => r.url().includes("/api/model/show-graph") && !(r.request().postData() || "").includes('"format":"dot"'),
    { timeout: 60_000 },
  );
  await page.getByTestId("tab-show_graph").click();
  const response = await picture;
  if (!response.ok()) {
    const detail = String((await response.json().catch(() => ({})))?.detail ?? "");
    test.skip(/graphviz|executable|dot/i.test(detail), `no Graphviz programs here: ${detail.slice(0, 120)}`);
  }
  expect(response.ok()).toBe(true);

  /** The colour the browser computes for a node's outline in the tab's SVG, by node name. */
  const stroke = (name: string) =>
    page.locator("svg g.node", { has: page.locator(`title:text-is("${name}")`) }).first().locator("ellipse, polygon").first()
      .evaluate((el) => getComputedStyle(el).stroke);
  await expect(page.locator("svg g.node").first()).toBeVisible({ timeout: 30_000 });

  expect(await stroke("stimulus")).toBe("rgb(0, 255, 0)"); // X11 green; the CSS green would be rgb(0, 128, 0)
  expect(await stroke("decision")).toBe("rgb(255, 0, 0)");
  expect(await stroke("hidden")).toBe("rgb(192, 192, 192)"); // Graphviz's grey; the CSS grey would be rgb(128, 128, 128)
});
