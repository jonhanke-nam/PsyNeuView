/**
 * The spinning wheel of patience (#38): anything slower than 0.2 s shows it
 * in the toolbar and over the graph, with a "progress" pointer; anything
 * quicker shows nothing; covers a save and an undo.
 *
 * Each slow request is made slow on purpose with page.route. Screenshots
 * land in `$SHOTS_DIR` when it is set.
 *
 * It also says how long it has been spinning, where Settings chooses, and a
 * problem report records each wait with its start and stop times (#176).
 */
import { mutatingTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

type Page = import("@playwright/test").Page;

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const EDITED = BASE + "# an edit for the busy wheel\n";

function scratchModel(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "busy38-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function openFromPath(page: Page, model: string) {
  await page.goto("/");
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
}

async function replaceBuffer(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

/** Hold every matching request for `ms` before letting it through. */
async function slowDown(page: Page, pattern: string, ms: number) {
  await page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Watch the toolbar wheel from inside the page: when it first showed, and how often. */
async function watchWheel(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __busySeen: number[] };
    w.__busySeen = [];
    new MutationObserver(() => {
      if (document.querySelector("[data-testid=busy-indicator][data-visible=true]")) w.__busySeen.push(performance.now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-visible"] });
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __busySeen: number[] }).__busySeen.length);

test.describe("Busy wheel (#38)", { tag: "@ci" }, () => {
  test("a slow save shows the wheel after 0.2 s and clears it; a fast request never does", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    const wheel = page.getByTestId("busy-indicator");
    await expect(wheel).toHaveAttribute("role", "status");
    await expect(wheel).toHaveAttribute("data-visible", "false");

    // A fast user request: nothing shows.
    await watchWheel(page);
    const before = await seen(page);
    await page.evaluate(() => fetch("/api/models/dirs").then((r) => r.text()));
    await page.waitForTimeout(400);
    expect(await seen(page)).toBe(before);

    // A slow save: nothing at first, then the wheel, the label and the pointer.
    await replaceBuffer(page, EDITED);
    await slowDown(page, "**/api/model/save-source", 2_500);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    const t0 = Date.now();
    await save.click();
    await expect(wheel).toHaveAttribute("data-visible", "true");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150);
    await expect(page.getByTestId("busy-indicator-canvas")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/pnv-busy/);
    await shot(page, "01-save-busy");

    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-indicator-canvas")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/pnv-busy/);
    await expect.poll(() => readFileSync(model, "utf8")).toBe(EDITED);
  });

  test("a slow undo shows the wheel and clears it", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, EDITED);
    await expect(page.getByTestId("undo-button")).toBeEnabled();

    await slowDown(page, "**/api/model/**", 2_000);
    await page.getByTestId("undo-button").click();
    const wheel = page.getByTestId("busy-indicator");
    await expect(wheel).toHaveAttribute("data-visible", "true");
    await expect(page.getByTestId("busy-indicator-canvas")).toBeVisible();
    await shot(page, "02-undo-busy");
    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-indicator-canvas")).toHaveCount(0);
  });

  test("the wheel shows how long it has spun, where Settings says, without moving the toolbar", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, EDITED);
    // The button right after the wheel. Those further along move when the undo
    // count appears, which is nothing to do with the wheel.
    const nextButton = page.getByTestId("settings-button");
    const before = await nextButton.boundingBox();
    await slowDown(page, "**/api/model/save-source", 4_000);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const toolbar = page.getByTestId("busy-elapsed");
    await expect(toolbar).toHaveText(/^[1-9] s$/, { timeout: 3_000 });
    await expect(toolbar).toHaveAttribute("aria-hidden", "true");
    expect((await nextButton.boundingBox())?.x).toBe(before?.x);
    await expect(page.getByTestId("busy-elapsed-canvas")).toHaveCount(0);
    await shot(page, "03-timer-toolbar");
    await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    expect((await nextButton.boundingBox())?.x).toBe(before?.x);

    const choose = async (place: string) => {
      await page.getByTestId("settings-button").click();
      await page.getByTestId("settings-section-general").click();
      await page.getByTestId("setting-busy-timer").selectOption(place);
      await page.keyboard.press("Escape");
    };
    const slowSave = async (text: string) => {
      await replaceBuffer(page, text);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "true");
    };

    await choose("both");
    await slowSave(EDITED + "# both\n");
    await expect(page.getByTestId("busy-elapsed-canvas")).toHaveText(/^[1-9] s$/, { timeout: 3_000 });
    await expect(toolbar).toHaveText(/^[1-9] s$/);
    await shot(page, "04-timer-both");
    await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });

    await choose("off");
    await slowSave(EDITED + "# off\n");
    await page.waitForTimeout(1_500);
    await expect(toolbar).toHaveCount(0);
    await expect(page.getByTestId("busy-elapsed-canvas")).toHaveCount(0);
    await shot(page, "05-timer-off");
    await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
  });

  test("a problem report has each wait's start and stop, and the action it came from", async ({ page }) => {
    test.setTimeout(120_000);
    // The menu asks for the status only when the source has examples.
    await page.route("**/api/psyneulink-examples", (route) =>
      route.fulfill({ json: { available: true, models: [{ name: "stub", label: "Stub", path: "/stub.py" }] } }),
    );
    await page.route("**/api/psyneulink-examples/status", async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.fulfill({ json: { available: true, status: {} } });
    });
    await page.goto("/");
    await expect(page.getByTestId("open-menu")).toBeEnabled();

    type Entry = { t: string; time: string; kind: string; text: string; data?: Record<string, unknown> };
    type Snap = { activity: Entry[]; waitsInProgress: { label: string; action: string | null }[] };
    const snapshot = () =>
      page.evaluate(() => (window as unknown as { __pnvDiagnostics: () => Promise<unknown> }).__pnvDiagnostics()) as Promise<Snap>;
    const status = "GET /api/psyneulink-examples/status";

    // Clicking Open is logged, and the request it starts is reported while it runs.
    await page.getByTestId("open-menu").click();
    await expect.poll(async () => (await snapshot()).waitsInProgress.map((w) => w.label), { timeout: 15_000 }).toContain(status);
    const during = await snapshot();
    expect(during.activity.find((e) => e.kind === "menu" && e.text === "Open menu opened")).toBeTruthy();
    expect(during.waitsInProgress.find((w) => w.label === status)?.action).toBe("Open menu opened");

    // Once it stops, it has both times and its cause; everything has a time, in order.
    await expect
      .poll(async () => (await snapshot()).activity.find((e) => e.kind === "wait" && e.data?.label === status)?.data?.stop, {
        timeout: 90_000,
      })
      .toEqual(expect.any(String));
    const after = await snapshot();
    const wait = after.activity.find((e) => e.kind === "wait" && e.data?.label === status)!;
    expect(wait.text).toContain("· from: Open menu opened");
    expect(wait.data?.durationMs as number).toBeGreaterThanOrEqual(3_900);
    expect(after.activity.every((e) => e.time === e.t && e.time.length > 0)).toBe(true);
    const times = after.activity.map((e) => Date.parse(e.t));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
