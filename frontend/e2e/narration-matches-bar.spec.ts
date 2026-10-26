/**
 * Narration says what the bar shows (#87).
 *
 * With narration on, each step's voice should read the caption on screen —
 * respelt for the voice, nothing else — and that caption should be visible,
 * marked as the line being read (#86), and wide enough to read (#84: in 0.6.3
 * the bar squeezed it into a column a word wide, so what was heard seemed to
 * match nothing on screen).
 *
 * The browser's voice is replaced by a recorder, so the test hears exactly
 * what a learner would.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { mutatingTest as test, expect } from "./test-base";
import { loadWalkthrough, runWalkthrough } from "./tourDriver";

const NARRATION_KEY = "psyneuview.tour.narration";

const PRONUNCIATIONS = (yaml.load(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/walkthroughs/pronunciations.yaml"), "utf8"),
) as { words?: { word: string; say: string }[] }).words ?? [];

/** The caption as the voice should get it: the same respelling the app applies. */
function respelt(text: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...PRONUNCIATIONS]
    .sort((a, b) => b.word.length - a.word.length)
    .reduce((out, w) => out.replace(new RegExp(`(?<![\\w-])${esc(w.word)}(?![\\w-])`, "g"), w.say), text);
}

test.describe("Narration matches the bar", { tag: "@ci" }, () => {
  test("every step reads its visible caption, marked and readable", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1000, height: 670 });
    await page.addInitScript((key) => {
      localStorage.setItem(key, "on");
      const spoken: string[] = [];
      (window as unknown as { __spoken: string[] }).__spoken = spoken;
      const engine = {
        speaking: false,
        speak: (u: SpeechSynthesisUtterance) => spoken.push(u.text),
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      Object.defineProperty(window, "speechSynthesis", { value: engine, configurable: true });
    }, NARRATION_KEY);

    const part = loadWalkthrough("orientation-window");
    await page.goto(`/?tour=${part.id}`);
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

    await runWalkthrough(page, part, async (step) => {
      const caption = page.getByTestId("tour-caption");
      await expect(caption).toHaveText(step.say ?? "");
      await expect(page.getByTestId("tour-caption-speaker")).toBeVisible();

      // The voice got this step's caption, respelt.
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1)), {
          message: `step "${step.id}" should be read aloud`,
        })
        .toBe(respelt(step.say ?? ""));

      // Readable: inside the bar, and not squeezed into a narrow column.
      const box = await page.getByTestId("tour-caption-line").boundingBox();
      const bar = await page.getByTestId("tour-bar").boundingBox();
      expect(box && bar, "caption and bar are on screen").toBeTruthy();
      expect(box!.width, `step "${step.id}" caption is wide enough to read`).toBeGreaterThan(Math.min(400, bar!.width * 0.5));
      expect(box!.y).toBeGreaterThanOrEqual(bar!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + bar!.height + 1);
    });
  });
});
