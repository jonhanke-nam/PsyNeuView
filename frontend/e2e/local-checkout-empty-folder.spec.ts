/**
 * Another local checkout…: the folder is checked as soon as it is typed, and
 * an empty one can have PsyNeuLink downloaded into it (#1342).
 *
 * Before, an empty folder looked fine until Apply & restart, then failed with
 * an error at the bottom of the panel in developer terms. Now the line under
 * the Path field says what the folder is: a PsyNeuLink checkout; an empty or
 * missing folder, with "Download PsyNeuLink here" and where from; or a folder
 * of other files, in plain words, with no button.
 *
 * The folders are real temporary folders and the check is the real backend's
 * (`/api/settings/install/check-folder`, which only reads the disk). What is
 * installed, the known sources and the install job itself are answered here,
 * so nothing is downloaded or installed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readOnlyTest as test, expect } from "./test-base";
import { FORK, openDeveloper, stubSwitchBackend } from "./pnl-switch-stub";

type Page = import("@playwright/test").Page;

const JOB = "job-1342";

let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pnv-1342-"));
});
test.afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The panel with "Another local checkout…" chosen and `folder` typed. */
async function typePath(page: Page, folder: string) {
  await stubSwitchBackend(page);
  // The folder check goes to the real backend (registered last, so it wins).
  await page.route("**/api/settings/install/check-folder?**", (r) => r.continue());
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  await group.getByTestId("setting-pnl-source").click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();
  await group.getByTestId("install-path").fill(folder);
  return group;
}

/** Answer the install request with a job that downloads and succeeds. */
async function stubInstall(page: Page, posted: Array<Record<string, unknown>>) {
  const job = (status: string) => ({
    id: JOB, source: "local", ref: null, path: posted[0]?.path ?? null, repo: null, status,
    log: ["✓ download PsyNeuLink in 41.0s", "✓ checkout devel in 0.4s", "✓ pip install -e in 6.2s", "Total: 47.6s"],
    exit_code: status === "succeeded" ? 0 : null, started_at: 0, finished_at: status === "succeeded" ? 48 : null,
    download_repo: posted[0]?.download_repo ?? null, download_ref: posted[0]?.download_ref ?? null,
  });
  await page.route("**/api/settings/install", (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    posted.push(r.request().postDataJSON());
    return r.fulfill({ json: job("running") });
  });
  await page.route(`**/api/settings/install/${JOB}`, (r) => r.fulfill({ json: job("succeeded") }));
}

test("an empty folder: the offer to download PsyNeuLink appears, and Apply downloads it", async ({ page }) => {
  const folder = path.join(root, "PNV--my-local-PNL-repo");
  mkdirSync(folder);
  const posted: Array<Record<string, unknown>> = [];
  await stubInstall(page, posted);
  const group = await typePath(page, folder);

  const offer = group.getByTestId("install-download-offer");
  await expect(offer).toBeVisible();
  await expect(offer).toContainText("Download PsyNeuLink here");
  await expect(offer).toContainText("This folder is empty.");
  // Latest development is the default; the other known GitHub sources follow.
  const from = group.getByTestId("install-download-from");
  await expect(from.locator("option:checked")).toHaveText("Latest development (PrincetonUniversity/PsyNeuLink @ devel)");
  await expect(from.locator("option")).toContainText([`${FORK} @ devel`, `${FORK} @ jonhanke-dev`]);
  // The summary and the expected wait say it is a download; the button is there.
  await expect(group.getByTestId("install-switch-summary")).toContainText("PsyNeuLink will be downloaded from Latest development");
  await expect(group.getByTestId("install-wait-hint")).toHaveText("Expected wait: a few minutes, to download PsyNeuLink");
  await expect(group.getByTestId("install-path-refused")).toHaveCount(0);
  await expect(group.getByTestId("install-choice-hint")).toHaveCount(0);
  const apply = group.getByTestId("install-apply");
  await expect(apply).toBeEnabled();

  // Another source, then Apply: the request carries the download.
  await from.selectOption({ label: `${FORK} @ jonhanke-dev` });
  await expect(group.getByTestId("install-switch-summary")).toContainText(`downloaded from ${FORK} @ jonhanke-dev`);
  await apply.click();
  await expect(group.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  expect(posted).toEqual([{ source: "local", path: folder, download_repo: FORK, download_ref: "jonhanke-dev" }]);
});

test("a folder that doesn't exist yet is offered the download too", async ({ page }) => {
  const group = await typePath(page, path.join(root, "PsyNeuLink"));
  await expect(group.getByTestId("install-download-offer")).toContainText("This folder doesn't exist yet: it will be made.");
  await expect(group.getByTestId("install-apply")).toBeEnabled();
});

test("a folder of other files: the reason under the field, and no Apply", async ({ page }) => {
  const folder = path.join(root, "Thesis-notes");
  mkdirSync(folder);
  writeFileSync(path.join(folder, "chapter1.md"), "notes");
  const group = await typePath(page, folder);

  const refused = group.getByTestId("install-path-refused");
  await expect(refused).toContainText("This folder already has other files in it and isn't a PsyNeuLink checkout");
  await expect(refused).toContainText("a PsyNeuLink checkout has a psyneulink folder and a pyproject.toml or setup.py");
  await expect(group.getByTestId("install-apply")).toHaveCount(0);
  await expect(group.getByTestId("install-download-offer")).toHaveCount(0);
  await expect(group.getByTestId("install-switch-summary")).toHaveCount(0);
  // Directly under the Path field: nothing between them.
  const fieldBox = await group.getByTestId("install-path").boundingBox();
  const lineBox = await refused.boundingBox();
  expect(lineBox!.y - (fieldBox!.y + fieldBox!.height)).toBeLessThan(20);

  // Emptied, it is a download; given a checkout, it is a checkout.
  rmSync(path.join(folder, "chapter1.md"));
  await group.getByTestId("install-path").fill(`${folder}/`);
  await expect(group.getByTestId("install-download-offer")).toBeVisible();
  writeFileSync(path.join(folder, "pyproject.toml"), '[project]\nname = "psyneulink"\n');
  mkdirSync(path.join(folder, "psyneulink"));
  await group.getByTestId("install-path").fill(folder);
  await expect(group.getByTestId("install-path-usable")).toHaveText("✓ A PsyNeuLink checkout.");
  await expect(group.getByTestId("install-apply")).toBeEnabled();
  await expect(group.getByTestId("install-wait-hint")).toHaveText("Expected wait: a few seconds");
});
