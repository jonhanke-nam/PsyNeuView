/**
 * Adding a component with the keyboard alone (#411).
 *
 * In the icon strip: Enter on a category opens its menu and moves focus into
 * it; Enter on a sub-menu enters it; the arrow keys move between rows; Enter
 * on a row picks it up. The graph then takes focus. A mechanism is shown
 * where it would go (covering nothing), the arrow keys move it, Enter puts it
 * down. A function rings one mechanism at a time, Tab moves the ring, a
 * mechanism that can't take it says why in the placing hint, and Enter gives
 * it to the ringed one. Each step is said in the hint (a status message), and
 * focus goes back to the strip afterwards. The code and the graph both change.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

type Page = import("@playwright/test").Page;

function scratchStroop(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "keyboard-add-411-"));
  const file = path.join(dir, "stroop_basic.py");
  writeFileSync(file, readFileSync(path.resolve(import.meta.dirname, "../../backend/demos/stroop_basic.py"), "utf8"));
  return file;
}

async function open(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id="decision"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("palette-sidebar")).toBeVisible();
}

const focused = (page: Page) => page.locator(":focus");

/** Arrow down the open strip menu until the focused row is `type`; Enter picks it up. */
async function pickFromMenu(page: Page, type: string) {
  for (let i = 0; i < 20; i++) {
    const at = await focused(page).evaluate((e) => e.closest("[data-testid=palette-item]")?.getAttribute("data-type") ?? null);
    if (at === type) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`${type} not reached in the menu`);
}

/**
 * In graph coordinates: the box around every node except `skip`, a node's
 * box, and every arrow's drawn path (by arrow id).
 */
async function graphState(page: Page, skip = "") {
  return page.evaluate((skip) => {
    const vp = document.querySelector(".react-flow__viewport") as HTMLElement;
    const pane = document.querySelector(".react-flow__pane")!.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
    const flow = (r: DOMRect) => ({
      left: (r.left - pane.left - m.e) / m.a,
      top: (r.top - pane.top - m.f) / m.d,
      right: (r.right - pane.left - m.e) / m.a,
      bottom: (r.bottom - pane.top - m.f) / m.d,
    });
    const boxes = Array.from(document.querySelectorAll(".react-flow__node"))
      .filter((e) => e.getAttribute("data-id") !== skip)
      .map((e) => flow(e.getBoundingClientRect()))
      .filter((b) => b.right > b.left);
    const bounds = {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    };
    const mine = skip ? document.querySelector(`.react-flow__node[data-id="${skip}"]`) : null;
    const paths: Record<string, string> = {};
    for (const e of Array.from(document.querySelectorAll(".react-flow__edge"))) {
      paths[e.getAttribute("data-id") ?? ""] = e.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? "";
    }
    return { bounds, node: mine ? flow(mine.getBoundingClientRect()) : null, paths };
  }, skip);
}

/** The declaration of `name` in the file, up to its closing parenthesis. */
function declaration(file: string, name: string): string {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf(`${name} = pnl.`);
  if (start < 0) return "";
  return src.slice(start, src.indexOf("\n)", start));
}

test.describe("adding a component from the keyboard (#411)", { tag: "@ci" }, () => {
  test("a mechanism and a function go onto Stroop with the keyboard alone", async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem("psyneuview.components.start", "strip"));
    const file = scratchStroop();
    await open(page, file);
    const palette = page.getByTestId("palette-sidebar");
    const hint = page.getByTestId("place-component-hint");
    const placement = page.getByTestId("keyboard-placement");

    // --- A mechanism --------------------------------------------------
    // Nothing selected: the graph's box and its arrows, before.
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
    const before = await graphState(page);
    expect(Object.keys(before.paths).length).toBeGreaterThan(0);
    // Enter on Mechanisms opens its menu, and focus goes into it.
    const mechanisms = palette.locator('[data-testid="palette-category"][data-category="mechanisms"]');
    await mechanisms.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("palette-compact-flyout");
    await expect(menu).toBeVisible();
    await expect(focused(page)).toHaveAttribute("data-testid", "palette-flyout-branch");
    await expect(focused(page)).toContainText("Processing");
    // The arrows move between rows, and wrap.
    await page.keyboard.press("ArrowDown");
    await expect(focused(page)).not.toContainText("Processing");
    await page.keyboard.press("ArrowUp");
    await expect(focused(page)).toContainText("Processing");
    // Enter goes into the sub-menu, focus on its first row.
    await page.keyboard.press("Enter");
    await expect(focused(page)).toHaveAttribute("data-testid", "palette-item-pick");
    await pickFromMenu(page, "ProcessingMechanism");

    // Picked up: the menu closes and the graph takes focus, showing where it goes.
    await expect(menu).toHaveCount(0);
    await expect(placement).toBeFocused();
    await expect(placement).toHaveAttribute("data-mode", "component");
    await expect(hint).toHaveAttribute("role", "status");
    await expect(hint).toContainText("Placing Processing");
    await expect(hint).toContainText("Enter puts it down");

    // The arrows move it.
    const x0 = Number(await placement.getAttribute("data-x"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Number(await placement.getAttribute("data-x"))).toBeGreaterThan(x0);

    // Enter puts it down: the code has it, the graph draws it, covering nothing.
    const added = page.waitForResponse((r) => r.url().endsWith("/api/model/structural-change") && r.ok());
    await page.keyboard.press("Enter");
    await added;
    await expect(placement).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    const node = page.locator('.react-flow__node[data-id="New_ProcessingMechanism_1"]');
    await expect(node).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => declaration(file, "New_ProcessingMechanism_1")).toContain("pnl.ProcessingMechanism");
    // Focus is back on the strip, where the pick was made.
    await expect(mechanisms).toBeFocused();
    // Nothing overlaps it (once it has settled where it was put).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const box = (e: Element) => e.getBoundingClientRect();
          const mine = document.querySelector('.react-flow__node[data-id="New_ProcessingMechanism_1"]');
          if (!mine) return ["missing"];
          const a = box(mine);
          return Array.from(document.querySelectorAll(".react-flow__node"))
            .filter((e) => e !== mine && !e.classList.contains("react-flow__node-compositionNode"))
            .filter((e) => {
              const b = box(e);
              return b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            })
            .map((e) => e.getAttribute("data-id"));
        }),
      )
      .toEqual([]);
    // With nothing selected it went beside the graph, outside the box the
    // graph filled before, never into a gap inside it; and no arrow moved.
    const after = await graphState(page, "New_ProcessingMechanism_1");
    const n = after.node!;
    const b = before.bounds;
    expect(n.left >= b.right || n.right <= b.left || n.top >= b.bottom || n.bottom <= b.top, JSON.stringify({ n, b })).toBe(true);
    expect(after.paths).toEqual(before.paths);

    // --- A function ---------------------------------------------------
    const functions = palette.locator('[data-testid="palette-category"][data-category="functions"]');
    await functions.focus();
    await page.keyboard.press("Enter");
    await expect(focused(page)).toContainText("Transfer");
    await page.keyboard.press("Enter");
    await pickFromMenu(page, "Logistic");
    await expect(placement).toBeFocused();
    await expect(placement).toHaveAttribute("data-mode", "function");
    await expect(hint).toContainText("Giving Logistic to");

    // Tab rings each mechanism in turn; the DDM can't take it, and says why.
    const ringTo = async (id: string) => {
      for (let i = 0; i < 12; i++) {
        if ((await placement.getAttribute("data-target")) === id) return;
        await page.keyboard.press("Tab");
      }
      throw new Error(`${id} never ringed`);
    };
    await ringTo("decision");
    await expect(placement).toHaveAttribute("data-refused", "true");
    await expect(hint).toContainText("decision can't use Logistic");
    await expect(hint).not.toContainText("Enter gives it");
    await expect(placement).toBeFocused();

    // Enter on color_input gives it Logistic: in the code, and in the graph.
    await ringTo("color_input");
    await expect(placement).not.toHaveAttribute("data-refused", "true");
    await expect(hint).toContainText("Giving Logistic to color_input");
    const given = page.waitForResponse((r) => r.url().endsWith("/api/model/update-function-type") && r.ok());
    await page.keyboard.press("Enter");
    await given;
    await expect(page.getByTestId("notification-message").filter({ hasText: "color_input now uses Logistic" })).toBeVisible();
    await expect.poll(() => declaration(file, "color_input")).toMatch(/function\s*=\s*pnl\.Logistic/);
    await expect(placement).toHaveCount(0);
    await expect(functions).toBeFocused();
    // The graph shows it: the Inspector for color_input names Logistic.
    await page.locator('.react-flow__node[data-id="color_input"]').click();
    await expect(page.locator('select[title^="Change function class"]')).toHaveValue("Logistic");
  });

  test("Esc cancels a keyboard pick and gives focus back; the mouse still places by click", async ({ page }) => {
    test.setTimeout(120_000);
    const file = scratchStroop();
    const original = readFileSync(file, "utf8");
    await open(page, file);
    const placement = page.getByTestId("keyboard-placement");

    // Full list: the name is a button Tab reaches; Enter picks it up.
    await page.getByPlaceholder("Search components…").fill("TransferMechanism");
    const name = page.locator('[data-testid="palette-item"][data-type="TransferMechanism"] [data-testid="palette-item-pick"]').first();
    await name.focus();
    await expect(name).toHaveAttribute("role", "button");
    await page.keyboard.press("Enter");
    await expect(name).toHaveAttribute("aria-pressed", "true");
    await expect(placement).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(placement).toHaveCount(0);
    await expect(page.getByTestId("place-component-hint")).toHaveCount(0);
    await expect(name).toBeFocused();
    expect(readFileSync(file, "utf8")).toBe(original);

    // A click picks it up with no keyboard placement: the hint says click.
    await page.locator('[data-testid="palette-item"][data-type="TransferMechanism"]').first().click();
    await expect(page.getByTestId("place-component-hint")).toContainText("Click where the new");
    await expect(placement).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
