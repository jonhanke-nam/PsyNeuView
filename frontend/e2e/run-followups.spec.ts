/**
 * Run and Learn follow-ups (#357).
 *
 * 1. While a run is going, "Trial 3 of 10 · 0.42 s" sits beside "Running… Xs".
 * 2. Learn shows each trial's time when training finishes.
 * 3. Each saved run says whether it matches the open file.
 * 4. Arranged by node, the sticky Run row never covers a node's header.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";

const STROOP = "Stroop — Basic";

async function openStroop(page: Page) {
  await page.goto("/");
  await closePalette(page);
  await page.getByTestId("open-menu").click();
  await page.getByRole("button", { name: STROOP, exact: true }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("tab-run").click();
  return page.getByTestId("run-panel");
}

test.describe("Run and Learn follow-ups (#357)", { tag: "@ci" }, () => {
  test("a run in flight shows which trial it is on", async ({ page }) => {
    test.setTimeout(120_000);
    const panel = await openStroop(page);

    // Hold the run until the progress has been shown, and answer the progress
    // poll with a run three trials into ten. The backend side (one event per
    // trial, from the worker's hook) is pinned by test_run_progress.py.
    let progressId = "";
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/model/run/progress/*", (route) => {
      progressId = decodeURIComponent(route.request().url().split("/").pop() || "");
      return route.fulfill({ json: { trial: 3, total: 10, seconds: 0.4213 } });
    });
    await page.route("**/api/model/run", async (route) => {
      await held;
      await route.continue();
    });

    const sent = page.waitForRequest((r) => r.url().endsWith("/api/model/run"));
    await panel.getByRole("button", { name: "Run Model" }).click();
    const body = (await sent).postDataJSON();
    expect(body.progress_id).toBeTruthy();

    const progress = panel.getByTestId("run-trial-progress");
    await expect(progress).toHaveText("Trial 3 of 10 · 0.42 s", { timeout: 10_000 });
    await expect(panel.getByRole("button", { name: /^Running… / })).toBeVisible();
    expect(progressId).toBe(body.progress_id);

    release();
    await expect(panel.getByTestId("run-results-body")).toBeVisible({ timeout: 60_000 });
    await expect(progress).toHaveCount(0);
  });

  test("Learn shows each trial's time", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByText("TD Learning", { exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    await page.getByText("Learn", { exact: true }).first().click();
    await page.getByRole("button", { name: /Start Learning/i }).click();
    await expect(page.getByText(/Training complete/i)).toBeVisible({ timeout: 120_000 });

    const times = page.getByTestId("learn-trial-time");
    const trials = Number(await page.getByTestId("learn-trials").inputValue());
    await expect(times).toHaveCount(trials);
    const texts = await times.allTextContents();
    texts.forEach((t, i) => expect(t).toMatch(new RegExp(`Trial ${i + 1} · \\d+\\.\\d+ s$`)));
  });

  test("a saved run says whether it matches the open file", async ({ page }) => {
    test.setTimeout(180_000);
    const models = (await (await page.request.get("/api/reference-models")).json()).models;
    const rm = models.find((m: { label: string }) => m.label === STROOP);
    const loaded = await (await page.request.post("/api/reference-models/load", { data: { name: rm.name } })).json();
    const original = loaded.source as string;
    const panel = await openStroop(page);
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/model/run") && r.ok(), { timeout: 60_000 }),
      panel.getByRole("button", { name: "Run Model" }).click(),
    ]);
    const note = panel.getByTestId("run-record-version").first();
    await expect(note).toHaveAttribute("data-version", "matches", { timeout: 10_000 });
    await expect(note).toHaveText("Matches the open file");

    // Edit the model: the saved run is now from an earlier version.
    const editor = page.locator(".cm-content");
    expect(original).toContain("gain=1.1");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(original.replace("gain=1.1", "gain=1.7"));
    await expect(note).toHaveAttribute("data-version", "earlier", { timeout: 10_000 });
    await expect(note).toHaveText("From an earlier version");
  });

  test("arranged by node, the sticky Run row never covers a node header", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1200, height: 800 });
    const panel = await openStroop(page);
    await panel.getByTestId("run-grouping").getByRole("button", { name: "By node" }).click();

    const row = panel.getByTestId("run-sticky-row");
    const header = panel.locator('[data-testid^="run-input-"] > label').first();
    await expect(header).toBeVisible();

    const overlap = async () => {
      const r = (await row.boundingBox())!;
      const h = (await header.boundingBox())!;
      return r.y + r.height - h.y;
    };
    // At rest, and with the header scrolled to the top of the panel.
    expect(await overlap()).toBeLessThanOrEqual(0);
    await header.evaluate((el) => el.scrollIntoView({ block: "start" }));
    expect(await overlap()).toBeLessThanOrEqual(0);
  });
});
