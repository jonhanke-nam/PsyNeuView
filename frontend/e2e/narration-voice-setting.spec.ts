/**
 * Settings ▸ Tutorials and Voice (#1404, #1407): the narration voice, the
 * speaking rate, and the First Steps reminder.
 *
 * The browser's voices are stubbed: a Mac's usual mix (a novelty voice, the
 * standard ones, one downloaded Premium voice). The list must leave out the
 * novelty voice and name what Automatic uses; a chosen voice reads the
 * sample, is remembered, and reads a walkthrough's captions.
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect } from "./test-base";
import { loadWalkthrough } from "./tourDriver";

const NARRATION_KEY = "psyneuview.tour.narration";
const VOICE_KEY = "psyneuview.tour.narrationVoice";
const RATE_KEY = "psyneuview.tour.narrationRate";
const OFFER_KEY = "psyneuview.orientation.offer";
const DANIEL = "com.apple.voice.compact.en-GB.Daniel";

/** A speechSynthesis with a fixed set of voices that records what it read, and in which voice. */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: { text: string; voice: string | null }[] = [];
    const rates: number[] = [];
    (window as unknown as { __spoken: typeof spoken; __rates: number[] }).__spoken = spoken;
    (window as unknown as { __rates: number[] }).__rates = rates;
    const voice = (name: string, lang: string, quality = "compact") => ({
      name,
      lang,
      voiceURI: `com.apple.voice.${quality}.${lang}.${name.replace(/ \(.*\)$/, "")}`,
      localService: true,
      default: false,
    });
    const voices = [
      voice("Bubbles", "en-US"),
      voice("Samantha", "en-US"),
      voice("Daniel", "en-GB"),
      voice("Karen", "en-AU"),
      voice("Karen (Premium)", "en-AU", "premium"),
      voice("Amélie", "fr-CA"),
    ];
    class Utterance {
      text: string;
      rate = 1;
      lang = "";
      voice: { name: string } | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: Utterance) => {
          spoken.push({ text: u.text, voice: u.voice?.name ?? null });
          rates.push(u.rate);
        },
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        getVoices: () => voices,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      configurable: true,
    });
  });
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: { text: string; voice: string | null }[] }).__spoken);

async function openNarrationSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-tutorials-voice").click();
  await expect(page.getByTestId("settings-group-voice")).toBeVisible();
}

test.describe("Narration voice setting", { tag: "@ci" }, () => {
  test("lists the real voices, plays a sample in the chosen one, and remembers it", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");
    await openNarrationSettings(page);

    const select = page.getByTestId("setting-narration-voice");
    const labels = await select.locator("option").allTextContents();
    expect(labels[0]).toBe("Automatic — best available (now: Karen (Premium))");
    expect(labels.slice(1)).toEqual([
      "Karen (Premium) · Australian",
      "Karen · Australian",
      "Daniel · British",
      "Samantha · American",
    ]);
    // Where to get more voices is right there (this browser reports Windows).
    await expect(page.getByTestId("narration-voice-help")).toContainText("Add voices");

    await select.selectOption(DANIEL);
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBe(DANIEL);
    await page.getByTestId("narration-voice-sample").click();
    await expect.poll(async () => (await spoken(page)).at(-1)?.voice).toBe("Daniel");

    // Back to Automatic clears the choice.
    await select.selectOption("");
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBeNull();
  });

  test("on a Mac, it says which Premium voices to download and links to Spoken Content", async ({ page }) => {
    await stubSpeech(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    });
    await page.goto("/");
    await openNarrationSettings(page);
    const help = page.getByTestId("narration-voice-help");
    await expect(help).toContainText("Manage Voices");
    await expect(help).toContainText("Karen (Premium)");
    await expect(page.getByTestId("narration-voice-open-system")).toHaveAttribute(
      "href",
      "x-apple.systempreferences:com.apple.Accessibility-Settings.extension?SpokenContent",
    );
  });

  test("the speaking rate is remembered and used by the sample", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");
    await openNarrationSettings(page);
    const rate = page.getByTestId("setting-narration-rate");
    await expect(rate).toHaveValue("0.95");
    await rate.selectOption("1.25");
    expect(await page.evaluate((k) => localStorage.getItem(k), RATE_KEY)).toBe("1.25");
    await page.getByTestId("narration-voice-sample").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __rates: number[] }).__rates.at(-1))).toBe(1.25);
    // The default stores nothing.
    await rate.selectOption("0.95");
    expect(await page.evaluate((k) => localStorage.getItem(k), RATE_KEY)).toBeNull();
  });

  test("the First Steps reminder can be undone after Don't remind me", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, "never"), OFFER_KEY);
    await page.goto("/");
    await expect(page.getByTestId("walkthrough-menu")).not.toHaveAttribute("data-reminder", "true");
    await openNarrationSettings(page);
    const reminder = page.getByTestId("setting-orientation-reminder");
    await expect(reminder).toHaveValue("never");
    await reminder.selectOption("later");
    expect(await page.evaluate((k) => localStorage.getItem(k), OFFER_KEY)).toBe("later");
    await page.keyboard.press("Escape");
    await page.getByTestId("walkthrough-menu").click();
    await expect(page.getByTestId("walkthrough-menu")).toHaveAttribute("data-reminder", "true");
    // Offering again forgets the answer altogether.
    await page.keyboard.press("Escape");
    await openNarrationSettings(page);
    await page.getByTestId("setting-orientation-reminder").selectOption("ask");
    expect(await page.evaluate((k) => localStorage.getItem(k), OFFER_KEY)).toBeNull();
  });

  test("a walkthrough's captions are read in the chosen voice", async ({ page }) => {
    const part = loadWalkthrough("orientation-settings");
    await stubSpeech(page);
    await page.addInitScript(
      ([narration, voiceKey, uri]) => {
        localStorage.setItem(narration, "on");
        localStorage.setItem(voiceKey, uri);
      },
      [NARRATION_KEY, VOICE_KEY, DANIEL],
    );
    await page.goto(`/?tour=${part.id}`);
    await expect.poll(() => spoken(page)).toEqual([{ text: part.steps[0].say, voice: "Daniel" }]);
  });
});
