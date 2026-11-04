/**
 * Diagnostics (#1287): `window.__pnvDiagnostics` answers with the page's
 * state and the activity since launch, and Settings ▸ About downloads the
 * same object as a JSON file in a browser.
 *
 * Opens a model, changes a setting, runs the model, then reads the snapshot
 * and checks what the Mac app's Report a Problem relies on: the version, the
 * open model and its path (the home folder as ~), the changed setting, the
 * run's start and finish with its outcome, and times in order.
 */
import { mutatingTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { formatTimeline } from "../src/utils/timeline";

type Page = import("@playwright/test").Page;

/** The contract's shape, loosely: the suite drives the built app from outside. */
interface Snapshot {
  version: number;
  state: any;
  activity: { t: string; kind: string; text: string; data?: Record<string, unknown> }[];
  actionLogging: boolean;
  timeline: { t: string; source: string; text: string }[];
  previousActivity: { t: string; kind: string; text: string }[];
  savedActivityError: string | null;
}

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).__pnvDiagnostics());

test.describe("Diagnostics", { tag: "@ci" }, () => {
  test("the snapshot has the state and the activity, and About downloads it", async ({ page }) => {
    await page.goto("/");
    // The function is there once the app has loaded.
    await page.waitForFunction(() => typeof (window as any).__pnvDiagnostics === "function");

    // A model, through the Open menu (a menu command and an open).
    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("single_transfer"));
    await prompt.press("Enter");
    await expect(page.getByText("single_transfer.py").first()).toBeVisible({ timeout: 30_000 });

    // A setting: Appearance ▸ Pointer in the graph view.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-appearance").click();
    await page.getByTestId("setting-graph-pointer").selectOption("hand");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);

    // A run.
    await page.getByTestId("tab-run").click();
    await page.getByRole("button", { name: /Run Model/ }).click();
    await expect(page.getByText(/single_transfer\b.*trial/).first()).toBeVisible({ timeout: 30_000 });

    const snap: Snapshot = await page.evaluate(() => (window as any).__pnvDiagnostics());
    expect(snap.version).toBe(1);
    expect(Object.keys(snap.state)).toEqual(["app", "model", "ui", "psyneulink", "server"]);

    // The state.
    expect(snap.state.app.psyneuviewVersion).toMatch(/^\d+\.\d+/);
    expect(snap.state.model).toEqual(
      expect.objectContaining({ open: true, path: expect.stringMatching(/single_transfer\.py$/), unsavedChanges: false, viewOnlyLock: false }),
    );
    expect(snap.state.ui.graph.pointer).toBe("hand");
    expect(snap.state.ui.layout.activeBottomTab).toBe("run");
    expect(snap.state.ui.layout.settingsOpen).toBe(false);
    expect(snap.state.ui.layout.visiblePanes).toContain("graph");
    expect(snap.state.psyneulink.version).toBeTruthy();
    expect(snap.state.server).toHaveProperty("versions.psyneuview");
    expect(snap.state.server.versions.psyneuview).toBe(snap.state.app.psyneuviewVersion);
    // What's running, from where (#1356): here, a checkout of this repository,
    // and the page built from the commit the server runs.
    expect(snap.state.app.running).toEqual(
      expect.objectContaining({
        kind: "checkout",
        path: expect.stringMatching(/^(~|\/)/),
        commit: expect.stringMatching(/^[0-9a-f]{7,}$/),
        summary: expect.stringMatching(/^PsyNeuView \S+ running from your checkout at /),
        page: expect.objectContaining({ commit: expect.stringMatching(/^[0-9a-f]{7,}$/), devServer: false }),
      }),
    );

    // The activity, in order, with what each kind records.
    expect(snap.activity.find((e) => e.kind === "menu" && e.text.startsWith("Open › Open from path"))).toBeTruthy();
    expect(snap.activity.find((e) => e.kind === "model" && /^Opened .*single_transfer\.py$/.test(e.text))).toBeTruthy();
    expect(snap.activity.find((e) => e.kind === "setting" && e.data?.key === "graph-pointer" && e.data?.value === "hand")).toBeTruthy();
    expect(snap.activity.find((e) => e.kind === "menu" && e.text === "Settings › appearance")).toBeTruthy();
    const runs = snap.activity.filter((e) => e.kind === "run");
    expect(runs.map((e) => e.text)).toEqual([expect.stringMatching(/^Run started: /), expect.stringMatching(/^Run finished: /)]);
    expect(runs[1].data).toEqual(expect.objectContaining({ outcome: "ok", durationMs: expect.any(Number) }));
    // The "Loaded" message shown to the user is recorded too.
    expect(snap.activity.find((e) => e.kind === "notification" && e.data?.type === "success")).toBeTruthy();
    const times = snap.activity.map((e) => e.t);
    expect(times.every((t) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t))).toBe(true);
    expect([...times].sort()).toEqual(times);

    // Nothing names the home folder: the fixture lives under it, and appears as ~.
    expect(JSON.stringify(snap)).not.toMatch(/\/Users\/|\/home\//);
    expect(snap.state.model.path.startsWith("~/") || !fixturePath("single_transfer").match(/^\/(Users|home)\//)).toBe(true);

    // In a browser, About downloads the same object as a JSON file.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-about").click();
    await expect(page.getByTestId("download-diagnostics")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-diagnostics").click()]);
    expect(download.suggestedFilename()).toMatch(/^psyneuview-diagnostics-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    const saved: Snapshot = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(saved.version).toBe(1);
    expect(saved.state.model.path).toBe(snap.state.model.path);
    expect(saved.state.ui.layout).toEqual(expect.objectContaining({ settingsOpen: true, activeSettingsSection: "about" }));
    expect(saved.activity.length).toBeGreaterThanOrEqual(snap.activity.length);
  });

  /**
   * The timeline, the saved copy and the action-logging setting (#177):
   * buttons, tabs and the canvas are logged; the timeline lays actions,
   * events and waits out in order; a reload keeps the earlier page's
   * entries through the server's copy; and with the setting off no action
   * is recorded or kept, and the report says so.
   */
  test("actions are logged and saved, the timeline is in order, and the setting turns actions off", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof (window as any).__pnvDiagnostics === "function");

    await page.getByTestId("open-menu").click();
    await page.getByTestId("open-menu-open-from-path").click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(fixturePath("single_transfer"));
    await prompt.press("Enter");
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("tab-run").click();
    await page.locator(".react-flow__node").first().click();

    let snap = await snapshot(page);
    expect(snap.actionLogging).toBe(true);
    const texts = snap.activity.map((e) => `${e.kind}: ${e.text}`);
    // The menu, from the one click listener, with the menu's name.
    expect(texts).toContain("menu: Open › Open from path...");
    // A bottom tab, and a node selected on the canvas.
    expect(texts).toContain("click: Bottom tabs › Run");
    expect(texts.some((t) => /^canvas: Selected node /.test(t))).toBe(true);
    // Where this page load began, for the saved copy.
    expect(texts).toContain("logging: Page loaded");

    // The timeline: in time order, each line marked, with the open's wait
    // as a start and a stop line and the model's open as an event.
    const line = (l: Snapshot["timeline"][number]) => `${l.source}: ${l.text}`;
    const sources = new Set(snap.timeline.map((l) => l.source));
    expect([...sources].sort()).toEqual(expect.arrayContaining(["action", "event", "page", "wait"]));
    expect(snap.timeline.map((l) => line(l))).toEqual(
      expect.arrayContaining([
        "action: Open › Open from path...",
        "action: Bottom tabs › Run",
        expect.stringMatching(/^wait: start · POST \/api\/model\/load · (likely )?from: Open › Open from path/),
        expect.stringMatching(/^wait: stop · POST \/api\/model\/load · [\d.]+ s · ok$/),
        expect.stringMatching(/^event: Opened .*single_transfer\.py$/),
      ]),
    );
    const times = snap.timeline.map((l) => Date.parse(l.t));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // The page's part of timeline.txt, as a sample beside the screenshots.
    if (process.env.SHOTS_DIR) writeFileSync(path.join(process.env.SHOTS_DIR, "timeline.txt"), formatTimeline(snap.timeline));
    expect(snap.timeline.findIndex((l) => l.text.startsWith("start · POST /api/model/load"))).toBeLessThan(
      snap.timeline.findIndex((l) => l.text.startsWith("stop · POST /api/model/load")),
    );
    expect(JSON.stringify(snap.timeline)).not.toMatch(/\/Users\/|\/home\//);

    // The saved copy, through the server: what this page sent so far. The
    // page sends at once when it is about to go; a beacon lands a moment later.
    expect(snap.savedActivityError).toBeNull();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const savedTexts = async () => ((await (await page.request.get("/api/activity-log")).json()).current as any[]).map((e) => e.text);
    await expect.poll(savedTexts, { timeout: 10_000 }).toEqual(expect.arrayContaining(["Page loaded", "Open › Open from path...", "Bottom tabs › Run"]));
    const saved = await (await page.request.get("/api/activity-log")).json();
    expect(saved.current.every((e: any) => typeof e.page === "string" && e.page.length > 0)).toBe(true);

    // After a reload, the page's own log starts empty, but the timeline
    // still has the earlier page's entries from the saved copy.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__pnvDiagnostics === "function");
    snap = await snapshot(page);
    expect(snap.activity.map((e) => e.text)).not.toContain("Open › Open from path...");
    expect(snap.timeline.map((l) => line(l))).toContain("action: Open › Open from path...");
    // This page's, and the earlier one's (and any other test's in this server's launch).
    expect(snap.timeline.filter((l) => l.text === "Page loaded").length).toBeGreaterThanOrEqual(2);

    // The setting, in General: on by default, and off clears the actions.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    const control = page.getByTestId("setting-activity-log-actions");
    await expect(control).toBeChecked();
    await control.scrollIntoViewIfNeeded();
    await shot(page, "01-setting-on");
    await control.uncheck();
    await shot(page, "02-setting-off");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
    // Something that would be an action, and a wait: the Open menu's requests.
    await page.getByTestId("tab-inspector").click();
    await page.getByTestId("open-menu").click();
    await page.keyboard.press("Escape");

    snap = await snapshot(page);
    expect(snap.actionLogging).toBe(false);
    const off = new Set(["menu", "click", "canvas", "edit", "step"]);
    expect(snap.activity.filter((e) => off.has(e.kind))).toEqual([]);
    expect(snap.activity[0]).toEqual(expect.objectContaining({ kind: "logging", text: expect.stringMatching(/^Action logging was off/) }));
    expect(snap.timeline[0]).toEqual(expect.objectContaining({ source: "page", text: expect.stringMatching(/^Action logging was off/) }));
    // The change itself, and the waits, are still recorded: no wait is linked to an action.
    expect(snap.activity.find((e) => e.kind === "setting" && e.data?.key === "activity-log-actions" && e.data?.value === "off")).toBeTruthy();
    const turnedOff = snap.activity.find((e) => e.kind === "setting" && e.data?.key === "activity-log-actions")!;
    const waits = snap.activity.filter((e) => e.kind === "wait" && e.t > turnedOff.t);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.map((w) => w.data?.action)).toEqual(waits.map(() => null));
    // And the saved copy lost its actions, from before the reload too.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(savedTexts, { timeout: 10_000 }).toContain("activity-log-actions = off");
    const cleared = await (await page.request.get("/api/activity-log")).json();
    expect(cleared.current.filter((e: any) => off.has(e.kind))).toEqual([]);

    // Back on, for the next test in this browser profile.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-general").click();
    await page.getByTestId("setting-activity-log-actions").check();
    await page.keyboard.press("Escape");
    expect((await snapshot(page)).actionLogging).toBe(true);
  });
});
