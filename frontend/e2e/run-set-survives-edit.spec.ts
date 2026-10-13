/**
 * A chosen run set survives a parameter edit (#57).
 *
 * Editing a parameter in the Inspector rewrites the file and reloads the
 * model. The reload used to refill the Run tab's grid from scratch: the first
 * declared set, or the 1-per-trial defaults when no set was small enough to
 * preload, with the trial count left as it was. So a set picked just before
 * (or while) the reload landed was silently swapped for other inputs. CI hit
 * it in the Conflict Monitoring walkthrough: "incongruent" was picked, the
 * reload from the gain edit landed a moment later, and the run used the
 * defaults (the walkthrough's lesson, that more control resolves the
 * conflict, then failed its check).
 */
import { mutatingTest as test, expect, clickCanvasNode } from "./test-base";

test.use({ viewport: { width: 1600, height: 1000 } });

test("a parameter edit keeps the run set the learner chose", { tag: "@ci" }, async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: "Bistable Attractor", exact: true }).click();
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });

  // The demo opens with its first set, kick; choose the second.
  await page.getByTestId("tab-run").click();
  const from = page.getByTestId("run-input-set");
  await expect(from).toHaveValue("kick", { timeout: 10_000 });
  await from.selectOption("steady_difference");

  // Edit a parameter: the file is rewritten and the model reloaded.
  await clickCanvasNode(page, "node_attract1");
  await page.getByTestId("tab-inspector").click();
  const gain = page.getByTestId("param-gain");
  await expect(gain).toBeVisible({ timeout: 10_000 });
  const committed = page.waitForResponse(
    (r) => r.url().includes("/api/model/update-param") && r.request().method() === "POST",
  );
  await gain.click();
  await gain.fill("2");
  await gain.press("Enter");
  await committed;
  await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 30_000 });

  // Still the chosen set, and its inputs are what a run sends.
  await page.getByTestId("tab-run").click();
  await expect(from).toHaveValue("steady_difference");
  const sent = page.waitForRequest(
    (r) => r.url().includes("/api/model/run") && r.method() === "POST",
  );
  await page.getByTestId("run-panel").getByRole("button", { name: /Run Model/ }).click();
  const inputs = (await sent).postDataJSON().inputs as Record<string, number[][]>;
  // steady_difference: 0 and 1 on every one of its ten trials.
  const rows = Object.values(inputs);
  expect(rows.every((r) => r.length === 10)).toBe(true);
  expect(rows.map((r) => r[0][0]).sort()).toEqual([0, 1]);
  expect(rows.every((r) => r.every((t) => t[0] === r[0][0]))).toBe(true);
});
