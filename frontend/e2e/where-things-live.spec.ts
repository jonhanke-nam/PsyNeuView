/**
 * Folders (#1295).
 *
 * Settings ▸ Folders lists everything you can open, each with its path and
 * whether it is yours to edit; Settings ▸ Developer lists where PsyNeuView
 * and PsyNeuLink are installed and the
 * managed PsyNeuLink copies with Remove for one not in use. Show in Finder
 * goes through the Mac app's pnvFile bridge, which is stubbed here: once as
 * an app that knows the op, once as an older app that doesn't, where the
 * path is copied instead and the note asks for an update.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { readOnlyTest as test, expect } from "./test-base";

type Page = import("@playwright/test").Page;

/**
 * The harness's working-copies folder (playwright.config sets
 * PSYNEWVIEW_WORKING_DIR to it); for a user it is ~/.psyneuview/working-copies
 * (#1319). Resolved the way the backend reports it.
 */
function sessionWorkingDir(): string {
  const dir = path.join(process.env.PW_SESSION_TMP!, "working");
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

/** The PathBox of a row; the project folder keeps its older test id. */
const pathOf = (id: string) => (id === "project-folder" ? "project-folder-current" : `location-${id}-path`);

async function openFolders(page: Page) {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-folders").click();
  await expect(page.getByTestId("folders-list")).toBeVisible();
}

/** A fake Mac app file bridge; `reveal` says how it answers a reveal. */
async function stubFileBridge(page: Page, reveal: "supported" | "old-app") {
  await page.addInitScript((mode) => {
    const w = window as any;
    w.__pnvFileMessages = [];
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => { w.__copied.push(t); } },
      configurable: true,
    });
    w.webkit = {
      messageHandlers: {
        pnvFile: {
          postMessage: async (body: any) => {
            w.__pnvFileMessages.push(body);
            if (body.op === "reveal") {
              if (mode === "supported") {
                if (body.path === "/nowhere") throw new Error("There's no folder at /nowhere.");
                return { revealed: true };
              }
              return { path: null }; // 0.5.15 and earlier: the op is unknown
            }
            return { path: null };
          },
        },
      },
    };
  }, reveal);
}

test("Folders lists every location with a path, and whose it is", { tag: "@ci" }, async ({ page }) => {
  const lab = mkdtempSync(path.join(tmpdir(), "pnv-lab-"));
  writeFileSync(path.join(lab, "lab_model.py"), "import psyneulink as pnl\n");
  const added = await page.request.post("/api/catalogs", { data: { path: lab, name: "Lab models" } });
  const catalog = await added.json();
  try {
    await openFolders(page);
    const where = page.getByTestId("folders-list");
    // In the Open menu's order: the project folder and the catalog (everyday)
    // above the catalogs under development, and the Library from the
    // installed PsyNeuLink.
    const rows = where.locator('[data-testid^="location-"]:not([data-testid$="-path"]):not([data-testid="location-ownership"])');
    // The seven above, plus where layouts for read-only PsyNeuLink files go (#1321).
    await expect(rows).toHaveCount(8);
    await expect(where.getByTestId("location-layouts")).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute("data-testid", "location-project-folder");
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "location-library");
    await expect(rows.nth(2)).toHaveAttribute("data-testid", `location-catalog-${catalog.id}`);
    for (const id of ["project-folder", `catalog-${catalog.id}`, "library", "references", "demos"]) {
      const row = where.getByTestId(`location-${id}`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId(pathOf(id))).toHaveAttribute("title", /^\//);
      await expect(row.getByTestId("location-ownership")).toHaveText(/yours to edit|managed for you/);
    }
    await expect(where.getByTestId("location-project-folder").getByTestId("location-ownership")).toHaveText("yours to edit");
    await expect(where.getByTestId("location-library").getByTestId("location-ownership")).toHaveText("managed for you");
    await expect(where.getByTestId("location-library")).toContainText("From the PsyNeuLink you've selected");
    await expect(where.getByTestId("location-references")).toContainText("Included with PsyNeuView");
    await expect(where.getByTestId(`location-catalog-${catalog.id}`)).toContainText("Lab models");
    await expect(where.getByTestId(`remove-catalog-${catalog.id}`)).toBeVisible();
    // Where edits to included models are kept (#1319): outside the install —
    // the harness's folder here, ~/.psyneuview/working-copies for a user.
    const working = where.getByTestId("location-working-copies");
    await expect(working).toContainText("Working copies of included models");
    await expect(working.getByTestId("location-working-copies-path")).toHaveAttribute("title", sessionWorkingDir());
    // In a browser there is no Finder to show; the path can be copied.
    await expect(where.getByRole("button", { name: "Copy path" }).first()).toBeVisible();
    await expect(where.getByRole("button", { name: "Show in Finder" })).toHaveCount(0);

    // "Change in Developer" opens Developer, where the two installs are.
    await where.getByRole("button", { name: "Change in Developer" }).first().click();
    await expect(page.getByTestId("settings-content-developer")).toBeVisible();
    for (const id of ["psyneuview", "psyneulink"]) {
      const row = page.getByTestId("install-locations").getByTestId(`location-${id}`);
      await expect(row.getByTestId(`location-${id}-path`)).toHaveAttribute("title", /^\//);
      await expect(row.getByTestId("location-ownership")).toHaveText(/yours to edit|managed for you/);
    }
  } finally {
    await page.request.delete(`/api/catalogs/${catalog.id}`);
  }
});

test("opening a Reference Model writes its working copy in the working-copies folder", { tag: "@ci" }, async ({ request }) => {
  // The folder Settings ▸ Folders shows is the one the copies really go to (#1319).
  const resp = await request.post("/api/reference-models/load", { data: { name: "GilzenratModel" } });
  expect(resp.ok()).toBeTruthy();
  const { file_path } = await resp.json();
  expect(path.dirname(file_path)).toBe(sessionWorkingDir());
  expect(path.basename(file_path)).toBe("GilzenratModel.py");
  expect(existsSync(file_path)).toBe(true);
});

test("Show in Finder asks the Mac app, and says why when it refuses", { tag: "@ci" }, async ({ page }) => {
  await stubFileBridge(page, "supported");
  await openFolders(page);
  const row = page.getByTestId("location-project-folder");
  const folder = await row.getByTestId(pathOf("project-folder")).getAttribute("title");
  await row.getByRole("button", { name: "Show in Finder" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__pnvFileMessages.at(-1))).toEqual({
    op: "reveal", path: folder,
  });
  await expect(row.getByTestId("reveal-note")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__copied)).toEqual([]);
});

test("with an older Mac app, Show in Finder copies the path and asks for an update", { tag: "@ci" }, async ({ page }) => {
  await stubFileBridge(page, "old-app");
  await openFolders(page);
  const row = page.getByTestId("location-project-folder");
  const folder = await row.getByTestId(pathOf("project-folder")).getAttribute("title");
  await row.getByRole("button", { name: "Show in Finder" }).click();
  await expect(row.getByTestId("reveal-note")).toHaveText(
    "Copied the path. Update the PsyNeuView app to open folders in Finder.",
  );
  expect(await page.evaluate(() => (window as any).__copied)).toEqual([folder]);
});

test("Developer lists the managed copies; one not in use can be removed after confirming", { tag: "@ci" }, async ({ page }) => {
  const deleted: string[] = [];
  const copies = () => [
    {
      name: "PsyNeuLink-PrincetonUniversity", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
      repo: "PrincetonUniversity/PsyNeuLink", size_bytes: 412_000_000, size_complete: true, last_used: Date.now() / 1000 - 86400, in_use: true,
    },
    ...(deleted.length ? [] : [{
      name: "PsyNeuLink-jonhanke-nam", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-jonhanke-nam",
      repo: "jonhanke-nam/PsyNeuLink", size_bytes: 398_000_000, size_complete: false, last_used: Date.now() / 1000 - 40 * 86400, in_use: false,
    }]),
  ];
  await page.route("**/api/locations", (r) =>
    r.fulfill({
      json: {
        psyneuview: { path: "/Users/someone/code/PsyNeuView", kind: "checkout", editable: true, version: "0.5.9", commit: "abc1234" },
        psyneulink: {
          version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34",
          path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity", editable: false, managed: true,
        },
        projectFolder: { path: "/Users/someone/Documents/PsyNeuView-My-Models", exists: true, fixed: false, fixedBy: null },
        catalogs: [],
        appData: { root: "/Users/someone/.psyneuview", sources: "/Users/someone/.psyneuview/sources", configFile: "/Users/someone/.psynewview.json" },
        managedCopies: copies(),
        checkouts: [{ path: "/Users/someone/code/PsyNeuLink", label: null, exists: true, in_use: false }],
      },
    }),
  );
  await page.route("**/api/locations/managed-copies/*", (r) => {
    deleted.push(decodeURIComponent(r.request().url().split("/managed-copies/")[1]));
    return r.fulfill({ json: { removed: "/Users/someone/.psyneuview/sources/PsyNeuLink-jonhanke-nam" } });
  });

  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-section-developer").click();
  const group = page.getByTestId("settings-group-managed-copies");
  await expect(group.getByTestId("settings-group-managed-copies-summary")).toHaveText(
    "2 managed copies under ~/.psyneuview/sources",
  );
  await expect(group.getByTestId("developer-badge")).toBeVisible();
  await group.getByRole("button", { name: "Managed PsyNeuLink copies and checkouts" }).click();

  const princeton = group.locator('[data-testid="managed-copy"][data-name="PsyNeuLink-PrincetonUniversity"]');
  const fork = group.locator('[data-testid="managed-copy"][data-name="PsyNeuLink-jonhanke-nam"]');
  await expect(princeton).toContainText("in use");
  await expect(princeton).toContainText("393 MB on disk · last used yesterday");
  await expect(princeton.getByTestId("managed-copy-remove")).toHaveCount(0);
  await expect(fork).toContainText("at least 380 MB on disk");
  await expect(group.getByTestId("location-checkout-/Users/someone/code/PsyNeuLink")).toBeVisible();

  await fork.getByTestId("managed-copy-remove").click();
  await expect(fork.getByTestId("managed-copy-confirm")).toContainText("Only ~/.psyneuview/sources/PsyNeuLink-jonhanke-nam");
  expect(deleted).toEqual([]);
  await fork.getByTestId("managed-copy-confirm-remove").click();
  await expect.poll(() => deleted).toEqual(["PsyNeuLink-jonhanke-nam"]);
  await expect(fork).toHaveCount(0);
  await expect(group.getByTestId("managed-copy")).toHaveCount(1);
});
