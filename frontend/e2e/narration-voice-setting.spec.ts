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
    // These specs test the computer's own voice; the default is recorded (#159).
    if (localStorage.getItem("psyneuview.tour.narrationVoice") === null) localStorage.setItem("psyneuview.tour.narrationVoice", "system:automatic");
    // and a system voice they choose is not moved to Heart (the one-time move, #159).
    localStorage.setItem("psyneuview.tour.narrationVoiceRecordedDefault", "done");
    const spoken: { text: string; voice: string | null }[] = [];
    const rates: number[] = [];
    (window as unknown as { __spoken: typeof spoken; __rates: number[] }).__spoken = spoken;
    (window as unknown as { __rates: number[] }).__rates = rates;
    const w = window as unknown as { __cancels: number };
    w.__cancels = 0;
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
        cancel: () => {
          w.__cancels += 1;
        },
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

const cancels = (page: Page) => page.evaluate(() => (window as unknown as { __cancels: number }).__cancels);

async function openNarrationSettings(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.getByTestId("settings-section-tutorials-voice").click();
  await expect(page.getByTestId("settings-group-voice")).toBeVisible();
}

test.describe("Narration voice setting", { tag: "@ci" }, () => {
  test("closing Settings stops a sample still being read, and only a sample", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");

    // Opening and closing without a sample leaves speech alone, so a
    // walkthrough's narration carries on.
    await openNarrationSettings(page);
    const before = await cancels(page);
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
    expect(await cancels(page)).toBe(before);

    await openNarrationSettings(page);
    await page.getByTestId("narration-voice-sample").click();
    await expect.poll(() => spoken(page).then((s) => s.length)).toBe(1);
    const playing = await cancels(page);
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
    expect(await cancels(page)).toBeGreaterThan(playing);
  });

  test("lists the real voices, plays a sample in the chosen one, and remembers it", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");
    await openNarrationSettings(page);

    const select = page.getByTestId("setting-narration-voice");
    const labels = await select.locator("option").allTextContents();
    expect(labels.slice(0, 3)).toEqual([
      "Heart · American (default)",
      "Michael · American",
      "Automatic — best available (now: Karen (Premium))",
    ]);
    expect(labels.slice(3)).toEqual([
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

    // Automatic is kept as a choice; Heart, the default, clears it.
    await select.selectOption("system:automatic");
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBe("system:automatic");
    await select.selectOption("recorded:heart");
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBeNull();
  });

  test("a system voice chosen before the recorded voices gives way to Heart, once (#159)", async ({ page }) => {
    // Updating from 0.6.9: Karen was chosen, and nothing has moved it yet.
    await page.addInitScript((k) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(k, "com.apple.voice.premium.en-AU.Karen");
        sessionStorage.setItem("seeded", "1");
      }
    }, VOICE_KEY);
    await page.goto("/");
    await openNarrationSettings(page);
    await expect(page.getByTestId("setting-narration-voice")).toHaveValue("recorded:heart");
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBeNull();

    // Karen chosen again is kept from now on.
    await page.getByTestId("setting-narration-voice").selectOption("system:automatic");
    await page.reload();
    await openNarrationSettings(page);
    await expect(page.getByTestId("setting-narration-voice")).toHaveValue("system:automatic");
  });

  test("a recorded voice is the default, and plays the caption's clip (#159)", async ({ page }) => {
    await stubSpeech(page);
    // As a new user: nothing chosen.
    await page.addInitScript((k) => localStorage.removeItem(k), VOICE_KEY);
    const clips: string[] = [];
    await page.route("**/narration/**", (route) => {
      clips.push(new URL(route.request().url()).pathname);
      return route.continue();
    });
    await page.goto("/");
    await openNarrationSettings(page);
    const select = page.getByTestId("setting-narration-voice");
    await expect(select).toHaveValue("recorded:heart");
    await expect(page.getByTestId("narration-voice-help")).toHaveCount(0);
    await page.getByTestId("narration-voice-sample").click();
    await expect.poll(() => clips).toEqual([expect.stringMatching(/^\/narration\/heart\/[0-9a-f]{14}\.m4a$/)]);
    // The clip is there, so the computer's voice is not used.
    const status = await page.evaluate((url) => fetch(url).then((r) => r.status), clips[0]);
    expect(status).toBe(200);
    expect(await spoken(page)).toEqual([]);

    await select.selectOption("recorded:michael");
    expect(await page.evaluate((k) => localStorage.getItem(k), VOICE_KEY)).toBe("recorded:michael");
    await page.getByTestId("narration-voice-sample").click();
    await expect.poll(() => clips.at(-1)).toMatch(/^\/narration\/michael\//);
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
