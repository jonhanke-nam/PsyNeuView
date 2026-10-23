import { readOnlyTest as test, expect } from "./test-base";
import { fixturePath } from "./fixtures";
import { mkdtempSync, copyFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function viewSelect(page: any) {
  return page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Flatten (all compositions)" }) })
    .first();
}

test("flat-view save keeps a separate namespace, not clobbering nested (#719)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(path.join(tmpdir(), "ns719-"));
  const model = path.join(dir, "nested_minimal.py");
  copyFileSync(fixturePath("nested_minimal"), model);
  // A layout sidecar lives either beside the .py or inside a hidden
  // `.psyneuview/` folder, discovered lateral-first (#927/#933). A model with no
  // existing lateral sidecars — like this fresh copy — gets the dot-folder, so
  // resolve where it landed rather than assuming. Following the app's own rule
  // keeps this test from pinning one layout and going stale when the default
  // moves, which is exactly what happened before.
  const sidecarCandidates = [
    path.join(dir, "nested_minimal.pnlview.json"),
    path.join(dir, ".psyneuview", "nested_minimal.pnlview.json"),
  ];
  const sidecarPath = () => {
    const found = sidecarCandidates.find((p) => existsSync(p));
    if (!found) {
      throw new Error(
        `No layout sidecar written. Looked in:\n  ${sidecarCandidates.join("\n  ")}`,
      );
    }
    return found;
  };
  const readSidecar = () => JSON.parse(readFileSync(sidecarPath(), "utf8"));

  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await expect(page.getByText("nested_minimal.py").first()).toBeVisible({ timeout: 30000 });

  const saveLayout = async () =>
    Promise.all([
      page.waitForResponse((r: any) => r.url().includes("/api/model/save-layout") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Reset Custom Layout" }).click(),
    ]);

  // Nested view (models open flattened, #48): save → writes `positions`
  // (incl. the inner_comp group node).
  await Promise.all([
    page.waitForResponse((r: any) => r.url().includes("/api/model/load") && r.request().method() === "POST"),
    viewSelect(page).selectOption({ label: "nested_minimal" }),
  ]);
  await expect(page.getByTestId("graph-canvas").getByText("inner_a", { exact: true })).toHaveCount(0, { timeout: 15000 });
  await saveLayout();
  let sc = readSidecar();
  expect(Object.keys(sc.positions)).toContain("inner_comp");
  expect(sc.flatPositions).toBeUndefined();
  const nestedSnapshot = JSON.stringify(sc.positions);

  // Flatten, then save → writes `flatPositions`, leaving `positions` untouched.
  await viewSelect(page).selectOption("__flat__");
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas.getByText("inner_a", { exact: true })).toBeVisible({ timeout: 15000 });
  await saveLayout();
  sc = readSidecar();

  // Nested positions preserved verbatim (no coordinate-space corruption).
  expect(JSON.stringify(sc.positions)).toBe(nestedSnapshot);
  // Flat positions are stored separately and include a framed member.
  expect(sc.flatPositions).toBeTruthy();
  expect(Object.keys(sc.flatPositions)).toContain("inner_a");
  // The cluster frame itself is never persisted.
  expect(Object.keys(sc.flatPositions).some((k) => k.startsWith("cluster::"))).toBe(false);
});
