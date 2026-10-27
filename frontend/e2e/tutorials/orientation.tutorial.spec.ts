/**
 * PsyNeuView First Steps — the new-user orientation (#1310, parts
 * #1311–#1318), driven from the walkthroughs themselves.
 *
 * One test per part, each loading `src/walkthroughs/orientation-*.yaml` — the
 * file the app reads — and walking every step the way a learner would: read
 * the instruction, check the ring, act, check the app says "✓ Done." So a
 * part that stops matching the app fails here, not in a new user's hands.
 *
 * The parts that only point and explain complete on the bar's Next; the rest
 * on the learner's action (a tab opened, a node selected, a file saved, a
 * run). The driver understands both.
 *
 * Part 5 stubs what Settings asks the backend about PsyNeuLink: the harness
 * runs a PsyNeuLink pinned to a commit, which General reports as a custom
 * choice, while the walkthrough describes the everyday picture (Latest
 * development, with its status line). Every anchor exists either way; the
 * stub makes the screenshots show what the words say.
 *
 * Screenshots go to docs/tutorials/assets/orientation/ (regenerated, like the
 * other tutorials'), and, when SHOTS_DIR is set, the review set there.
 */
import type { Page } from "@playwright/test";
import { mutatingTest as test, expect } from "../test-base";
import { loadWalkthrough, runWalkthrough, type Walkthrough } from "../tourDriver";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync, rmSync } from "fs";

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/tutorials/assets/orientation");
mkdirSync(ASSETS, { recursive: true });

/** Both the docs' copy and, when asked for, the review copy. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(ASSETS, `${name}.png`) });
  if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `${name}.png`) });
}

const PARTS = [
  "orientation-window",
  "orientation-open",
  "orientation-editing",
  "orientation-saving",
  "orientation-psyneulink",
  "orientation-running",
  "orientation-settings",
  "orientation-developers",
].map(loadWalkthrough);

test.use({ viewport: { width: 1600, height: 1000 } });

/** The everyday picture of General ▸ PsyNeuLink version, for part 5. */
async function stubLatestDevelopment(page: Page) {
  const latest = {
    version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink",
    commit: "72dde34", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity",
  };
  const checkedAt = Math.floor(Date.now() / 1000) - 20 * 60;
  await page.route("**/api/settings/info", async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: { ...real, psyneulink: latest } });
  });
  await page.route("**/api/settings/pnl-releases", (r) =>
    r.fulfill({
      json: {
        releases: [
          { version: "0.20.2.0", released: "2026-08-14", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: false, limited_reason: null, kept: false },
          { version: "0.18.0.0", released: "2025-09-12", requires_python: ">=3.10", yanked: false, compatible: true, reason: null, limited: true, limited_reason: "No run stepping, value pills or Run State: needs 0.19.1.0 or later", kept: false },
        ],
        offline: false, python_version: "3.13.7", in_use: null, releases_dir: "/Users/someone/.psyneuview/releases",
      },
    }),
  );
  await page.route("**/api/settings/pnl-freshness", (r) =>
    r.fulfill({ json: { status: "current", behind_by: 0, installed_commit: "72dde34", head_commit: "72dde34", head_date: "2026-10-06T18:02:00Z", detail: "Up to date with devel." } }),
  );
  await page.route("**/api/settings/pnl-updates", (r) =>
    r.fulfill({
      json: {
        installed: latest, auto_update: true, interval_s: 14400, last_check_at: checkedAt,
        last_result: {
          checked_at: checkedAt, source: "github", version: "0.19.1.0", repo: latest.repo, branch: "devel", commit: "72dde34",
          freshness: { status: "current", behind_by: 0, installed_commit: "72dde34", head_commit: "72dde34", head_date: "2026-10-06T18:02:00Z", detail: "Up to date with devel." },
          newest_release: null, release_available: false, offline: false,
        },
        update_ready: false, ready_commit: null, last_install: null, checks_enabled: true, checkouts: [],
      },
    }),
  );
}

const DEV_MODE_KEY = "psynewview_ui_prefs_developerMode";

for (const part of PARTS as Walkthrough[]) {
  test.describe(`Orientation ${part.orientation}: ${part.title}`, () => {
    test("every step is shown with its caption, acted on, and completes", async ({ page }) => {
      test.setTimeout(240_000);
      if (part.id === "orientation-psyneulink") await stubLatestDevelopment(page);
      // Parts 3 and 4 start a new model by name. The harness's reset clears
      // the working copies, not My Project Folder, so a retry in the same
      // session would meet "File already exists". Start clean.
      for (const step of part.steps) {
        if (step.act?.newModel && process.env.PW_SESSION_TMP) {
          rmSync(path.join(process.env.PW_SESSION_TMP, "models", `${step.act.newModel}.py`), { force: true });
          rmSync(path.join(process.env.PW_SESSION_TMP, "models", ".psyneuview"), { recursive: true, force: true });
        }
      }
      // The developer track turns developer mode on itself; start from off,
      // so the walkthrough's own switch is what the test exercises.
      if (part.developerMode) await page.addInitScript((key) => localStorage.removeItem(key), DEV_MODE_KEY);

      await page.goto(`/?tour=${part.id}`);
      if (part.model) {
        // The walkthrough opens the model it was written for (#1224).
        await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
      }
      // The bar names the docs page the part relies on (#1310).
      await expect(page.getByTestId("tour-docs")).toContainText(part.docs ? [part.docs].flat()[0] : "");

      if (part.developerMode) await expect(page.getByTestId("developer-mode-indicator")).toBeVisible();

      await runWalkthrough(page, part, async (step, index) => {
        // Captions are always on: every step of the orientation has one.
        if (step.say) await expect(page.getByTestId("tour-caption")).toHaveText(step.say);
        // The arrow is off by default (#100): the ring alone marks the anchor.
        await expect(page.getByTestId("tour-pointer")).toHaveCount(0);
        await page.waitForTimeout(250);
        await shot(page, `${part.id}-step-${index + 1}`);
      });

      await expect(page.getByTestId("tour-bar")).toHaveCount(0, { timeout: 10_000 });
      // The developer track puts developer mode back as it found it.
      if (part.developerMode) {
        await expect(page.getByTestId("developer-mode-indicator")).toHaveCount(0);
        expect(await page.evaluate((key) => localStorage.getItem(key), DEV_MODE_KEY)).toBe("false");
      }
    });
  });
}
