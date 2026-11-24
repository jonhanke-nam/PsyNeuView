/**
 * The test browser reports the platform it really runs on, so the app's ⌘/Ctrl
 * agrees with Playwright's ControlOrMeta on a Mac and on Linux CI alike (#402).
 *
 * Before, the "Desktop Chrome" profile told the page it was on Windows. On a
 * Mac, ControlOrMeta sent ⌘ to an app listening for Ctrl, so shortcut specs
 * passed or failed differently locally and on CI. If this spec fails, that
 * mismatch is back.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { HOST_IS_MAC, modLabel, userAgentForHost } from "./hostPlatform";

test.describe("The test browser reports the real platform (#402)", { tag: "@ci" }, () => {
  test("the page is told the host's platform, not Windows", async ({ page }) => {
    await page.goto("/");
    const reported = await page.evaluate(() => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      return { platform: nav.platform, userAgent: nav.userAgent, uaData: nav.userAgentData?.platform ?? "" };
    });
    expect(reported.platform).not.toBe("Win32");
    expect(reported.userAgent).not.toContain("Windows");
    expect(/mac/i.test(reported.platform)).toBe(HOST_IS_MAC);
    expect(/mac/i.test(reported.userAgent)).toBe(HOST_IS_MAC);
    if (reported.uaData) expect(/mac/i.test(reported.uaData)).toBe(HOST_IS_MAC);
  });

  test("ControlOrMeta reaches the app's shortcuts, and they read ⌘ on a Mac, Ctrl elsewhere", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-toolbar")).toBeVisible({ timeout: 30_000 });
    // ⌘/ on a Mac, Ctrl+/ elsewhere: Help ▸ Keyboard Shortcuts.
    await page.keyboard.press("ControlOrMeta+/");
    const reference = page.getByTestId("shortcuts-reference");
    await expect(reference).toBeVisible();
    await expect(reference.getByTestId("shortcuts-reference-keys-inspector.focus")).toHaveText(modLabel("i"));
  });

  test("only the platform part of the user agent changes", () => {
    const windows =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
    expect(userAgentForHost(windows, "darwin")).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
    expect(userAgentForHost(windows, "linux")).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    );
  });
});
