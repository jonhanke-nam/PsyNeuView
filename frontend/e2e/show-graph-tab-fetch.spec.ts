import { readOnlyTest as test, expect } from "./test-base";

// #22: the show_graph tab stays mounted while hidden, and it used to fetch
// show_graph's picture on every model open. Each fetch reloads the model in
// the model runner, which handles one request at a time, so the hidden fetch
// held up everything behind it (the "Like show_graph" layout, a PyTorch view
// reload). It fetches only while the tab is showing.
test("show_graph tab fetches only while it is showing @ci", async ({ page }) => {
  const pictures: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/model/show-graph") && !(r.postData() || "").includes('"format":"dot"')) {
      pictures.push(r.url());
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page
    .getByText("Conflict Monitoring — Stroop (Botvinick et al. 2001)", { exact: true })
    .first()
    .click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/loaded in \d/i)).toBeVisible({ timeout: 10000 });

  // Opened, tab hidden: no picture asked for. (Before the fix it was asked
  // for at once, alongside the load's follow-up requests.)
  await page.waitForTimeout(2000);
  expect(pictures).toHaveLength(0);

  // Showing the tab asks once.
  const asked = page.waitForRequest((r) => r.url().includes("/api/model/show-graph"));
  await page.getByTestId("tab-show_graph").click();
  await asked;
  expect(pictures).toHaveLength(1);

  // Away and back with nothing changed: the picture it has is still right.
  await page.getByTestId("tab-inspector").click();
  await page.getByTestId("tab-show_graph").click();
  await page.waitForTimeout(1000);
  expect(pictures).toHaveLength(1);
});
