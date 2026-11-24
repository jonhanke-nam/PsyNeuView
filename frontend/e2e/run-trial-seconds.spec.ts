/**
 * Per-trial run times beside each trial number (#334).
 *
 * Runs the Simple Stroop demo and checks that every trial card in Per-trial
 * values reads "Trial N · X.XX s", with one time per trial returned by the
 * backend (`trial_seconds`, measured with PsyNeuLink's per-trial hooks).
 */
import { mutatingTest as test, expect } from "./test-base";

test.describe("per-trial run times (#334)", { tag: "@ci" }, () => {
  test("each trial row shows how many seconds it took", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: "Simple Stroop", exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("tab-run").click();
    const runResp = page.waitForResponse((r) => r.url().includes("/api/model/run") && r.ok(), {
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /Run Model/ }).click();
    const data = await (await runResp).json();

    // The backend returns one positive time per trial.
    expect(data.trial_seconds).toHaveLength(data.results.length);
    for (const s of data.trial_seconds) expect(s).toBeGreaterThan(0);

    // Each trial card's header carries its time.
    const headers = page.getByTestId("run-panel").getByTestId("run-trial-header");
    await expect(headers).toHaveCount(data.results.length, { timeout: 30_000 });
    const texts = await headers.allTextContents();
    texts.forEach((t, i) => {
      expect(t).toMatch(new RegExp(`^Trial ${i + 1} · \\d+\\.\\d\\d s$`));
    });
  });
});
