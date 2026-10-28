/**
 * Every Open menu section says where it comes from, and a PsyNeuLink switch
 * says what changed (#1295).
 *
 * The PsyNeuLink sections' headings name the installed PsyNeuLink; a
 * catalog's names its folder; the bundled ones say "included with
 * PsyNeuView". Switching the source in Settings first says what will change
 * and what won't; afterwards the Open menu carries a one-time note until it
 * is dismissed. The install is answered here, as in the other switch specs:
 * a real one takes minutes and changes the environment.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { stubFolderCheck } from "./pnl-switch-stub";

const JOB = "job-1295";

const github = {
  version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
  commit: "72dde34", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
};
const checkout = {
  version: "0.19.1.0", source: "editable", branch: "jonhanke-dev", repo: "jonhanke-nam/PsyNeuLink",
  commit: "1a2b3c4", path: "/Users/someone/code/PsyNeuLink",
};

test("section headings say where they come from; a switch is explained before and noted after", { tag: "@ci" }, async ({ page }) => {
  let installed = false;
  const pnl = () => (installed ? checkout : github);

  await page.route("**/api/catalog-sources", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, pnl: pnl() } });
  });
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: pnl() } });
  });
  await stubFolderCheck(page);
  await page.route("**/api/settings/install/capabilities", (r) =>
    r.fulfill({ json: { enabled: true, reason: null, in_mac_app: false, mode: "local" } }),
  );
  await page.route("**/api/settings/pnl-sources", (r) => r.fulfill({ json: { sources: [] } }));
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "not_applicable", behind_by: null, installed_commit: null, head_commit: null, head_date: null, detail: "" } }),
  );
  const job = (status: string) => ({
    id: JOB, source: "local", ref: null, path: checkout.path, repo: null, status, log: [],
    exit_code: status === "succeeded" ? 0 : null, started_at: 0, finished_at: status === "succeeded" ? 1 : null,
  });
  await page.route("**/api/settings/install", (r) =>
    r.request().method() === "POST" ? r.fulfill({ json: job("running") }) : r.fallback(),
  );
  await page.route(`**/api/settings/install/${JOB}`, (r) => {
    installed = true;
    return r.fulfill({ json: job("succeeded") });
  });

  await page.goto("/");
  await page.getByTestId("open-menu").click();
  const heading = (name: RegExp) => page.getByRole("button", { name });
  const sourceOf = (name: RegExp) => heading(name).getByTestId("open-menu-section-source");
  await expect(sourceOf(/PsyNeuLink Library/)).toHaveText("from PrincetonUniversity/PsyNeuLink @ devel");
  await expect(sourceOf(/Reference Models/)).toHaveText("included with PsyNeuView");
  await expect(sourceOf(/Demo Models/)).toHaveText("included with PsyNeuView");
  // My Project Folder names its folder: the harness's temp folder, a full path.
  await expect(sourceOf(/My Project Folder/)).toHaveText(/^\//);
  // A long path shortens; the section's name stays on one line, as tall as
  // the path beside it (it used to wrap to three lines).
  const [nameBox, pathBox] = await Promise.all([
    heading(/My Project Folder/).getByText("My Project Folder", { exact: true }).boundingBox(),
    sourceOf(/My Project Folder/).boundingBox(),
  ]);
  expect(nameBox!.height).toBeLessThan(pathBox!.height * 2);
  await expect(page.getByTestId("open-menu-source-switch-note")).toHaveCount(0);
  await page.getByTestId("open-menu").click();

  // Before the switch, Settings says what it will change.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-section-developer").click();
  await expect(page.getByTestId("install-switch-summary")).toHaveCount(0); // the form describes the current install
  await page.getByTestId("setting-pnl-source").click();
  await page.getByRole("option", { name: "Another local checkout…" }).click();
  await page.getByPlaceholder("/path/to/PsyNeuLink").fill(checkout.path);
  await expect(page.getByTestId("install-switch-summary")).toHaveText(
    "Library, Examples and Tests will list the models in your checkout at ~/code/PsyNeuLink. " +
      "My Project Folder and your catalogs stay the same.",
  );
  await page.getByRole("button", { name: "Apply & restart" }).click();
  await expect(page.getByText(/Install succeeded/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // After it, the menu says so once, and the headings follow.
  await page.getByTestId("open-menu").click();
  const note = page.getByTestId("open-menu-source-switch-note");
  await expect(note).toContainText("Library, Examples and Tests now list your checkout at ~/code/PsyNeuLink.");
  await expect(sourceOf(/PsyNeuLink Library/)).toHaveText("from your checkout at ~/code/PsyNeuLink");
  await expect(sourceOf(/Reference Models/)).toHaveText("included with PsyNeuView");
  await note.getByRole("button", { name: "Dismiss" }).click();
  await expect(note).toHaveCount(0);
  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu").click();
  await expect(page.getByTestId("open-menu-source-switch-note")).toHaveCount(0);
  // Opening the menu refetches where its sections come from (#1395); let a
  // fetch still in flight go when the test ends.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
