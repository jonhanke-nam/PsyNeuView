/**
 * Scheduler-condition (GSC) edges get unique ids per endpoint pair (#651/#699).
 *
 * A single `AfterNodes(A, B, C)` condition on TARGET expands to three scheduler
 * edges that all share the same owner/target (TARGET): A -> TARGET, B -> TARGET,
 * C -> TARGET. The edge id used to key only on the target, so all three collided
 * on one React Flow id and were garbled into a single mis-anchored edge ("coming
 * out of nowhere" / "attached to two nodes"). #699 keys the id on BOTH endpoints;
 * this asserts the three render as distinct edges.
 *
 * Uses a minimal fixture (e2e/fixtures/gsc_afternodes.py) rather than EGO: the
 * 0.19 EMComposition restructure removed EGO's STORE node / AfterNodes condition,
 * so the pattern no longer occurs there (#805). The fixture is a stable,
 * model-agnostic stand-in for exactly that condition.
 */
import { mutatingTest as test, expect } from "./test-base";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(__dirname, "fixtures", "gsc_afternodes.py");

test.describe("GSC scheduler-edge id uniqueness (#651/#699)", { tag: "@ci" }, () => {
  test("AfterNodes on a shared target renders one distinct edge per source", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(MODEL);
    await prompt.press("Enter");
    // Free-form fixture may prompt to convert to standardized format — skip it.
    await page
      .getByRole("button", { name: /^Skip$/ })
      .click({ timeout: 5000 })
      .catch(() => {});
    await expect(page.getByText("gsc_afternodes.py").first()).toBeVisible({
      timeout: 30000,
    });
    // Gate on the shared-target node so we don't snapshot a mid-reload state.
    await page.locator('.react-flow__node[data-id^="TARGET"]').first().waitFor({
      state: "attached",
      timeout: 30000,
    });

    // The regression: TARGET's AfterNodes condition expands to three edges that
    // all share TARGET as target. Pre-#699 the id keyed only on the target, so
    // they collided to one React Flow id (duplicate data-ids → garbled render).
    // Poll until the view settles with >=3 GSC edges and NO duplicate ids —
    // robust to the slower edge re-render in a production build.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const ids = [
              ...document.querySelectorAll('.react-flow__edge[data-id^="gsc_"]'),
            ].map((e) => e.getAttribute("data-id"));
            return ids.length >= 3 && new Set(ids).size === ids.length;
          }),
        { timeout: 20000 },
      )
      .toBe(true);
  });
});
