/**
 * One pale-blue selection colour (#335).
 *
 * Stepping through Stroop: the current trial's card in Per-trial values is
 * the selection blue (it was the trace green, which read as an input node's
 * green), and the same blue rings a selected node on the graph. Each node's
 * rows carry a left band in its role colour, and the labels read "Show Δ"
 * and "Results".
 *
 * Set SELECTION_SHOTS to a folder to also save screenshots, light and dark.
 */
import path from "path";
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect, closePalette, fitGraph } from "./test-base";

const SHOTS = process.env.SELECTION_SHOTS;

/** A palette token's value as the browser computes it, e.g. "rgb(232, 240, 254)". */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
}

async function openAndRunStroop(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByText("Stroop").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await closePalette(page);
  await fitGraph(page);
  await page.getByTestId("tab-run").click();
  await page.getByRole("button", { name: /Run Model/ }).click();
  await expect(page.getByTestId("run-trial-card-1")).toBeVisible({ timeout: 60_000 });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`one selection colour (#335), ${scheme}`, { tag: "@ci" }, () => {
    test("current trial, selected node, node bands and labels", async ({ page }) => {
      test.setTimeout(150_000);
      await page.emulateMedia({ colorScheme: scheme });
      await openAndRunStroop(page);
      const fill = await tokenColour(page, "--pnv-selection-fill");
      const border = await tokenColour(page, "--pnv-selection-border");

      // Labels.
      await expect(page.getByTestId("run-trial-deltas")).toHaveText("Show Δ");
      await expect(page.getByTestId("run-results-table-toggle")).toHaveText("Results");

      // Step the trace: the current trial's card is the selection blue.
      await page.getByTestId("trace-next-step").click();
      const active = page.locator('[data-testid^="run-trial-card-"][data-active="true"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveCSS("background-color", fill);
      await expect(active).toHaveCSS("border-top-color", border);

      // Show Δ, on, is the selection blue too (it was warning orange).
      const deltas = page.getByTestId("run-trial-deltas");
      await deltas.click();
      await expect(deltas).toHaveAttribute("aria-pressed", "true");
      await expect(deltas).toHaveCSS("background-color", fill);
      await expect(deltas).toHaveCSS("border-top-color", border);

      // Each node's rows carry its role colour, as on the graph.
      const card1 = page.getByTestId("run-trial-card-1");
      const band = (node: string) => card1.locator(`[data-testid="run-trial-node-band"][data-node="${node}"]`).first();
      await expect(band("color_input")).toHaveCSS("border-left-color", await tokenColour(page, "--pnv-role-input"));
      await expect(band("color_hidden")).toHaveCSS("border-left-color", await tokenColour(page, "--pnv-role-internal"));
      if (SHOTS) {
        await active.scrollIntoViewIfNeeded();
        await page.getByTestId("run-panel").screenshot({ path: path.join(SHOTS, `after-${scheme}-per-trial.png`) });
      }

      // A selected node's ring is the same selection border. (A node firing
      // at the current step is drawn as firing instead, so pick one that isn't.)
      let id = "";
      for (const candidate of ["decision", "output", "task_input", "color_hidden", "word_hidden"]) {
        const html = await page.locator(`.react-flow__node[data-id="${candidate}"]`).innerHTML();
        if (!html.includes("--pnv-trace-active")) {
          id = candidate;
          break;
        }
      }
      expect(id, "a node not firing at this step").not.toBe("");
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await node.click();
      await expect(node).toHaveClass(/selected/);
      const ringStyles = await node.evaluate((n) =>
        [n, ...n.querySelectorAll("*")].map((e) => e.getAttribute("style") ?? "").join("\n"),
      );
      expect(ringStyles).toContain("var(--pnv-selection-border)");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `after-${scheme}-selected-node.png`) });
    });
  });
}
