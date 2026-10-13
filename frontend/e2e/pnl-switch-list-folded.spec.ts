/**
 * The Switch to list folds into groups (#1334).
 *
 * In hand testing of 0.5.17 the list showed every known source and every
 * release at once — long, and the two "Another…" choices at the very
 * bottom. Now the "Another…" rows come first, the rest sits under headings
 * that fold, each with its count, and only the group holding the
 * PsyNeuLink in use starts open. The data is a developer's real Settings
 * (pnl-switch-stub.ts): a managed Princeton clone on devel in use, six of
 * its branches, three of a fork, one checkout, nine releases.
 */
import { readOnlyTest as test, expect } from "./test-base";
import { CHECKOUT, FORK, FORK_BRANCHES, PRINCETON, openDeveloper, stubSwitchBackend } from "./pnl-switch-stub";

type Page = import("@playwright/test").Page;

const PRINCETON_GROUP = "pnl-switch-group-repo:princetonuniversity/psyneulink";
const FORK_GROUP = "pnl-switch-group-repo:jonhanke-nam/psyneulink";
/** A branch row by its name alone, with or without the "✓ in use" badge. */
const branch = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}( ✓ in use)?$`);

async function openList(page: Page) {
  await page.getByTestId("setting-pnl-source").click();
  const listbox = page.getByTestId("pnl-switch-listbox");
  await expect(listbox).toBeVisible();
  return listbox;
}

const heading = (page: Page, groupTestId: string) => page.getByTestId(groupTestId).getByTestId("pnl-switch-group-heading");

test("the list opens short: Another… first, only the group in use open, a folded group saying it holds the one in use", async ({ page }) => {
  await stubSwitchBackend(page);
  await openDeveloper(page);
  const listbox = await openList(page);

  // The two "Another…" rows first, always in view.
  await expect(listbox.getByRole("option").first()).toHaveAccessibleName("Another local checkout…");
  await expect(listbox.getByRole("option").nth(1)).toHaveAccessibleName("Another GitHub repo or branch…");

  // Headings with counts; only Princeton's group open, since devel is in use there.
  await expect(listbox.getByTestId("pnl-switch-group-heading")).toHaveText([
    /Your checkouts \(1\)/, /PrincetonUniversity\/PsyNeuLink \(6\)/, /jonhanke-nam\/PsyNeuLink \(3\)/, /Official releases on PyPI \(9\) · newest 0\.20\.2\.0/,
  ]);
  await expect(heading(page, "pnl-switch-group-checkouts")).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, PRINCETON_GROUP)).toHaveAttribute("aria-expanded", "true");
  await expect(heading(page, FORK_GROUP)).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, "pnl-switch-group-releases")).toHaveAttribute("aria-expanded", "false");
  // 2 "Another…" rows + 6 branches: nothing else is on show.
  await expect(listbox.getByRole("option")).toHaveCount(8);
  const inUse = page.getByTestId(PRINCETON_GROUP).getByRole("option", { name: branch("devel") });
  await expect(inUse).toContainText("in use");
  await expect(inUse).toBeFocused();
  await expect(listbox.getByTestId("pnl-switch-group-heading").filter({ hasText: "in use" })).toHaveCount(0);

  // Folded, the group says it holds the one in use.
  await heading(page, PRINCETON_GROUP).click();
  await expect(heading(page, PRINCETON_GROUP)).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, PRINCETON_GROUP)).toContainText("✓ in use");
  await expect(listbox.getByRole("option")).toHaveCount(2);

  // Fold state lives only while the list is open: closed and reopened, it opens the same way.
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(page.getByTestId("settings-content-developer")).toBeVisible();
  await openList(page);
  await expect(heading(page, PRINCETON_GROUP)).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(8);
});

test("unfolding a repo shows its branches alone; picking one shows the full source and Apply", async ({ page }) => {
  await stubSwitchBackend(page);
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  const listbox = await openList(page);

  await heading(page, FORK_GROUP).click();
  const fork = page.getByTestId(FORK_GROUP);
  await expect(fork.getByRole("option")).toHaveText(FORK_BRANCHES);
  await expect(fork.getByRole("option", { name: branch("jonhanke-dev") })).toHaveAttribute("title", `${FORK} @ jonhanke-dev`);
  // Princeton's group stays open too: unfolding one doesn't fold another.
  await expect(listbox.getByRole("option")).toHaveCount(11);

  await fork.getByRole("option", { name: branch("jonhanke-dev") }).click();
  await expect(listbox).toHaveCount(0);
  await expect(group.getByTestId("setting-pnl-source")).toContainText(`${FORK} @ jonhanke-dev`);
  await expect(group.getByTestId("install-choice-name")).toHaveText(`${FORK} @ jonhanke-dev`);
  await expect(group.getByTestId("install-switch-summary")).toContainText(`Library, Examples and Tests will list the models in ${FORK} @ jonhanke-dev.`);
  await expect(group.getByTestId("install-apply")).toBeVisible();
  await expect(group.getByPlaceholder("devel")).toHaveCount(0);

  // Reopened: the chosen row's group is open as well as the one in use, and the chosen row has focus.
  await openList(page);
  await expect(heading(page, FORK_GROUP)).toHaveAttribute("aria-expanded", "true");
  await expect(heading(page, PRINCETON_GROUP)).toHaveAttribute("aria-expanded", "true");
  await expect(fork.getByRole("option", { name: branch("jonhanke-dev") })).toBeFocused();
  await expect(fork.getByRole("option", { name: branch("jonhanke-dev") })).toHaveAttribute("aria-selected", "true");

  // A checkout: its name, with the path as the full name.
  await heading(page, "pnl-switch-group-checkouts").click();
  await page.getByTestId("pnl-switch-group-checkouts").getByRole("option", { name: "My fork checkout" }).click();
  await expect(group.getByTestId("install-choice-name")).toHaveText(`My fork checkout — ${CHECKOUT}`);
  await expect(group.getByTestId("install-apply")).toBeVisible();
});

test("the releases: the newest five, then Show older reveals the rest, the incompatible ones disabled with the reason", async ({ page }) => {
  await stubSwitchBackend(page);
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  await openList(page);
  const releases = page.getByTestId("pnl-switch-group-releases");

  await heading(page, "pnl-switch-group-releases").click();
  await expect(releases.getByRole("option")).toHaveText([/^0\.20\.2\.0/, /^0\.20\.1\.0/, /^0\.20\.0\.0/, /^0\.19\.1\.0/, /^0\.19\.0\.0/]);
  await expect(releases.getByRole("option", { name: /0\.20\.2\.0/ })).toContainText("released 2026-08-14 · kept");
  const older = releases.getByTestId("pnl-switch-show-older");
  await expect(older).toHaveText("Show older (4)");

  await older.click();
  await expect(older).toHaveCount(0);
  await expect(releases.getByRole("option")).toHaveCount(9);
  await expect(releases.getByRole("option", { name: /0\.18\.1\.0/ })).toBeFocused();
  await expect(releases.getByRole("option", { name: /0\.18\.0\.0/ })).toBeDisabled();
  await expect(releases.getByRole("option", { name: /0\.18\.0\.0/ })).toHaveAttribute("title", "PyPI 0.18.0.0 — Needs Python <3.13; this PsyNeuView runs Python 3.13.7");
  await expect(releases.getByRole("option", { name: /0\.17\.0\.0/ })).toBeDisabled();

  await releases.getByRole("option", { name: /0\.20\.1\.0/ }).click();
  await expect(group.getByTestId("install-choice-name")).toHaveText("PyPI 0.20.1.0");
  await expect(group.getByTestId("install-switch-summary")).toContainText("PyPI 0.20.1.0 (the official release)");
  await expect(group.getByTestId("install-apply")).toBeVisible();
});

test("keyboard: Up and Down over headings and rows, Right and Left unfold and fold, Enter picks, Escape closes", async ({ page }) => {
  await stubSwitchBackend(page);
  await openDeveloper(page);
  const group = page.getByTestId("settings-group-pnl-install");
  const dropdown = group.getByTestId("setting-pnl-source");

  // Down on the trigger opens the list on the one in use.
  await dropdown.focus();
  await page.keyboard.press("ArrowDown");
  const listbox = page.getByTestId("pnl-switch-listbox");
  const inUse = page.getByTestId(PRINCETON_GROUP).getByRole("option", { name: branch("devel") });
  await expect(inUse).toBeFocused();

  // Left from a row: up to its heading, folded.
  await page.keyboard.press("ArrowLeft");
  await expect(heading(page, PRINCETON_GROUP)).toBeFocused();
  await expect(heading(page, PRINCETON_GROUP)).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, PRINCETON_GROUP)).toContainText("in use");

  // Down to the next heading; Right unfolds it; Down into its first branch; Up back; Enter folds it.
  await page.keyboard.press("ArrowDown");
  await expect(heading(page, FORK_GROUP)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(heading(page, FORK_GROUP)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId(FORK_GROUP).getByRole("option", { name: branch("devel") })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(heading(page, FORK_GROUP)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heading(page, FORK_GROUP)).toHaveAttribute("aria-expanded", "false");
  // Left on a folded heading, or Right on an open one, changes nothing.
  await page.keyboard.press("ArrowLeft");
  await expect(heading(page, FORK_GROUP)).toHaveAttribute("aria-expanded", "false");
  await expect(heading(page, FORK_GROUP)).toBeFocused();

  // Home is the first row; End the last heading, everything being folded; Space unfolds it.
  await page.keyboard.press("Home");
  await expect(listbox.getByRole("option", { name: "Another local checkout…" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(heading(page, "pnl-switch-group-releases")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(heading(page, "pnl-switch-group-releases")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("pnl-switch-group-releases").getByRole("option", { name: /0\.20\.1\.0/ })).toBeFocused();

  // Escape closes the list, not Settings (#1288).
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(page.getByTestId("settings-content-developer")).toBeVisible();
  await expect(group.getByTestId("install-apply")).toHaveCount(0);

  // Again by keyboard, picking a branch of the fork: Enter on the row.
  await dropdown.focus();
  await page.keyboard.press("ArrowDown");
  await expect(inUse).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId(FORK_GROUP).getByRole("option", { name: branch("jonhanke-dev") })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(listbox).toHaveCount(0);
  await expect(group.getByTestId("install-choice-name")).toHaveText(`${FORK} @ jonhanke-dev`);
  await expect(group.getByTestId("install-apply")).toBeVisible();
});

test("nothing matches what is in use: every group starts folded", async ({ page }) => {
  await stubSwitchBackend(page, () => ({
    version: "0.19.1.0", source: "github", branch: "feature/x", repo: "someone-else/PsyNeuLink", commit: "abcdef0",
    path: "/Users/someone/.psyneuview/sources/PsyNeuLink-someone-else",
  }));
  await openDeveloper(page);
  const listbox = await openList(page);
  for (const h of await listbox.getByTestId("pnl-switch-group-heading").all()) {
    await expect(h).toHaveAttribute("aria-expanded", "false");
  }
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await expect(listbox.getByRole("option", { name: "Another local checkout…" })).toBeFocused();
  await expect(listbox.getByText("in use")).toHaveCount(0);
  await expect(page.getByText(`✓ In use now: GitHub · someone-else/PsyNeuLink @ feature/x (abcdef0)`)).toBeVisible();
});
