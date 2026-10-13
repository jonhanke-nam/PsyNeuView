/**
 * Switching the PsyNeuLink source refreshes the Open menu's Library (#1253).
 *
 * The menu fetched the Library once, when the page started. A source switch
 * in Settings uninstalls one PsyNeuLink and installs another, and Apply &
 * restart doesn't reload the page, so the Library kept offering paths into
 * the copy that had just been removed: opening one said "File not found".
 *
 * A real install takes minutes and changes the backend's environment, so the
 * install and the Library are answered here: before the install the Library
 * points at the old copy, after it at the new one. The Settings screen, the
 * Open menu and the load request are the app's own.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { stubFolderCheck } from "./pnl-switch-stub";

const OLD = "/old-install/psyneulink/library/models/GilzenratModel.py";
const NEW = "/new-checkout/psyneulink/library/models/GilzenratModel.py";
const JOB = "job-1253";

test("a source switch in Settings points the Library at the new install", { tag: "@ci" }, async ({ page }) => {
  let installed = false;
  let loadedPath: string | null = null;

  await stubFolderCheck(page);

  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  const job = (status: string) => ({
    id: JOB, source: "local", ref: null, path: "/new-checkout", repo: null,
    status, log: [], exit_code: status === "succeeded" ? 0 : null,
    started_at: 0, finished_at: status === "succeeded" ? 1 : null,
  });
  await page.route("**/api/settings/install", (r) =>
    r.request().method() === "POST" ? r.fulfill({ json: job("running") }) : r.fallback(),
  );
  await page.route(`**/api/settings/install/${JOB}`, (r) => {
    installed = true;
    return r.fulfill({ json: job("succeeded") });
  });
  await page.route("**/api/library-models", (r) =>
    r.fulfill({
      json: { models: [{ name: "GilzenratModel", label: "Gilzenratmodel", path: installed ? NEW : OLD }] },
    }),
  );
  await page.route("**/api/model/load", (r) => {
    loadedPath = r.request().postDataJSON().file_path;
    return r.fulfill({ status: 404, json: { detail: "stubbed" } });
  });

  await page.goto("/");

  // Switch the source the way a user does.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
  await page.getByTestId("setting-pnl-source").click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();
  await page.getByPlaceholder("/path/to/PsyNeuLink").fill("/new-checkout");
  await page.getByRole("button", { name: "Apply & restart" }).click();
  await expect(page.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // No reload. Open the model from the Library.
  await page.getByTestId("open-menu").click();
  const item = page.getByRole("button", { name: "Gilzenratmodel", exact: true });
  if (!(await item.isVisible())) await page.getByText("PsyNeuLink Library", { exact: true }).click();
  await item.click();

  await expect.poll(() => loadedPath).toBe(NEW);
});
