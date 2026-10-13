/**
 * The palette and the button kinds, as the browser draws them (#1302).
 *
 * docs/ui-style-conventions.md: a primary button is the palette's blue, a
 * secondary one outlined on white, a small one row-sized on the muted
 * surface, a danger one red, and the × the muted text colour at its own
 * size. src/styleConventions.test.ts holds the source to the tokens; this
 * opens Settings and a few dialogs and reads the computed styles back,
 * against the values in styles/palette.css itself, so a token that changed
 * or a kind that stopped reading one shows up here.
 *
 * And the Close rule: Settings' only way out is closing, so Close is the
 * default button and Return closes it — but not from a text field, and not
 * while a dialog is open on top.
 */
import { mutatingTest, readOnlyTest, expect } from "./test-base";
import { readFileSync, mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

type Locator = import("@playwright/test").Locator;

/** The palette, as `--pnv-name` → `rgb(r, g, b)`, the way getComputedStyle reports a colour. */
const PALETTE: Record<string, string> = (() => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles/palette.css", import.meta.url)), "utf8");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/^\s*(--pnv-[a-z0-9-]+)\s*:\s*([^;]+);/gm)) out[m[1]] = toRgb(m[2].trim());
  return out;
})();

function toRgb(value: string): string {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return value;
  let h = hex[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const token = (name: string) => {
  const v = PALETTE[name];
  if (!v) throw new Error(`palette.css has no ${name}`);
  return v;
};

async function computed(el: Locator) {
  return el.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      background: s.backgroundColor,
      color: s.color,
      border: s.borderTopColor,
      fontSize: s.fontSize,
      width: s.width,
      height: s.height,
    };
  });
}

async function expectPrimary(el: Locator) {
  const s = await computed(el);
  expect(s.background).toBe(token("--pnv-primary"));
  expect(s.color).toBe(token("--pnv-on-primary"));
  expect(s.fontSize).toBe("13px");
}

async function expectPrimaryDisabled(el: Locator) {
  const s = await computed(el);
  expect(s.background).toBe(token("--pnv-disabled-bg"));
  expect(s.color).toBe(token("--pnv-text-hint"));
}

async function expectSecondary(el: Locator) {
  const s = await computed(el);
  expect(s.background).toBe(token("--pnv-surface"));
  expect(s.border).toBe(token("--pnv-border"));
  expect(s.color).toBe(token("--pnv-text-secondary"));
  expect(s.fontSize).toBe("13px");
}

async function expectSmall(el: Locator) {
  const s = await computed(el);
  expect(s.background).toBe(token("--pnv-surface-muted"));
  expect(s.border).toBe(token("--pnv-border-light"));
  expect(s.color).toBe(token("--pnv-text-secondary"));
  expect(s.fontSize).toBe("11px");
}

async function expectDanger(el: Locator) {
  const s = await computed(el);
  expect(s.color).toBe(token("--pnv-danger"));
  expect(s.border).toBe(token("--pnv-danger"));
  expect(s.fontSize).toBe("11px");
}

/** The full-size × of a dialog: the muted text colour, 28px square. */
async function expectDialogClose(el: Locator) {
  const s = await computed(el);
  expect(s.color).toBe(token("--pnv-text-muted"));
  expect(s.width).toBe("28px");
  expect(s.height).toBe("28px");
}

mutatingTest("Settings: Close is primary and the default button; small and danger row actions", async ({ page }) => {
  // A project folder that is not fixed, so Folders offers Move…; and two
  // managed copies, one removable, as where-things-live.spec.ts stubs them.
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "style1302-"));
  const src = path.join(root, "models");
  mkdirSync(src, { recursive: true });
  const cleared = await (await page.request.post("/api/test/models-dir", { data: { path: null } })).json();
  await page.route("**/api/locations", (r) =>
    r.fulfill({
      json: {
        psyneuview: { path: "/Users/someone/code/PsyNeuView", kind: "checkout", editable: true, version: "0.5.9", commit: "abc1234" },
        psyneulink: {
          version: "0.19.1.0", source: "github", branch: "devel", repo: "PrincetonUniversity/PsyNeuLink", commit: "72dde34",
          path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity", editable: false, managed: true,
        },
        projectFolder: { path: src, exists: true, fixed: false, fixedBy: null },
        catalogs: [],
        appData: { root: "/Users/someone/.psyneuview", sources: "/Users/someone/.psyneuview/sources", configFile: "/Users/someone/.psynewview.json" },
        managedCopies: [
          { name: "PsyNeuLink-PrincetonUniversity", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-PrincetonUniversity", repo: "PrincetonUniversity/PsyNeuLink", size_bytes: 412_000_000, size_complete: true, last_used: Date.now() / 1000 - 86400, in_use: true },
          { name: "PsyNeuLink-jonhanke-nam", path: "/Users/someone/.psyneuview/sources/PsyNeuLink-jonhanke-nam", repo: "jonhanke-nam/PsyNeuLink", size_bytes: 398_000_000, size_complete: false, last_used: Date.now() / 1000 - 40 * 86400, in_use: false },
        ],
        checkouts: [],
      },
    }),
  );
  try {
    expect((await page.request.post("/api/catalogs/project-folder", { data: { path: src } })).ok()).toBe(true);
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    const settings = page.getByTestId("settings-panel");
    await expect(settings).toBeVisible();

    // The Close rule: Close is primary, the × is the one ×.
    const close = page.getByTestId("settings-close");
    await expectPrimary(close);
    await expect(close).toHaveAttribute("data-default-button", "true");
    await expectDialogClose(settings.getByTestId("dialog-close"));

    // About: Download diagnostics is a row action.
    await page.getByTestId("settings-section-about").click();
    await expectSmall(page.getByTestId("download-diagnostics"));

    // Developer: every Remove is danger, the first press and the confirming one.
    await page.getByTestId("settings-section-developer").click();
    const group = page.getByTestId("settings-group-managed-copies");
    await group.getByRole("button", { name: "Managed PsyNeuLink copies and checkouts" }).click();
    const fork = group.locator('[data-testid="managed-copy"][data-name="PsyNeuLink-jonhanke-nam"]');
    await expectDanger(fork.getByTestId("managed-copy-remove"));
    await fork.getByTestId("managed-copy-remove").click();
    await expectDanger(fork.getByTestId("managed-copy-confirm-remove"));

    // Folders ▸ Move…: a real action, so Move is primary and Cancel secondary.
    await page.getByTestId("settings-section-folders").click();
    await expectSmall(page.getByTestId("project-folder-move"));
    await page.getByTestId("project-folder-move").click();
    const move = page.getByTestId("project-folder-move-dialog");
    await expect(move).toBeVisible();
    const confirm = page.getByTestId("project-folder-move-confirm");
    await expectPrimaryDisabled(confirm);
    await expectSecondary(move.getByRole("button", { name: "Cancel" }));
    await expectDialogClose(move.getByTestId("dialog-close"));
    await page.getByTestId("project-folder-move-to").fill(path.join(root, "elsewhere"));
    await expectPrimary(confirm);

    // Return in the path field is the field's; and with Move… open on top,
    // Return is not Settings' Close either.
    await page.getByTestId("project-folder-move-to").press("Enter");
    await expect(move).toBeVisible();
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(move).toHaveCount(0);
    await expect(settings).toBeVisible();

    // Now Return activates Close: Settings closes.
    await page.keyboard.press("Enter");
    await expect(settings).toHaveCount(0);
  } finally {
    await page.request.post("/api/test/models-dir", { data: { path: cleared.previous } });
  }
});

readOnlyTest("the Open menu's dialogs: the action primary, Cancel secondary", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-new-model").click();
  const prompt = page.getByTestId("prompt-modal");
  await expect(prompt).toBeVisible();
  const ok = prompt.getByRole("button", { name: "OK" });
  await expectPrimaryDisabled(ok);
  await prompt.locator("input").fill("my_model");
  await expectPrimary(ok);
  await expectSecondary(prompt.getByRole("button", { name: "Cancel" }));
  await expectDialogClose(prompt.getByTestId("dialog-close"));
  await page.keyboard.press("Escape");

  await page.getByTestId("open-menu").click();
  await page.getByTestId("open-menu-open-from-path").click();
  const browser = page.getByTestId("file-browser-modal");
  await expect(browser).toBeVisible();
  await expectPrimaryDisabled(browser.getByRole("button", { name: "Open", exact: true }));
  await expectSecondary(browser.getByRole("button", { name: "Cancel" }));
  await expectDialogClose(browser.getByTestId("dialog-close"));
});
