/**
 * The walkthrough ring follows Settings ▸ Tutorials and Voice ▸ Highlight (#100):
 * its thickness, colour and pulse, and the arrow is off unless asked for.
 */
import { mutatingTest as test, expect } from "./test-base";

test.describe("Walkthrough highlight settings", { tag: "@ci" }, () => {
  test("defaults: a medium blue ring that pulses gently, and no arrow", async ({ page }) => {
    await page.goto("/?tour=orientation-window");
    const ring = page.getByTestId("tour-highlight");
    await expect(ring).toBeVisible({ timeout: 30_000 });
    await expect(ring).toHaveCSS("border-top-width", "4px");
    await expect(ring).toHaveAttribute("data-pulse", "gentle");
    await expect(ring).toHaveClass(/pnv-tour-ring-pulse-gentle/);
    await expect(page.getByTestId("tour-pointer")).toHaveCount(0);
    // Without the arrow, a pointer step shows its words at once.
    await expect(page.getByTestId("tour-instruction")).not.toHaveText("…");
  });

  test("the chosen thickness, colour and pulse reach the ring", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("psyneuview.tour.ringThickness", "thick");
      localStorage.setItem("psyneuview.tour.ringColor", "orange");
      localStorage.setItem("psyneuview.tour.ringPulse", "off");
    });
    await page.goto("/?tour=orientation-window");
    const ring = page.getByTestId("tour-highlight");
    await expect(ring).toBeVisible({ timeout: 30_000 });
    await expect(ring).toHaveCSS("border-top-width", "6px");
    await expect(ring).toHaveAttribute("data-pulse", "off");
    await expect(ring).not.toHaveClass(/pnv-tour-ring-pulse/);
    const orange = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--pnv-walkthrough-ring-orange)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    await expect(ring).toHaveCSS("border-top-color", orange);
  });

  test("Settings changes the ring, and the sample shows it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-tutorials-voice").click();
    await page.getByTestId("setting-tour-ring-thickness").selectOption("thin");
    await expect(page.getByTestId("tour-ring-sample")).toHaveCSS("border-top-width", "2px");
    await page.getByTestId("setting-tour-arrow").check();
    expect(await page.evaluate(() => localStorage.getItem("psyneuview.tour.showArrow"))).toBe("on");
    expect(await page.evaluate(() => localStorage.getItem("psyneuview.tour.ringThickness"))).toBe("thin");
  });
});
