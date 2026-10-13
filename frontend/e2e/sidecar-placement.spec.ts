/**
 * Sidecar placement toggle actually moves files (#933).
 *
 * The toggle's whole point is the migration. Sidecar discovery is lateral-first,
 * so an existing file beside the `.py` always wins on read — flipping a model to
 * "dot-folder" without *moving* its files would change a stored setting and have
 * no visible effect whatsoever. A toggle that does nothing looks broken, which
 * is why this asserts on the filesystem rather than on the UI's own label.
 *
 * The model is copied into a temp dir first. Pointing this at the repo's
 * reference models would relocate files that are checked in.
 *
 * The *global default* control is covered below too. It persists to the user's
 * preferences file, which the harness redirects into the session temp dir via
 * PSYNEUVIEW_CONFIG_FILE (#1025) — before that, exercising it would have written
 * to the developer's real ~/.psynewview.json.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { mkdtempSync, copyFileSync, existsSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(HERE, "..", "..", "backend", "reference_models");

test("placement toggle migrates sidecars on disk (#933)", { tag: "@ci" }, async ({ page }) => {
  test.setTimeout(120_000);

  // window.confirm guards the move; Playwright dismisses dialogs unless told.
  page.on("dialog", (d) => d.accept());

  const dir = mkdtempSync(path.join(tmpdir(), "placement933-"));
  const stem = "stroop_reference_basic";
  const model = path.join(dir, `${stem}.py`);
  for (const f of [`${stem}.py`, `${stem}.pnlview.json`, `${stem}.labels.yaml`]) {
    copyFileSync(path.join(REF, f), path.join(dir, f));
  }

  const lateral = (f: string) => path.join(dir, f);
  const dotted = (f: string) => path.join(dir, ".psyneuview", f);
  const layout = `${stem}.pnlview.json`;
  const labels = `${stem}.labels.yaml`;

  // Precondition: the copies start beside the .py, which is what makes the
  // migration observable at all.
  expect(existsSync(lateral(layout))).toBe(true);
  expect(existsSync(lateral(labels))).toBe(true);
  expect(existsSync(dotted(layout))).toBe(false);

  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(model);
  await prompt.press("Enter");
  await page
    .getByRole("button", { name: /^Skip$/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

  // The model has lateral companions, so `auto` resolves to lateral and the
  // control should say so before anything is touched.
  const picker = page.getByTitle(
    "Where this model's sidecar files (layouts, labels) are stored on disk",
  );
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker).toContainText("beside .py");

  // Flip to the dot-folder and wait for the server to report the move, rather
  // than sleeping and hoping.
  await picker.click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/sidecars/placement") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: /Hidden \.psyneuview\// }).click(),
  ]);

  await expect(picker).toContainText(".psyneuview/", { timeout: 15_000 });

  // The actual assertion: files moved, and the old copies are gone. Leaving a
  // lateral copy behind would let lateral-first discovery keep serving it, so
  // "still present at the old path" is a real failure, not untidiness.
  await expect
    .poll(() => existsSync(dotted(layout)), { timeout: 15_000 })
    .toBe(true);
  expect(existsSync(dotted(labels))).toBe(true);
  expect(existsSync(lateral(layout))).toBe(false);
  expect(existsSync(lateral(labels))).toBe(false);

  // And back again — the reverse direction is a distinct code path in migrate().
  await picker.click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/model/sidecars/placement") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: /Beside the \.py/ }).click(),
  ]);

  await expect
    .poll(() => existsSync(lateral(layout)), { timeout: 15_000 })
    .toBe(true);
  expect(existsSync(dotted(layout))).toBe(false);
});

test("global placement default is followed, and stays out of the real prefs file (#1025)", { tag: "@ci" }, async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  page.on("dialog", (d) => d.accept());

  // The harness points the server at a session-local preferences file. Reading
  // it back proves the spawned server honours the override; the checksum of the
  // real one proves nothing leaked (the hazard #1025 was filed for).
  const sessionPrefs = path.join(process.env.PW_SESSION_TMP ?? "", "psynewview.json");
  const realPrefs = path.join(homedir(), ".psynewview.json");
  const readReal = () => (existsSync(realPrefs) ? readFileSync(realPrefs, "utf8") : null);
  const realBefore = readReal();

  // A model with no sidecars at all, so nothing already on disk pins its
  // placement and it genuinely follows the default.
  const dir = mkdtempSync(path.join(tmpdir(), "placement1025-"));
  const stem = "stroop_reference_basic";
  const model = path.join(dir, `${stem}.py`);
  copyFileSync(path.join(REF, `${stem}.py`), model);

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByTestId("settings-section-general").click();
    const select = page.locator("select").filter({ has: page.locator('option[value="dotfolder"]') });
    await expect(select).toBeEnabled({ timeout: 10_000 });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/settings/sidecar-placement") && r.request().method() === "POST",
      ),
      select.selectOption("dotfolder"),
    ]);
    expect(JSON.parse(readFileSync(sessionPrefs, "utf8")).sidecar_placement_default).toBe("dotfolder");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(select).toBeHidden();

    await page.getByRole("button", { name: /Open/ }).first().click();
    await page.getByRole("button", { name: "Open from path..." }).click();
    const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
    await prompt.fill(model);
    await prompt.press("Enter");
    await page
      .getByRole("button", { name: /^Skip$/ })
      .click({ timeout: 5000 })
      .catch(() => {});
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

    // Inheriting, so the model follows the global default.
    const picker = page.getByTitle(
      "Where this model's sidecar files (layouts, labels) are stored on disk",
    );
    await expect(picker).toContainText(".psyneuview/", { timeout: 15_000 });

    // Pin it the other way. The **Use default** row must now name where the
    // *default* would put files, not where they sit today — the #935 bug, until
    // now guarded only by unit tests. Clicking the picker at all is the #1211
    // regression: with this long label the header used to overflow, and
    // + Snippet sat on top of the picker.
    await picker.click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/model/sidecars/placement") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: /Beside the \.py/ }).click(),
    ]);
    await expect(picker).toContainText("beside .py", { timeout: 15_000 });
    await picker.click();
    await expect(page.getByRole("button", { name: /Use default/ })).toHaveAttribute(
      "title",
      /now: \.psyneuview\//,
    );
    await page.keyboard.press("Escape");
  } finally {
    // The session prefs file is shared by every spec in this run; put the
    // default back so later specs see `auto`.
    await request.post("/api/settings/sidecar-placement", { data: { placement: null } });
  }

  expect(readReal(), "the suite modified the developer's real ~/.psynewview.json").toBe(realBefore);
});

// The editor header used to fold to its compact layout only below a fixed
// 480px, chosen before the three sidecar pickers were added; between about
// 480px and 700px of editor width the row overflowed instead, and + Snippet
// sat on top of the Files placement picker. Two widths, because the two
// failures were different:
//
//  - at Playwright's default 1280px window (an editor pane of about 635px),
//    with the long `.psyneuview/ (default)` label the issue was filed with,
//    the picker was covered and could not be clicked;
//  - at 900px the header folds, and the compact second row used to carry the
//    layout and labels pickers but not this one, so it vanished entirely.
//
// SHOTS_DIR, when set, gets a picture of the header at each width.
for (const { label, width, height } of [
  { label: "the default window", width: 1280, height: 720 },
  { label: "a narrow window", width: 900, height: 800 },
]) {
  test(`the placement picker is clickable in ${label} (#1211)`, { tag: "@ci" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });

    // A model with no sidecars follows the global default; `dotfolder` gives
    // the picker its longest label, which is what overflowed the header.
    const dir = mkdtempSync(path.join(tmpdir(), "placement1211-"));
    const stem = "stroop_reference_basic";
    const model = path.join(dir, `${stem}.py`);
    copyFileSync(path.join(REF, `${stem}.py`), model);
    await request.post("/api/settings/sidecar-placement", { data: { placement: "dotfolder" } });

    try {
      await page.goto("/");
      await page.getByRole("button", { name: /Open/ }).first().click();
      await page.getByRole("button", { name: "Open from path..." }).click();
      const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
      await prompt.fill(model);
      await prompt.press("Enter");
      await page
        .getByRole("button", { name: /^Skip$/ })
        .click({ timeout: 5000 })
        .catch(() => {});
      await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 60_000 });

      const picker = page.getByTitle(
        "Where this model's sidecar files (layouts, labels) are stored on disk",
      );
      await expect(picker).toBeVisible({ timeout: 15_000 });
      // The long label the issue was filed with (its spans carry no spaces).
      await expect(picker).toContainText(/\.psyneuview\/\s*\(default\)/);
      await expect(page.getByText(/^Loaded /)).toBeHidden({ timeout: 15_000 });

      if (process.env.SHOTS_DIR) {
        const box = (await picker.boundingBox())!;
        await page.screenshot({
          path: path.join(process.env.SHOTS_DIR, `editor-header-${width}.png`),
          clip: { x: 0, y: Math.max(0, box.y - 10), width, height: box.height + 20 },
        });
        await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `page-${width}.png`) });
      }

      // Nothing sits on top of it and nothing clips it: what the browser
      // finds at the picker's centre, and just inside each end, is the picker
      // (or something inside it) — not + Snippet, and not the pane divider or
      // the canvas beyond it when the row runs off the pane's edge.
      const covered = await picker.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const y = r.y + r.height / 2;
        const bad: string[] = [];
        for (const [where, x] of [["left", r.x + 2], ["centre", r.x + r.width / 2], ["right", r.right - 2]] as const) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || !el.contains(hit)) bad.push(`${where}: ${hit?.textContent?.trim().slice(0, 40) ?? String(hit)}`);
        }
        return bad;
      });
      expect(covered, `the placement picker is covered or clipped (${covered.join("; ")})`).toEqual([]);

      // Reachable, not merely present: a real click that nothing intercepts.
      await picker.click();
      await expect(page.getByRole("button", { name: /Use default/ })).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await request.post("/api/settings/sidecar-placement", { data: { placement: null } });
    }
  });
}
