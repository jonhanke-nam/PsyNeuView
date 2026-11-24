/**
 * The assistant's page secret in a browser (#381), against the real backend.
 *
 * No HTTP route serves the secret (the harness's test-only route aside). A
 * tab without it is told, in Settings, how to get it; the one-time link the
 * server prints puts it into the tab and leaves the address bar clean.
 */
import { readOnlyTest as test, expect } from "./test-base";

const KEY = "psyneuview.pageSecret";

async function openAssistantSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-assistant").click();
}

test.describe("AI assistant page secret (#381)", { tag: "@ci" }, () => {
  test("a tab without the secret says how to get it", async ({ page }) => {
    // After the harness's own seeding: this tab has no secret.
    await page.addInitScript((key) => sessionStorage.removeItem(key), KEY);
    await page.goto("/");
    await openAssistantSettings(page);
    await expect(page.getByTestId("assistant-settings-error")).toContainText("#pnv-session");
  });

  test("the one-time link gives the tab the secret and leaves the address clean", async ({ page, request }) => {
    const { secret } = (await (await request.get("/api/test/page-secret")).json()) as { secret: string };
    // Only the link may supply it: clear whatever the harness seeded, once.
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem("pnv-test-cleared")) {
        sessionStorage.removeItem(key);
        sessionStorage.setItem("pnv-test-cleared", "1");
      }
    }, KEY);
    await page.goto(`/#pnv-session=${encodeURIComponent(secret)}`);
    await expect(page.getByTestId("tab-inspector")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(secret);
    await openAssistantSettings(page);
    await expect(page.getByTestId("setting-assistant-enabled")).toBeVisible();
    await expect(page.getByTestId("assistant-settings-error")).toHaveCount(0);
  });
});
