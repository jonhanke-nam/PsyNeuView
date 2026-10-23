import { readOnlyTest as test, expect } from "./test-base";

// #37: the delay typed in Settings must take effect however Settings is
// closed, not only after Enter.
test("autosave delay typed in Settings is kept when Settings closes with Escape", async ({ page }) => {
  await page.request.post("/api/settings/autosave", { data: { enabled: false, seconds: 10 } });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-general").click();
  await page.getByTestId("setting-autosave").check();
  const delay = page.getByTestId("setting-autosave-delay");
  await delay.click();
  await delay.press("ControlOrMeta+a");
  await delay.pressSequentially("3");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await (await page.request.get("/api/settings/autosave")).json()).seconds, { timeout: 5000 })
    .toBe(3);
  await page.request.post("/api/settings/autosave", { data: { enabled: false, seconds: 10 } });
});
