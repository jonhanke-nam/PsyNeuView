/**
 * The trace bar's auto-play button says what it does (#338).
 *
 * It used to show only "⏵⏵", which read like fast-forward. It now reads
 * "▶ Auto-play", "⏸ Pause" while playing, and Auto-play again once paused;
 * the speed select beside it is labelled Speed; and the bar stays on one
 * row at the default window width, with the button as tall as the step
 * buttons.
 *
 * Set TRACE_AUTOPLAY_SHOTS to a folder to also save screenshots.
 */
import path from "path";
import { mutatingTest as test, expect } from "./test-base";

const SHOTS = process.env.TRACE_AUTOPLAY_SHOTS;

test.describe("the trace bar's auto-play button (#338)", { tag: "@ci" }, () => {
  test("reads Auto-play, then Pause while playing, then Auto-play again", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");

    await page.getByTestId("open-menu").click();
    await page.getByRole("button", { name: "Hopfield Network", exact: true }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByTestId("run-panel").getByText(/^Trial 6$/)).toBeVisible({ timeout: 60_000 });

    const play = page.getByTestId("trace-autoplay");
    const next = page.getByTestId("trace-next-step");
    await expect(play).toBeVisible({ timeout: 15_000 });
    await expect(play).toHaveText("▶ Auto-play");
    await expect(play).toHaveAttribute("title", "Step through the run automatically. Choose the speed beside it.");
    await expect(page.getByTestId("trace-autoplay-speed"), "the speed select is labelled Speed").toHaveAccessibleName(/^Speed/);

    // One row at the default width, and the button as tall as the step buttons.
    const bar = next.locator("..");
    const barBox = (await bar.boundingBox())!;
    const playBox = (await play.boundingBox())!;
    const nextBox = (await next.boundingBox())!;
    expect(barBox.height, "the trace bar does not wrap").toBeLessThan(nextBox.height * 1.8 + 14);
    expect(Math.abs(playBox.y + playBox.height / 2 - (nextBox.y + nextBox.height / 2)), "same row").toBeLessThan(2);
    expect(playBox.height, "no taller than the step buttons").toBeLessThanOrEqual(nextBox.height + 0.5);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "01-auto-play.png") });

    // Slowest speed, so it is still playing when checked.
    await page.getByTestId("trace-autoplay-speed").selectOption("0.25");
    await play.click();
    await expect(play).toHaveText("⏸ Pause");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "02-pause-while-playing.png") });

    await play.click();
    await expect(play).toHaveText("▶ Auto-play");
    await expect(play).toHaveAttribute("aria-pressed", "false");
  });
});
