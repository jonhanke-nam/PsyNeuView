/**
 * Stepping a run: the graph and the trial card highlight the same nodes in
 * the same pale blue, step by step (#365).
 *
 * Steps Stroop and checks, at each of several steps:
 *  - the graph's nodes active at the step and the current trial card's
 *    highlighted rows are the same set;
 *  - both use the selection token (the node's ring and the row's ring are
 *    --pnv-selection-border, their fills the selection family);
 *  - no role colour is used for the step highlight;
 *  - rows not reached yet this trial are in the pending grey (a colour at
 *    AA, not an opacity: #412); cards for other trials
 *    have no step highlight.
 *
 * And steps EGO, whose EM composition is drawn collapsed: when the card's
 * active rows are nodes inside EM, the collapsed EM node carries the step
 * highlight, so the graph never goes blank while the card shows a step.
 *
 * Set STEP_HIGHLIGHT_SHOTS to a folder to also save screenshots.
 */
import path from "path";
import type { Locator, Page } from "@playwright/test";
import { readOnlyTest as test, expect, closePalette, fitGraph } from "./test-base";

const SHOTS = process.env.STEP_HIGHLIGHT_SHOTS;

const ROLE_TOKENS = [
  "--pnv-role-control",
  "--pnv-role-controller",
  "--pnv-role-cycle",
  "--pnv-role-feedback-sender",
  "--pnv-role-input",
  "--pnv-role-internal",
  "--pnv-role-learning",
  "--pnv-role-output",
  "--pnv-role-probe",
  "--pnv-role-singleton",
];

/** A palette token's value as the browser computes it, e.g. "rgb(26, 115, 232)". */
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

async function boxShadow(el: Locator): Promise<string> {
  return el.evaluate((e) => getComputedStyle(e).boxShadow);
}

/** The graph nodes drawn as active at the current step, by node id. */
async function graphActive(page: Page): Promise<string[]> {
  const ids = await page
    .locator('.react-flow__node:has([data-step-active="true"])')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute("data-id") ?? ""));
  return [...new Set(ids)].sort();
}

/** The current trial card's highlighted rows, by node name. */
async function cardActive(card: Locator): Promise<string[]> {
  const names = await card
    .locator('[data-testid="run-trial-node-band"][data-step="active"]')
    .evaluateAll((ns) => ns.map((n) => n.getAttribute("data-node") ?? ""));
  return [...new Set(names)].sort();
}

test.describe("step highlight (#365)", { tag: "@ci" }, () => {
  test("graph and current trial card highlight the same nodes in the selection blue", async ({ page }) => {
    test.setTimeout(150_000);
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

    const fill = await tokenColour(page, "--pnv-selection-fill");
    const border = await tokenColour(page, "--pnv-selection-border");
    const roles = await Promise.all(ROLE_TOKENS.map((t) => tokenColour(page, t)));
    // The step colour is not a role colour.
    expect(roles).not.toContain(border);

    const steps = 5;
    let sawPending = false;
    for (let i = 0; i < steps; i++) {
      await page.getByTestId("trace-next-step").click();
      const card = page.locator('[data-testid^="run-trial-card-"][data-active="true"]');
      await expect(card).toHaveCount(1);

      // Same set, graph and card, read once the graph has settled on it.
      await expect
        .poll(async () => {
          const g = await graphActive(page);
          const c = await cardActive(card);
          return g.length > 0 && JSON.stringify(g) === JSON.stringify(c);
        }, { message: `step ${i + 1}: graph and card agree` })
        .toBe(true);
      const active = await graphActive(page);

      for (const id of active) {
        const body = page.locator(`.react-flow__node[data-id="${id}"] [data-step-active="true"]`).first();
        // The step ring is the selection border, never a role colour. (The
        // node eases into it, so wait for the transition to land.)
        await expect.poll(() => boxShadow(body), { message: `${id}: ring` }).toContain(border);
        const shadow = await boxShadow(body);
        for (const r of roles) expect(shadow, `${id}: no role colour in the step ring`).not.toContain(r);
        const shape = await body.getAttribute("data-node-shape");
        if (shape === "oval" || shape === "rectangle" || shape === "circle") {
          await expect(body, `${id}: fill`).toHaveCSS("background-color", fill);
        }
        // The card's row for it: the same ring, no role colour.
        const row = card.locator(`[data-testid="run-trial-node-band"][data-node="${id}"][data-step="active"]`).first();
        const rowShadow = await boxShadow(row);
        expect(rowShadow, `${id}: row ring`).toContain(border);
        for (const r of roles) expect(rowShadow, `${id}: no role colour in the row`).not.toContain(r);
      }

      // Rows not reached yet this trial are all in the pending grey, a
      // colour that reads at AA, not an opacity (#412); others read normally.
      const pending = card.locator('[data-testid="run-trial-node-band"][data-step="pending"]');
      if ((await pending.count()) > 0) {
        sawPending = true;
        await expect(pending.first()).toHaveCSS("opacity", "1");
        const grey = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--pnv-step-pending-text)";
          document.body.appendChild(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        });
        const colours = await pending.first().locator("span").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
        expect(colours.length).toBeGreaterThan(0);
        for (const c of colours) expect(c, "a pending row's text is the pending grey").toBe(grey);
      }
      const done = card.locator('[data-testid="run-trial-node-band"][data-step="done"]');
      if ((await done.count()) > 0) await expect(done.first()).toHaveCSS("opacity", "1");

      // Other trials' cards carry no step highlight.
      await expect(
        page.locator('[data-testid^="run-trial-card-"][data-active="false"] [data-testid="run-trial-node-band"][data-step]'),
      ).toHaveCount(0);

      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, `stroop-step-${i + 1}.png`) });
      }
    }
    expect(sawPending, "some step had rows not reached yet").toBe(true);
  });

  test("a collapsed composition lights up when a node inside it runs (EGO)", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("EGO").first().click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 90_000 });
    await closePalette(page);
    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByTestId("run-trial-card-1")).toBeVisible({ timeout: 120_000 });
    const border = await tokenColour(page, "--pnv-selection-border");

    const em = page.locator('.react-flow__node[data-id="EM"] [data-testid="mechanism-node-body"]').first();
    await expect(em).toBeVisible();
    const onGraph = new Set(
      await page.locator(".react-flow__node").evaluateAll((ns) => ns.map((n) => n.getAttribute("data-id") ?? "")),
    );
    // Step until a step runs only nodes inside EM (none on the graph).
    let seen = false;
    for (let i = 0; i < 8 && !seen; i++) {
      await page.getByTestId("trace-next-step").click();
      const card = page.locator('[data-testid^="run-trial-card-"][data-active="true"]');
      const rows = await cardActive(card);
      if (rows.length === 0) continue;
      // A row not on the graph is a node inside EM: then (and only then) EM
      // carries the step highlight.
      if (rows.some((r) => !onGraph.has(r))) {
        await expect(em).toHaveAttribute("data-step-active", "true");
        await expect.poll(() => boxShadow(em), { message: "EM: ring" }).toContain(border);
        if (rows.every((r) => !onGraph.has(r))) seen = true;
      } else {
        await expect(em).not.toHaveAttribute("data-step-active", "true");
      }
    }
    expect(seen, "some step ran only nodes inside EM").toBe(true);
  });
});
