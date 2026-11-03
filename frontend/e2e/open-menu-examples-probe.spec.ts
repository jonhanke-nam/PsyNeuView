/**
 * Opening the Open menu asks the server for nothing slow (#175).
 *
 * The marks on the PsyNeuLink Examples section (runs / loads / fails) come
 * from a probe that loads and runs every example, which can take a minute.
 * It used to start as soon as the menu opened, under a folded heading, and
 * spun the busy wheel through the first Open of every launch. Now it starts
 * only when the section is actually on show, and never shows the wheel.
 *
 * The server has no Scripts/Examples here, so the examples and their status
 * are stubbed with page.route.
 */
import { readOnlyTest as test, expect, COLLAPSED_SECTIONS_KEY } from "./test-base";

type Page = import("@playwright/test").Page;

const STATUS = "GET /api/psyneulink-examples/status";

/** Stub the examples list and a slow status answer; count the status requests. */
async function stubExamples(page: Page, statusDelayMs: number): Promise<{ statusRequests: () => number }> {
  let count = 0;
  await page.route("**/api/psyneulink-examples", (route) =>
    route.fulfill({ json: { available: true, models: [{ name: "stub", label: "Stub", path: "/stub.py" }] } }),
  );
  await page.route("**/api/psyneulink-examples/status", async (route) => {
    count += 1;
    await new Promise((r) => setTimeout(r, statusDelayMs));
    await route.fulfill({ json: { available: true, status: { stub: { load: "ok", run: "ok", nodes: 2 } } } });
  });
  return { statusRequests: () => count };
}

/** Fold or unfold the examples section before the page loads. */
async function startWithExamples(page: Page, folded: boolean) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [COLLAPSED_SECTIONS_KEY, JSON.stringify(folded ? ["examples"] : [])] as const,
  );
}

type Snap = {
  activity: { kind: string; text: string; data?: Record<string, unknown> }[];
  waitsInProgress: { label: string; action: string | null }[];
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pnvDiagnostics: () => Promise<unknown> }).__pnvDiagnostics()) as Promise<Snap>;

test.describe("Open menu: the examples probe (#175)", { tag: "@ci" }, () => {
  test("the first Open asks for no status and shows no wheel; unfolding the section asks, still without the wheel", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { statusRequests } = await stubExamples(page, 3_000);
    await startWithExamples(page, true);
    await page.goto("/");
    await expect(page.getByTestId("open-menu")).toBeEnabled();
    const wheel = page.getByTestId("busy-indicator");

    await page.getByTestId("open-menu").click();
    await expect(page.getByTestId("open-menu-section-examples")).toBeVisible();
    // Long enough for the wheel (0.2 s) and for a request to have gone out.
    await page.waitForTimeout(1_000);
    expect(statusRequests()).toBe(0);
    await expect(wheel).toHaveAttribute("data-visible", "false");
    // The timer's span keeps its width while idle; it shows no time.
    await expect(page.getByTestId("busy-elapsed")).not.toHaveText(/\d/);

    // Unfolding the section is what asks, and the wheel stays off while the
    // server works: the request is background, so nobody is kept waiting.
    await page.getByTestId("open-menu-section-examples").getByRole("button", { expanded: false }).click();
    await expect.poll(statusRequests).toBe(1);
    await page.waitForTimeout(600);
    await expect(wheel).toHaveAttribute("data-visible", "false");
    // A background wait is reported once it has run for a second (#176).
    await expect
      .poll(async () => (await snapshot(page)).waitsInProgress.find((w) => w.label === STATUS)?.action, { timeout: 5_000 })
      .toBe("PsyNeuLink examples expanded");
    await expect(wheel).toHaveAttribute("data-visible", "false");
    const during = await snapshot(page);
    expect(during.activity.find((e) => e.kind === "menu" && e.text === "PsyNeuLink examples expanded")).toBeTruthy();

    // The marks arrive, and the wait is on record as background work.
    await expect(page.getByRole("button", { name: "Stub" })).toContainText("runs", { timeout: 10_000 });
    await expect(wheel).toHaveAttribute("data-visible", "false");
    const after = await snapshot(page);
    const wait = after.activity.find((e) => e.kind === "wait" && e.data?.label === STATUS);
    expect(wait?.data?.waitKind).toBe("background");
    expect(wait?.text).toContain("· from: PsyNeuLink examples expanded");

    // Folding and unfolding again doesn't ask twice.
    const toggle = page.getByTestId("open-menu-section-examples").getByRole("button").first();
    await toggle.click();
    await toggle.click();
    await page.waitForTimeout(300);
    expect(statusRequests()).toBe(1);
  });

  test("a section already unfolded when the menu opens asks at once", async ({ page }) => {
    const { statusRequests } = await stubExamples(page, 100);
    await startWithExamples(page, false);
    await page.goto("/");
    await expect(page.getByTestId("open-menu")).toBeEnabled();
    await page.getByTestId("open-menu").click();
    await expect.poll(statusRequests).toBe(1);
    await expect(page.getByRole("button", { name: "Stub" })).toContainText("runs");
  });
});
