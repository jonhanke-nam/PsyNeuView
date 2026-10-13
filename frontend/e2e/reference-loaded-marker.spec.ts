/**
 * Loaded-reference marker in the Open dropdown (#830).
 *
 * When a bundled reference model is loaded, its entry in the Open dropdown is
 * marked (aria-current="true" + a ✓) so you can see at a glance which one is
 * active and avoid reloading the same one. The marker must:
 *  - appear on exactly the loaded reference,
 *  - move when a different reference is loaded, and
 *  - disappear when a non-reference model (a demo) is loaded.
 *
 * The Open button *toggles* the dropdown, and loading any model auto-closes it —
 * so every openMenu() here is called from a known-closed state (initial load, or
 * right after a load), and items are clicked while the menu is open.
 */
import { mutatingTest as test, expect } from "./test-base";

// Labels mirror backend REFERENCE_MODELS; two lightweight models + a demo.
const FIRST = "Stroop — Basic";
const SECOND = "Stroop — with Locus Coeruleus (LC)";
const DEMO = "Simple Stroop";

type Page = import("@playwright/test").Page;

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /Open/ }).first().click();
}

/** The set of node ids currently on the canvas, order-independent. */
async function nodeSignature(page: Page): Promise<string> {
  return page
    .locator(".react-flow__node")
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute("data-id") ?? "")
        .sort()
        .join(","),
    );
}

/**
 * Click a menu item (menu must already be open) and wait for THAT model to be
 * the one on the canvas.
 *
 * Waiting for ".react-flow__node first() to be visible" is not enough, and was
 * the cause of a long-running intermittent failure. After the first model
 * loads, that condition is already true — so clicking the second model and
 * waiting for "a node" returned immediately, while the previous model's nodes
 * were still on screen. The test then opened the menu before the new model had
 * finished loading and found the marker still on the old one. Which it
 * correctly was: the assertion was simply running too early.
 *
 * It passed on fast runners and failed on slow ones, so it looked like a flake
 * and was re-run rather than read — the same trap as #999.
 *
 * Waiting for the node set to *change* is model-agnostic: no per-model node
 * names to keep in step with the fixtures.
 */
async function clickAndLoad(page: Page, label: string) {
  const before = await nodeSignature(page);
  await page.getByText(label, { exact: true }).first().click();
  await expect(
    page.locator(".react-flow__node").first(),
    `graph never rendered for ${label}`,
  ).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() => nodeSignature(page), {
      timeout: 60000,
      message: `canvas still showed the previous model after loading ${label}`,
    })
    .not.toBe(before);
}

test.describe("Open dropdown: loaded-reference marker", { tag: "@ci" }, () => {
  test("marks the loaded reference, moves it, clears it for a demo", async ({ page }) => {
    await page.goto("/");

    // Nothing loaded from the picker yet → no marker. Load FIRST while open.
    await openMenu(page);
    await expect(page.locator('button[aria-current="true"]')).toHaveCount(0);
    await clickAndLoad(page, FIRST); // menu auto-closes after load

    // Exactly FIRST is marked. Load SECOND while the menu is open.
    await openMenu(page);
    let marked = page.locator('button[aria-current="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText(FIRST);
    await clickAndLoad(page, SECOND);

    // Marker moved to SECOND. Load a demo (non-reference) while open.
    await openMenu(page);
    marked = page.locator('button[aria-current="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText(SECOND);
    await expect(marked).not.toContainText(FIRST);
    await clickAndLoad(page, DEMO);

    // A demo is not a reference model → no marker.
    await openMenu(page);
    await expect(page.locator('button[aria-current="true"]')).toHaveCount(0);
  });
});
