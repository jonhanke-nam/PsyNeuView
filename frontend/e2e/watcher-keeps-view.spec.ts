/**
 * An outside edit comes back in the view the page shows (#442).
 *
 * When another program saves the open file, the file watcher tells every
 * window following it. It used to send one graph built in the backend's
 * default view, nested, so EGO in "Flatten (all compositions)" turned nested
 * after a save from an editor beside the app, with EM folded into one node,
 * while the menu still read Flatten. Now the watcher sends only the new text,
 * and each window reads the graph itself in the view it shows.
 *
 * Here EGO's file is changed on disk (PREDICTION renamed) while the flattened
 * view is open. Afterwards the menu, EM's fold state and the drawn nodes and
 * arrows are as before, but for the renamed node.
 */
import { mutatingTest as test, expect, closePalette } from "./test-base";
import type { Page } from "@playwright/test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
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

test("EGO flattened: an edit saved on disk leaves the view, EM and the graph as they were (#442)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(240_000);
  // A copy, so the edit never touches the bundled model.
  const file = path.join(mkdtempSync(path.join(tmpdir(), "watcherview442-")), "Giallanza2024_ego_study2.py");
  copyFileSync(EGO, file);

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
  expect(before.nodes).toContain("PREDICTION");

  // Another editor saves the file, with PREDICTION renamed. The window reads
  // the change back itself, in the view it shows.
  const reads: unknown[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/model/load") && r.method() === "POST") reads.push(r.postDataJSON());
  });
  const source = readFileSync(file, "utf8");
  const edited = source.replace("PREDICTION = 'PREDICTION'", "PREDICTION = 'PREDICTION_442'");
  expect(edited).not.toBe(source);
  writeFileSync(file, edited);
  await expect(canvas(page).locator('.react-flow__node[data-id="PREDICTION_442"]')).toBeVisible({ timeout: 90_000 });

  await expectFlattenedAndOpen(page);
  // The same graph, but for the renamed node and its arrows.
  const rename = (ids: string[]) => ids.map((id) => id.replace(/\bPREDICTION\b/g, "PREDICTION_442")).sort();
  expect(await settled(page)).toEqual({ ...before, nodes: rename(before.nodes), arrows: rename(before.arrows) });
  // Read back once, in the view shown.
  expect(reads).toEqual([expect.objectContaining({ file_path: file, flat: true, pytorch: false })]);
});
