/**
 * The spinning wheel of patience (#38): anything slower than 0.2 s shows it,
 * with a "progress" pointer; anything quicker shows nothing; covers a save and
 * an undo.
 *
 * One wheel at a time (#220), always centred over the whole workspace below
 * the toolbar, whatever panels are open, even none (#222 follow-up); nothing in
 * the toolbar moves, and the status bar has no spinner of its own.
 *
 * Each slow request is made slow on purpose with page.route. Screenshots
 * land in `$SHOTS_DIR` when it is set.
 *
 * It also says how long it has been spinning: below the wheel, in its centre
 * or not at all, as Settings chooses; and a problem report records each wait with its start and stop times (#176).
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

/** Watch the wheel's state from inside the page: when it first showed, and how often. */
async function watchWheel(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __busySeen: number[] };
    w.__busySeen = [];
    new MutationObserver(() => {
      if (document.querySelector("[data-testid=busy-indicator][data-visible=true]")) w.__busySeen.push(performance.now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-visible"] });
  });
}

/** Set stored values before the app reads them. */
async function seed(page: Page, values: Record<string, string>) {
  await page.addInitScript((v) => {
    for (const [key, value] of Object.entries(v)) localStorage.setItem(key, value);
  }, values);
}

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, testId: string): Promise<Box> {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
}

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function expectNear(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
}

/** The timer's box starts below the wheel's, centred under it. */
async function expectTimerBelow(page: Page) {
  const wheel = await box(page, "busy-wheel-box");
  const time = await box(page, "busy-elapsed");
  expect(time.y).toBeGreaterThanOrEqual(wheel.y + wheel.height);
  expect(time.y).toBeLessThan(wheel.y + wheel.height + 20);
  expect(Math.abs(centre(time).x - centre(wheel).x)).toBeLessThanOrEqual(1);
}

/** The timer's box is centred on the wheel's, and inside it. */
async function expectTimerCentred(page: Page) {
  const wheel = await box(page, "busy-wheel-box");
  const time = await box(page, "busy-elapsed");
  expectNear(centre(time), centre(wheel));
  expect(time.width).toBeLessThan(wheel.width);
}

/** Exactly one wheel on the page, its centre on the centre of `area`. */
async function expectOneWheelOver(page: Page, area: import("@playwright/test").Locator) {
  await expect(page.locator(".pnv-busy-wheel")).toHaveCount(1);
  const over = await area.boundingBox();
  if (!over) throw new Error("nothing to measure the wheel against");
  expectNear(centre(await box(page, "busy-wheel-box")), centre(over));
}

/** The area the one wheel hangs in: the whole workspace below the toolbar. */
const workspaceOf = (page: Page) => page.getByTestId("busy-wheel").locator("..");

async function idle(page: Page) {
  await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
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
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    await expect(wheel).toHaveText("Working…");
    await expect(page.locator("html")).toHaveClass(/pnv-busy/);
    await shot(page, "01-save-busy");

    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-wheel")).toHaveCount(0);
    await expect(wheel).toHaveText("");
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
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    await shot(page, "02-undo-busy");
    await expect(wheel).toHaveAttribute("data-visible", "false", { timeout: 30_000 });
    await expect(page.getByTestId("busy-wheel")).toHaveCount(0);
  });

  test("the timer: below the wheel, then in its centre, then off; the toolbar and the wheel stay put", async ({ page }) => {
    test.setTimeout(180_000);
    const model = scratchModel();
    await openFromPath(page, model);
    await replaceBuffer(page, EDITED);
    await page.waitForTimeout(300);
    const bar = page.getByTestId("app-toolbar");
    const nextButton = page.getByTestId("settings-button");
    const barBefore = await bar.boundingBox();
    const buttonBefore = await nextButton.boundingBox();
    await slowDown(page, "**/api/model/save-source", 4_000);

    // Below, by default: the wheel doesn't move when the time appears.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    await expect(page.getByTestId("busy-elapsed")).toHaveCount(0);
    const wheelBefore = centre(await box(page, "busy-wheel-box"));
    await expect(page.getByTestId("busy-elapsed")).toHaveText(/^[1-9] s$/, { timeout: 3_000 });
    await expectTimerBelow(page);
    await expectNear(centre(await box(page, "busy-wheel-box")), wheelBefore);
    await expectOneWheelOver(page, workspaceOf(page));
    await expect(page.locator(".pnv-busy-wheel")).toHaveCount(1);
    // Hidden from screen readers, which would otherwise read it out every second.
    expect(await page.getByTestId("busy-elapsed").evaluate((e) => !!e.closest('[aria-hidden="true"]'))).toBe(true);
    await shot(page, "03-timer-below");

    // Nothing in the toolbar moved, nor does when the wheel goes.
    expect(await bar.boundingBox()).toEqual(barBefore);
    expect((await nextButton.boundingBox())?.x).toBe(buttonBefore?.x);
    await idle(page);
    expect(await bar.boundingBox()).toEqual(barBefore);
    expect((await nextButton.boundingBox())?.x).toBe(buttonBefore?.x);

    // The choice lives under Appearance, not General.
    const choose = async (place: string) => {
      await page.getByTestId("settings-button").click();
      await page.getByTestId("settings-section-appearance").click();
      await page.getByTestId("setting-busy-timer").selectOption(place);
      await page.keyboard.press("Escape");
    };
    const slowSave = async (text: string) => {
      await replaceBuffer(page, text);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByTestId("busy-wheel")).toBeVisible();
    };

    // In the centre: the same box, whether or not the time is there yet.
    await choose("center");
    await slowSave(EDITED + "# centre\n");
    const size = await box(page, "busy-wheel-box");
    await expect(page.getByTestId("busy-elapsed")).toHaveText(/^[1-9] s$/, { timeout: 3_000 });
    await expectTimerCentred(page);
    expect(await box(page, "busy-wheel-box")).toEqual(size);
    await expectOneWheelOver(page, workspaceOf(page));
    await shot(page, "04-timer-centre");
    await idle(page);

    await choose("off");
    await slowSave(EDITED + "# off\n");
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("busy-elapsed")).toHaveCount(0);
    await expect(page.locator(".pnv-busy-wheel")).toHaveCount(1);
    await shot(page, "05-timer-off");
    await idle(page);
    expect(await page.evaluate(() => localStorage.getItem("psyneuview.busy.timerPlace"))).toBe("off");
  });

  test("with the time in the centre, a long value fits in the wheel's clear space", async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page, { "psyneuview.busy.timerPlace": "center" });
    await page.clock.install();
    await openFromPath(page, scratchModel());
    await replaceBuffer(page, EDITED);
    await slowDown(page, "**/api/model/save-source", 4_000);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    const before = await box(page, "busy-wheel-box");
    await page.clock.fastForward("01:02:09");
    await expect(page.getByTestId("busy-elapsed")).toHaveText(/^1:02:\d\d$/);
    await expectTimerCentred(page);
    expect(await box(page, "busy-wheel-box")).toEqual(before);
    const wheel = await box(page, "busy-wheel-box");
    const time = await box(page, "busy-elapsed");
    // Spokes start at 8.2/12 of the wheel's radius, and this size of type is on one line.
    expect(time.width).toBeLessThan(wheel.width * (8.2 / 12));
    await shot(page, "07-timer-centre-long");
  });

  for (const [what, layout] of [
    ["only the code editor", { code: true, graph: false, bottom: false }],
    ["only the Inspector", { code: false, graph: false, bottom: true }],
    ["no panels at all (#215)", { code: false, graph: false, bottom: false }],
  ] as const) {
    test(`with the graph hidden, ${what}: one wheel, over the workspace, the time below it`, async ({ page }) => {
      test.setTimeout(120_000);
      await seed(page, {
        psynewview_layout_code_visible: String(layout.code),
        psynewview_layout_graph_visible: String(layout.graph),
        psynewview_layout_bottom_visible: String(layout.bottom),
        // Harmless until #215 is in; with it, what lets a blank layout stand.
        "psyneuview.layout.allowBlank": "true",
      });
      await page.goto("/");
      await expect(page.getByTestId("open-menu")).toBeEnabled();
      await expect(page.getByTestId("graph-canvas")).toBeHidden();

      // Any slow request the user asked for; this page needn't have a model.
      await slowDown(page, "**/api/models/dirs", 2_500);
      const held = page.evaluate(() => fetch("/api/models/dirs").then((r) => r.text()));
      await expect(page.getByTestId("busy-wheel")).toBeVisible();
      await expect(page.getByTestId("busy-indicator")).toHaveText("Working…");
      await expect(page.locator("html")).toHaveClass(/pnv-busy/);
      await expect(page.getByTestId("busy-elapsed")).toHaveText(/^[1-9] s$/, { timeout: 3_000 });
      await expect(page.locator(".pnv-busy-wheel")).toHaveCount(1);
      // The area it hangs in is the whole workspace: the window's width, below the toolbar.
      const workspace = workspaceOf(page);
      const area = await workspace.boundingBox();
      expect(area?.width).toBe(page.viewportSize()?.width);
      expect(area!.y).toBeGreaterThanOrEqual((await box(page, "app-toolbar")).height);
      expect(area!.height).toBeGreaterThan(400);
      await expectOneWheelOver(page, workspace);
      await expectTimerBelow(page);
      await shot(page, `06-graph-hidden-${layout.code ? "code" : layout.bottom ? "inspector" : "blank"}`);
      await held;
      await expect(page.getByTestId("busy-wheel")).toHaveCount(0);
    });
  }

  test("the wheel stays put when the graph is hidden while it spins, and never doubles", async ({ page }) => {
    test.setTimeout(120_000);
    await seed(page, { psynewview_layout_code_visible: "true" });
    await page.goto("/");
    await expect(page.getByTestId("open-menu")).toBeEnabled();
    await slowDown(page, "**/api/models/dirs", 6_000);
    const held = page.evaluate(() => fetch("/api/models/dirs").then((r) => r.text()));
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    // Centred on the whole workspace, not on the graph beside the code.
    await expectOneWheelOver(page, workspaceOf(page));
    const area = await workspaceOf(page).boundingBox();
    expect(area?.width).toBe(page.viewportSize()?.width);
    const before = centre(await box(page, "busy-wheel-box"));
    await page.getByTestId("layout-menu-button").click();
    await page.getByTestId("layout-menu-list").getByTestId("layout-menu-panel-graph").click();
    await expect(page.getByTestId("graph-canvas")).toBeHidden();
    await expectNear(centre(await box(page, "busy-wheel-box")), before);
    await expect(page.locator(".pnv-busy-wheel")).toHaveCount(1);
    await held;
  });

  for (const [stored, shown] of [
    ["off", "off"],
    ["toolbar", "below"],
    ["canvas", "below"],
    ["both", "below"],
    ["nonsense", "below"],
    ["center", "center"],
  ] as const) {
    test(`a stored ${JSON.stringify(stored)} shows as ${shown}`, async ({ page }) => {
      await seed(page, { "psyneuview.busy.timerPlace": stored });
      await page.goto("/");
      await page.getByTestId("settings-button").click();
      await page.getByTestId("settings-section-appearance").click();
      await expect(page.getByTestId("setting-busy-timer")).toHaveValue(shown);
    });
  }

  test("the setting offers the three choices, and only under Appearance", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    await expect(page.getByTestId("setting-busy-threshold")).toBeVisible();
    await expect(page.getByTestId("setting-busy-timer")).toHaveCount(0);
    await page.getByTestId("settings-section-appearance").click();
    await expect(page.getByTestId("setting-busy-timer").locator("option")).toHaveText([
      "Off",
      "Below the wheel (default)",
      "In the centre of the wheel",
    ]);
  });

  test("with reduced motion the wheel stands still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("open-menu")).toBeEnabled();
    await slowDown(page, "**/api/models/dirs", 1_500);
    const held = page.evaluate(() => fetch("/api/models/dirs").then((r) => r.text()));
    await expect(page.getByTestId("busy-wheel")).toBeVisible();
    expect(await page.locator(".pnv-busy-wheel").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    await held;
  });

  test("a problem report has each wait's start and stop, and the action it came from", async ({ page }) => {
    test.setTimeout(120_000);
    // The menu asks for the status only when the source has examples and
    // their section is on show (#175): the shared fixture starts every
    // section unfolded, so here the request goes out as the menu opens.
    // open-menu-examples-probe.spec.ts covers the folded case.
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

    // Clicking Open is logged, and the request it starts is reported while it
    // runs: as background work, so it is on record without showing the wheel.
    await page.getByTestId("open-menu").click();
    await expect.poll(async () => (await snapshot()).waitsInProgress.map((w) => w.label), { timeout: 15_000 }).toContain(status);
    const during = await snapshot();
    expect(during.activity.find((e) => e.kind === "menu" && e.text === "Open menu opened")).toBeTruthy();
    expect(during.waitsInProgress.find((w) => w.label === status)?.action).toBe("Open menu opened");
    await expect(page.getByTestId("busy-indicator")).toHaveAttribute("data-visible", "false");

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
