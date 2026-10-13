/**
 * The Open menu describes the PsyNeuLink that is installed now (#1395).
 *
 * After a switch to a local checkout, the open window's menu still named the
 * old install ("from PrincetonUniversity/PsyNeuLink @ devel", a site-packages
 * path) until the window was reloaded: it fetched where the Library comes from
 * once at load, and again only on the switch announcement, which can come
 * while the server restarts. Here the server's answer changes under a page
 * that is already open, with no announcement at all.
 */
import { readOnlyTest as test, expect } from "./test-base";

test.describe("Open menu after a PsyNeuLink source switch", { tag: "@ci" }, () => {
  test("reopening the menu shows the new install without a reload", async ({ page }) => {
    const github = {
      version: "0.21.0.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
      commit: "67cc927", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
    };
    const checkout = { ...github, source: "editable", path: "/Users/someone/MyCheckout" };
    let switched = false;
    await page.route("**/api/catalog-sources", async (route) => {
      const real = await (await route.fetch()).json();
      await route.fulfill({
        json: switched
          ? { ...real, pnl: checkout, library: "/Users/someone/MyCheckout/psyneulink/library/models" }
          : { ...real, pnl: github, library: "/Users/someone/site-packages/psyneulink/library/models" },
      });
    });

    await page.goto("/");
    const openButton = page.getByTestId("open-menu");
    const header = page.getByTestId("open-menu-section-library");

    await openButton.click();
    await expect(header).toContainText("from PrincetonUniversity/PsyNeuLink @ devel");
    await expect(header).toHaveAttribute("title", /site-packages/);
    await openButton.click();

    switched = true;
    await openButton.click();
    await expect(header).toContainText("MyCheckout");
    await expect(header).toHaveAttribute("title", /MyCheckout\/psyneulink\/library\/models/);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});
