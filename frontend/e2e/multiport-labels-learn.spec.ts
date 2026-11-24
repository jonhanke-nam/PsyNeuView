/**
 * Input nodes with several input ports, follow-ups (#358).
 *
 * 1. With the grid setting on, the Run panel labels each box of a
 *    multi-port node by its element name, per port, from the model's
 *    labels (here a sidecar beside the two-port fixture).
 * 2. The Learn panel's input grid gives a multi-port node one group of
 *    boxes per port, headed by the port's name, and sends a trial as one
 *    array per port.
 */
import { mutatingTest as test, expect, type Page } from "./test-base";
import { copyFileSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../backend/tests/fixtures");

const LABELS = `task_demand:
  input_ports:
    RED_task:
      element_names: [red, green]
    WORD_task:
      element_names: [word]
`;

async function openModel(page: Page, name: string): Promise<void> {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "multiport358-"));
  const model = path.join(dir, `${name}.py`);
  copyFileSync(path.join(FIXTURES, `${name}.py`), model);
  writeFileSync(path.join(dir, `${name}.labels.yaml`), LABELS);
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 60_000 });
}

test("the grid names a multi-port node's elements per port", { tag: "@ci" }, async ({ page }) => {
  await openModel(page, "two_port_input");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-general").click();
  await page.getByTestId("setting-run-input-cell-grid").check();
  await page.keyboard.press("Escape");

  await page.getByTestId("tab-run").click();
  const trial1 = page.getByTestId("run-panel").getByTestId("run-trial-group-1");
  for (const name of ["red", "green", "word"]) {
    await expect(trial1.getByText(name, { exact: true })).toBeVisible();
  }
  // Positions remain only on the one-port node beside it, which has no labels.
  await expect(trial1.getByText("[1]", { exact: true })).toHaveCount(1);
});

test("the Learn panel edits each input port and sends one array per port", { tag: "@ci" }, async ({ page }) => {
  await openModel(page, "two_port_learn");
  await page.getByTestId("tab-learn").click();

  // One group per port, headed by its name, its boxes by element name.
  await expect(page.getByTestId("learn-input-task_demand-port-RED_task")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("learn-input-task_demand-port-WORD_task")).toBeVisible();
  for (const name of ["red", "green", "word"]) {
    await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
  }

  await page.getByTestId("learn-trials").fill("1");
  await page.getByTestId("learn-input-task_demand-0-0").fill("0");
  await page.getByTestId("learn-input-task_demand-0-1").fill("1");
  await page.getByTestId("learn-input-task_demand-0-2").fill("1");

  // Answer the submit without training: only the request is under test.
  let body: { inputs: Record<string, unknown[]>; targets: Record<string, unknown[]> } | null = null;
  await page.route("**/api/jobs", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Held for the test." }) });
  });
  await page.getByRole("button", { name: "Start Learning" }).click();
  await expect.poll(() => body).not.toBeNull();
  expect(body!.inputs.task_demand).toEqual([[[0, 1], [1]]]);
  expect(Object.values(body!.targets)[0]).toEqual([[1, 0]]);
});
