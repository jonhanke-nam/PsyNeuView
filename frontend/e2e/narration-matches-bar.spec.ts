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
import type { Page } from "@playwright/test";
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

/** Narration on, and the browser's voice replaced by a recorder of every call. */
async function recordVoice(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "on");
    const spoken: string[] = [];
    const calls: string[] = [];
    (window as unknown as { __spoken: string[]; __calls: string[] }).__spoken = spoken;
    (window as unknown as { __calls: string[] }).__calls = calls;
    const engine = {
      speaking: false,
      speak: (u: SpeechSynthesisUtterance) => {
        spoken.push(u.text);
        calls.push(`speak:${u.text}`);
        // The voice starts at once and finishes when the test says so.
        u.onstart?.(new Event("start") as SpeechSynthesisEvent);
        (window as unknown as { __finish: () => void }).__finish = () => u.onend?.(new Event("end") as SpeechSynthesisEvent);
      },
      cancel: () => calls.push("cancel"),
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: engine, configurable: true });
  }, NARRATION_KEY);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls.slice());

test.describe("Narration matches the bar", { tag: "@ci" }, () => {
  test("every step reads its visible caption, marked and readable", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1000, height: 670 });
    await recordVoice(page);

    const part = loadWalkthrough("orientation-window");
    await page.goto(`/?tour=${part.id}`);
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

    await runWalkthrough(page, part, async (step) => {
      const caption = page.getByTestId("tour-caption");
      await expect(caption).toHaveText(step.say ?? "");
      await expect(page.getByTestId("tour-caption-label")).toHaveText(/^Narration( \(.+\))?:$/);

      // The voice got this step's caption, respelt.
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1)), {
          message: `step "${step.id}" should be read aloud`,
        })
        .toBe(respelt(step.say ?? ""));

      // The caption leads (#86): above the instruction, which is the details line.
      const line = page.getByTestId("tour-caption-line");
      const lineBox = await line.boundingBox();
      const instrBox = await page.getByTestId("tour-instruction").boundingBox();
      expect(lineBox!.y, `step "${step.id}" caption sits above the instruction`).toBeLessThan(instrBox!.y);
      await expect(page.getByTestId("tour-instruction")).toHaveAttribute("data-role", "details");

      // Lit while the voice reads it, and not once it has finished.
      await expect(line).toHaveAttribute("data-speaking", "true");
      await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
      await expect(line).toHaveAttribute("data-speaking", "false");

      // Readable: inside the bar, and not squeezed into a narrow column.
      const box = await page.getByTestId("tour-caption-line").boundingBox();
      const bar = await page.getByTestId("tour-bar").boundingBox();
      expect(box && bar, "caption and bar are on screen").toBeTruthy();
      expect(box!.width, `step "${step.id}" caption is wide enough to read`).toBeGreaterThan(Math.min(400, bar!.width * 0.5));
      expect(box!.y).toBeGreaterThanOrEqual(bar!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + bar!.height + 1);
    });
  });

  test("the voice stops with the step, pauses with Pause, repeats on Replay and ends with End", async ({ page }) => {
    await recordVoice(page);
    const part = loadWalkthrough("orientation-window");
    const [first, second] = part.steps;
    await page.goto(`/?tour=${part.id}`);
    await expect(page.getByTestId("tour-caption")).toHaveText(first.say ?? "", { timeout: 30_000 });
    const firstSaid = `speak:${respelt(first.say ?? "")}`;
    await expect.poll(async () => (await calls(page)).filter((c) => c === firstSaid).length).toBe(1);

    // Pause pauses the voice, and pressing it again resumes it.
    await page.getByTestId("tour-pause").click();
    await expect.poll(async () => (await calls(page)).at(-1)).toBe("pause");
    await page.getByTestId("tour-pause").click();
    await expect.poll(async () => (await calls(page)).at(-1)).toBe("resume");

    // Replay says the same line again.
    await page.getByTestId("tour-replay").click();
    await expect.poll(async () => (await calls(page)).filter((c) => c === firstSaid).length).toBe(2);

    // Next: the old line is cut off before the new one starts, and not said again.
    const before = (await calls(page)).length;
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-caption")).toHaveText(second.say ?? "", { timeout: 15_000 });
    const secondSaid = `speak:${respelt(second.say ?? "")}`;
    await expect.poll(async () => (await calls(page)).slice(before)).toContain(secondSaid);
    const afterNext = (await calls(page)).slice(before);
    expect(afterNext.slice(0, afterNext.indexOf(secondSaid))).toContain("cancel");
    expect(afterNext).not.toContain(firstSaid);

    // End: the voice is cut off and nothing more is said.
    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
    const atEnd = await calls(page);
    expect(atEnd.at(-1)).toBe("cancel");
    await page.waitForTimeout(500);
    expect((await calls(page)).length).toBe(atEnd.length);
  });
});
