/**
 * LOCAL ONLY — the full two-headed loop with a real PyCharm.
 *
 * Not part of CI: it drives the actual IDE over AppleScript and needs PyCharm
 * installed, a macOS host, and Accessibility permission. CI has none of those.
 * `external-edit-sync.spec.ts` is the portable version that writes the file
 * with `fs`; this one exists to prove the same path works when the writer is a
 * genuine editor rather than a test.
 *
 * Run: npx playwright test e2e/pycharm-live.local.spec.ts
 */
import { readOnlyTest as test, expect } from "./test-base";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const PROBE_DIR =
  "/private/tmp/claude-503/-Users-jonhanke-Documents-Code-Repositories-psyneulink-repos/2deb0e54-5ecd-442d-999b-7b9cfd70b60c/scratchpad/probe";
const MODEL = path.join(PROBE_DIR, "model.py");

function osa(script: string) {
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
}

/** Type into PyCharm's editor and save, replacing the whole buffer. */
function pycharmReplaceAndSave(lines: string[]) {
  osa('tell application "PyCharm CE" to activate');
  const keystrokes = lines
    .map((l) => `    keystroke "${l.replace(/"/g, '\\"')}"\n    keystroke return`)
    .join("\n");
  osa(`tell application "System Events"
    keystroke "a" using {command down}
    delay 0.4
${keystrokes}
    delay 1.2
    keystroke "s" using {command down}
  end tell`);
}

const BASE = [
  "import psyneulink as pnl",
  "a = pnl.TransferMechanism(name='a')",
  "c = pnl.Composition(name='c')",
  "c.add_node(a)",
];

test("a real PyCharm save updates the PsyNeuView canvas", async ({ page }) => {
  test.setTimeout(300_000);

  // PyCharm owns this file throughout — we never write it from the test.
  pycharmReplaceAndSave(BASE);
  await expect
    .poll(() => readFileSync(MODEL, "utf8").includes("add_node(a)"), { timeout: 30_000 })
    .toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: /Open/ }).first().click();
  await page.getByRole("button", { name: "Open from path..." }).click();
  const prompt = page.locator('input[placeholder*="/path/to/model.py"]');
  await prompt.fill(MODEL);
  await prompt.press("Enter");
  await page.getByRole("button", { name: /^Skip$/ }).click({ timeout: 5000 }).catch(() => {});
  await expect(page.locator('.react-flow__node[data-id^="a"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.react-flow__node[data-id^="pycharm_mech"]')).toHaveCount(0);

  // The actual thing under test: a human-equivalent edit-and-save in the IDE.
  pycharmReplaceAndSave([
    ...BASE,
    "pycharm_mech = pnl.TransferMechanism(name='pycharm_mech')",
    "c.add_node(pycharm_mech)",
  ]);

  await expect(page.locator('.react-flow__node[data-id^="pycharm_mech"]')).toBeVisible({
    timeout: 90_000,
  });
});
