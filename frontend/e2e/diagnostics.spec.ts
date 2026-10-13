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
import { readFileSync } from "fs";

/** The contract's shape, loosely: the suite drives the built app from outside. */
interface Snapshot {
  version: number;
  state: any;
  activity: { t: string; kind: string; text: string; data?: Record<string, unknown> }[];
}

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
});
