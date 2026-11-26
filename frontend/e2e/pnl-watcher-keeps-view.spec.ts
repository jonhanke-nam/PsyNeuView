/**
 * A change to PsyNeuLink's own code comes back in the view the page shows (#451).
 *
 * With a local PsyNeuLink checkout, the PsyNeuLink-code watcher tells every
 * window when PsyNeuLink's code changes. It used to send one graph built in
 * the backend's default view, nested, so EGO in "Flatten (all compositions)"
 * turned nested, with EM folded into one node, while the menu still read
 * Flatten. Now the message says only that the code changed, and each window
 * reads the model again itself, in the view it shows (as #442 did for an
 * outside edit to the model).
 *
 * The code watcher runs only for a local checkout, which the e2e harness
 * can't stand in (see backend/tests/test_reference_edit_local_source.py,
 * which covers the backend's half on real file events). So this spec passes
 * the page's socket through to the real backend and adds one
 * "psyneulink_changed" message, carrying a nested graph as the backend used
 * to. Afterwards the menu, EM's fold state and the drawn nodes and arrows are
 * as before, and the model was read once, flattened.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page, WebSocketRoute } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EGO = path.resolve(__dirname, "..", "..", "backend", "reference_models", "Giallanza2024_ego_study2.py");

test.use({ viewport: { width: 1600, height: 1000 } });

const canvas = (page: Page) => page.getByTestId("graph-canvas");
const viewMenu = (page: Page) =>
  page.locator("select").filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) }).first();
const emFrame = (page: Page) =>
  canvas(page).locator('.react-flow__node-compositionNode[data-id="EM"], .react-flow__node-compositionNode[data-id="cluster::EM"]');
const emFolded = (page: Page) => canvas(page).locator('.react-flow__node-mechanismNode[data-id="EM"]');
const emMember = (page: Page) => canvas(page).getByText("COMBINED SCORES", { exact: true });

/** What is drawn: the view, and every node and arrow by id. */
async function drawn(page: Page) {
  const ids = (sel: string) =>
    canvas(page).locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id ?? "").sort());
  return {
    view: await viewMenu(page).inputValue(),
    nodes: await ids(".react-flow__node"),
    arrows: await ids(".react-flow__edge"),
  };
}

/** Read what is drawn until two reads a moment apart agree. */
async function settled(page: Page) {
  let last = JSON.stringify(await drawn(page));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = JSON.stringify(await drawn(page));
    if (now === last) break;
    last = now;
  }
  return JSON.parse(last) as Awaited<ReturnType<typeof drawn>>;
}

/** EM is open in the flattened view, as the view menu says. */
async function expectFlattenedAndOpen(page: Page) {
  await expect(viewMenu(page)).toHaveValue("__flat__", { timeout: 60_000 });
  await expect(emFrame(page)).toBeVisible({ timeout: 60_000 });
  await expect(emMember(page)).toBeVisible();
  await expect(emFolded(page)).toHaveCount(0);
}

test("EGO flattened: a PsyNeuLink code change leaves the view, EM and the graph as they were (#451)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(240_000);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "pnlwatcherview451-")), "Giallanza2024_ego_study2.py");
  copyFileSync(EGO, file);

  // Pass the page's socket through to the backend, keeping hold of it so a
  // message can be added on the page's side.
  let toPage: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    toPage = ws;
  });

  await page.goto("/");
  await closePalette(page);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(file);
  await prompt.press("Enter");
  await expectFlattenedAndOpen(page);
  await expect(page.getByText("Watching for changes")).toBeVisible({ timeout: 30_000 });
  const before = await settled(page);

  // The graph the backend used to send with the message: nested.
  const nested = await page.request.post("/api/model/load", { data: { file_path: file } });
  expect(nested.ok()).toBe(true);
  const { source, model } = await nested.json();

  const reads: unknown[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/model/load") && r.method() === "POST") reads.push(r.postDataJSON());
  });
  expect(toPage).not.toBeNull();
  toPage!.send(JSON.stringify({
    type: "psyneulink_changed",
    changedFiles: ["/checkout/psyneulink/core/components/mechanisms/mechanism.py"],
    filePath: file,
    source,
    model,
  }));
  await expect(page.getByText(/PsyNeuLink code changed \(mechanism\.py\)/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => reads.length, { timeout: 60_000 }).toBe(1);

  await expectFlattenedAndOpen(page);
  expect(await settled(page)).toEqual(before);
  // Read again once, in the view shown.
  expect(reads).toEqual([expect.objectContaining({ file_path: file, flat: true, pytorch: false })]);
});
