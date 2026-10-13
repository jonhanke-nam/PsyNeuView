import { type ConsoleMessage } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";

// Tag with @smoke so CI can run only the smoke surface on PRs.
test.describe("@smoke app shell", { tag: "@ci" }, () => {
  test("loads with toolbar, palette, and canvas — no console errors", async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto("/");

    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await expect(page.getByTestId("palette-sidebar")).toBeVisible();
    await expect(page.getByTestId("graph-canvas")).toBeVisible();

    const settingsResp = await request.get("/api/settings/info");
    expect(settingsResp.status()).toBe(200);

    expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});
