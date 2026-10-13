/**
 * A walkthrough opens its model however the bundled lists arrive.
 *
 * The toolbar fetches the demos and the reference models side by side. A
 * walkthrough used to look its model up as soon as *either* answered, so when
 * demos came back first, one written for a reference model (Stroop) found
 * nothing and said its model "didn't open". It showed up under load, when three
 * builds shared one machine. Here the reference models are held back on
 * purpose, so the order that broke it happens every time.
 */
import { mutatingTest as test, expect } from "../test-base";

test("the demo walkthrough opens Stroop even when the reference models answer last", async ({ page }) => {
  await page.route("**/api/reference-models", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ response });
  });
  await page.goto("/?tour=demo");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("didn't open")).toHaveCount(0);
});
