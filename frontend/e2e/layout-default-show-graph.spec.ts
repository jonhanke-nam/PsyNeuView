import { readOnlyTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

/**
 * #24: on a first run, models with no layout of their own open "Like
 * show_graph", and Settings ▸ Appearance ▸ Automatic layout says that is the
 * default. (The shared test setup keeps Layered for the rest of the suite, so
 * this spec clears that choice first, as a new user's browser would have none.)
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(__dirname, "../../backend/demos/feedforward_network.py");

test("a first run opens models Like show_graph, the default in Settings @ci", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("psyneuview.graph.layoutDefault"));
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/model/show-graph") && (r.postData() || "").includes('"format":"dot"')) {
      asked.push(r.url());
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(DEMO);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });

  // The toolbar's layout menu shows the model was laid out like show_graph,
  // and show_graph was asked for its arrangement.
  await expect(page.locator('select:has(option[value="showgraph"])')).toHaveValue("showgraph");
  await expect.poll(() => asked.length, { timeout: 30000 }).toBeGreaterThan(0);

  // Settings says it's the default.
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-appearance").click();
  const setting = page.getByTestId("setting-graph-layout-default");
  await expect(setting).toHaveValue("showgraph");
  await expect(setting.locator('option[value="showgraph"]')).toHaveText("Like show_graph (default)");
});
