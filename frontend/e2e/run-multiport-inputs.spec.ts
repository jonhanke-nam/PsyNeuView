/**
 * Input nodes with several input ports (#332).
 *
 * Loads a small model whose task_demand node has two input ports, RED_task
 * (2 elements) and WORD_task (1), and checks each port gets its own field,
 * labelled with the port's name and its shape as the placeholder, a wrong
 * length is flagged, and the read-only line under them shows the node's
 * whole input as Composition.run takes it. Runs, and checks the inputs sent
 * are one array per port per trial. The one-port node beside it keeps its
 * single field.
 */
import { mutatingTest as test, expect } from "./test-base";
import { copyFileSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../backend/tests/fixtures/two_port_input.py",
);

test("a two-port input node takes one array per port", { tag: "@ci" }, async ({ page }) => {
  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "multiport332-"));
  const model = path.join(dir, "two_port_input.py");
  copyFileSync(FIXTURE, model);
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.locator(".react-flow__edge").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("tab-run").click();
  const panel = page.getByTestId("run-panel");
  const runButton = panel.getByRole("button", { name: /Run Model/ });
  await expect(runButton).toBeVisible();

  // The one-port node is unchanged: a single field, no per-port label.
  await expect(panel.getByTestId("run-trial-input-color_input-1")).toHaveValue("[1, 0]");
  await expect(panel.getByTestId("run-trial-whole-color_input-1")).toHaveCount(0);

  // One labelled field per port, its shape as the placeholder.
  const red = panel.getByTestId("run-trial-input-task_demand-1-RED_task");
  const word = panel.getByTestId("run-trial-input-task_demand-1-WORD_task");
  await expect(red).toHaveAttribute("placeholder", "[_, _]");
  await expect(word).toHaveAttribute("placeholder", "[_]");
  await expect(panel.getByTestId("run-trial-group-1").getByText("RED_task", { exact: true })).toBeVisible();
  await expect(panel.getByTestId("run-trial-group-1").getByText("WORD_task", { exact: true })).toBeVisible();

  // A wrong length is flagged on its port and blocks the run.
  await red.fill("[1, 0, 1]");
  await expect(panel.getByTestId("run-trial-input-error-task_demand-1-RED_task")).toHaveText("Needs 2 numbers, got 3");
  await expect(runButton).toBeDisabled();

  await red.fill("[0, 1]");
  await word.fill("[1]");
  await expect(panel.getByTestId("run-trial-input-error-task_demand-1-RED_task")).toHaveCount(0);
  await expect(panel.getByTestId("run-trial-whole-task_demand-1")).toHaveText("= [[0, 1], [1]]");
  await expect(runButton).toBeEnabled();

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/model/run") && r.method() === "POST"),
    runButton.click(),
  ]);
  const body = request.postDataJSON() as { inputs: Record<string, unknown[]> };
  expect(body.inputs.task_demand[0]).toEqual([[0, 1], [1]]);
  expect(body.inputs.color_input[0]).toEqual([1, 0]);
  await expect(panel.getByText(/Results \(\d+ trials?\)/)).toBeVisible({ timeout: 60_000 });

  // By node: the same per-port fields, the ports named in the header.
  await panel.getByTestId("run-grouping").getByRole("button", { name: "By node" }).click();
  await expect(panel.getByText(/task_demand\s*\[2 ports: RED_task 2, WORD_task 1\]/)).toBeVisible();
  await expect(panel.getByTestId("run-trial-input-task_demand-1-RED_task")).toHaveValue("[0, 1]");
  await expect(panel.getByTestId("run-trial-whole-task_demand-1")).toHaveText("= [[0, 1], [1]]");
});
