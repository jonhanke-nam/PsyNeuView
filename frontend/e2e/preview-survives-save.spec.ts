/**
 * A request sent while a save is on its way still finds the preview (#160).
 *
 * Unsaved code runs from a private preview copy. A save used to delete that
 * copy at once, but the page only stops naming it when the save answers, a
 * few seconds later (the save re-loads the model first). An Undo with autosave
 * on hit that window: the Like show_graph layout asked about the deleted copy
 * and the page said "Couldn't get show_graph's layout … File not found:
 * ~/.psyneuview/previews/…", falling back to Layered.
 *
 * Here the save's answer is held back, so the window is as wide as we like,
 * and the layout is asked for inside it.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fixturePath } from "./fixtures";

const BASE = readFileSync(fixturePath("two_mech_projection"), "utf8");
const ADDED_NODE = [
  "extra_mech = pnl.TransferMechanism(input_shapes=[3], function=pnl.Linear(), name='extra_mech')",
  "two_mech_projection.add_node(extra_mech)",
].join("\n");

function scratchModel() {
  const dir = mkdtempSync(path.join(tmpdir(), "preview160-"));
  const file = path.join(dir, "two_mech_projection.py");
  writeFileSync(file, BASE);
  return file;
}

test("the Like show_graph layout asked during a save still gets its answer (#160)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(180_000);
  const model = scratchModel();

  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  // An unsaved edit: the canvas is now built from the preview copy, and
  // show_graph is asked about that copy.
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(`${BASE}\n${ADDED_NODE}\n`);
  await expect(page.locator('.react-flow__node[data-id^="extra_mech"]')).toBeVisible({ timeout: 60_000 });

  // The save reaches the server and is done there, but its answer waits until
  // the layout has been asked for: the page still names the preview.
  let saved!: () => void;
  const savedOnServer = new Promise<void>((r) => (saved = r));
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route("**/api/model/save-source", async (route) => {
    const response = await route.fetch();
    saved();
    await released;
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await savedOnServer;
  expect(readFileSync(model, "utf8")).toContain("extra_mech");

  const answer = page.waitForResponse((r) => r.url().includes("/api/model/show-graph"));
  await page.locator("select").filter({ hasText: "Like show_graph" }).first().selectOption("showgraph");
  const graph = await answer;
  release();

  // It really was the preview being asked about, not the saved file.
  expect(graph.request().postDataJSON().file_path).toContain("previews");
  expect(graph.status(), await graph.text()).toBe(200);
  await expect(page.getByText(/Couldn't get show_graph's layout/)).toHaveCount(0);
});
