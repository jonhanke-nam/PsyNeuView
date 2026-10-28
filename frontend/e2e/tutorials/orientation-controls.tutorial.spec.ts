/**
 * The orientation's front door and the walkthrough bar's controls (#1310).
 *
 *  - The first-launch offer: made once; Maybe later leaves a reminder in the
 *    Tutorials menu that starts part 1; No thanks is remembered. The harness
 *    answers the offer for every other spec, so this one clears that answer.
 *  - The Tutorials menu lists PsyNeuView First Steps first, parts 1–8 in
 *    order, each with its length.
 *  - The bar: Pause holds a finished step, Resume lets it go; Replay sends the
 *    pointer again; Skip moves on without the step being done; the narration
 *    toggle is remembered and, when on, hands each caption to the browser's
 *    speech (stubbed: nothing is heard, the call is what's asserted).
 */
import type { Page } from "@playwright/test";
import { readOnlyTest as test, expect, ORIENTATION_OFFER_KEY } from "../test-base";
import { loadWalkthrough } from "../tourDriver";
import path from "path";

const NARRATION_KEY = "psyneuview.tour.narration";
const window1 = loadWalkthrough("orientation-window");

test.use({ viewport: { width: 1600, height: 1000 } });

async function shot(page: Page, name: string) {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: path.join(process.env.SHOTS_DIR, `${name}.png`) });
}

/** A speechSynthesis that records what it was asked to say. */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class Utterance {
      text: string;
      rate = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: Utterance) => spoken.push(u.text),
        cancel: () => {},
        pause: () => {},
        resume: () => {},
      },
      configurable: true,
    });
  });
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test.describe("The first-launch offer", () => {
  test.beforeEach(async ({ page }) => {
    // A person's first launch: nothing remembered. Runs after the fixture's
    // seed — and on every navigation, so only once per tab: a reload must
    // keep the answer the test gave, as a real second launch would.
    await page.addInitScript((key) => {
      if (sessionStorage.getItem("offer-cleared")) return;
      sessionStorage.setItem("offer-cleared", "1");
      localStorage.removeItem(key);
    }, ORIENTATION_OFFER_KEY);
  });

  test("is made once; Maybe later leaves a reminder in the Tutorials menu that starts part 1", async ({ page }) => {
    await page.goto("/");
    const offer = page.getByTestId("orientation-offer");
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect(offer).toContainText("PsyNeuView First Steps");
    await expect(offer).toContainText("8 short walkthroughs");
    await shot(page, "first-launch-offer");

    await page.getByTestId("orientation-offer-later").click();
    await expect(offer).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), ORIENTATION_OFFER_KEY)).toBe("later");

    // Not again on the next launch...
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("orientation-offer")).toHaveCount(0);

    // ...but the menu remembers, and the reminder starts part 1.
    await expect(page.getByTestId("walkthrough-menu")).toHaveAttribute("data-reminder", "true");
    await page.getByTestId("walkthrough-menu").click();
    await expect(page.getByTestId("walkthrough-offer-reminder")).toBeVisible();
    await page.getByTestId("walkthrough-offer-reminder-start").click();
    await expect(page.getByTestId("tour-bar")).toBeVisible();
    await expect(page.getByTestId("tour-bar")).toContainText(window1.title);
    expect(await page.evaluate((k) => localStorage.getItem(k), ORIENTATION_OFFER_KEY)).toBe("started");
    await page.getByTestId("tour-dismiss").click();
    await page.getByTestId("walkthrough-menu").click();
    await expect(page.getByTestId("walkthrough-offer-reminder")).toHaveCount(0);
  });

  test("No thanks is remembered; the walkthroughs stay in the menu", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("orientation-offer-never").click({ timeout: 10_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), ORIENTATION_OFFER_KEY)).toBe("never");
    await page.reload();
    await expect(page.getByTestId("app-toolbar")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("orientation-offer")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-menu")).not.toHaveAttribute("data-reminder", "true");
    await page.getByTestId("walkthrough-menu").click();
    await expect(page.getByTestId("walkthrough-group-orientation")).toBeVisible();
  });

  test("is not made over a walkthrough that was linked to", async ({ page }) => {
    await page.goto("/?tour=orientation-settings");
    await expect(page.getByTestId("tour-bar")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("orientation-offer")).toHaveCount(0);
  });
});

test.describe("The Tutorials menu", () => {
  test("lists PsyNeuView First Steps first, parts 1 to 8 in order, with their lengths", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("walkthrough-menu").click();
    const list = page.getByTestId("walkthrough-menu-list");
    const groupIds = await list
      .locator('[data-testid^="walkthrough-group-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(groupIds).toEqual([
      "walkthrough-group-orientation", "walkthrough-group-general", "walkthrough-group-psyneulink", "walkthrough-group-course",
    ]);

    const group = list.getByTestId("walkthrough-group-orientation");
    await expect(group).toContainText("PsyNeuView First Steps");
    const ids = await group
      .locator('[data-testid^="walkthrough-orientation-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("walkthrough-", "")));
    expect(ids).toEqual([
      "orientation-window", "orientation-open", "orientation-editing", "orientation-saving",
      "orientation-psyneulink", "orientation-running", "orientation-settings", "orientation-developers",
    ]);
    await expect(group.getByTestId("walkthrough-orientation-window")).toContainText("1. ");
    await expect(group.getByTestId("walkthrough-orientation-window")).toContainText("~3 min");
    await expect(group.getByTestId("walkthrough-orientation-developers")).toContainText("8. ");
    await shot(page, "tutorials-menu-group");
  });
});

test.describe("The walkthrough bar's controls", () => {
  test("Pause holds a finished step; Resume lets it advance; Skip moves on; Replay sends the pointer again", async ({ page }) => {
    // Part 7 is all in Settings, which needs no model: quick to start.
    const part = loadWalkthrough("orientation-settings");
    // The arrow is a setting, off by default (#100); this checks it when on.
    await page.addInitScript(() => localStorage.setItem("psyneuview.tour.showArrow", "on"));
    await page.goto(`/?tour=${part.id}`);
    const instruction = page.getByTestId("tour-instruction");
    await expect(instruction).toHaveText(part.steps[0].instruct, { timeout: 15_000 });
    await shot(page, "tour-bar-controls");

    // Pause, then do the step: it is marked done and stays there.
    await page.getByTestId("tour-pause").click();
    await expect(page.getByTestId("tour-pause")).toHaveText("Resume");
    await expect(page.getByTestId("tour-bar")).toHaveAttribute("data-paused", "true");
    await page.getByTestId("settings-button").click();
    await expect(instruction).toHaveText("✓ Done.");
    await page.waitForTimeout(2000);
    await expect(instruction).toHaveText("✓ Done.");
    await expect(page.getByTestId("tour-bar")).toContainText("step 1 of");

    // Resume: it moves on.
    await page.getByTestId("tour-pause").click();
    await expect(instruction).toHaveText(part.steps[1].instruct, { timeout: 5_000 });
    await expect(page.getByTestId("tour-bar")).toContainText("step 2 of");

    // Skip: on to step 3 without clicking General.
    await page.getByTestId("tour-skip").click();
    await expect(instruction).toHaveText(part.steps[2].instruct);
    await expect(page.getByTestId("settings-content-general")).toHaveCount(0);

    // Replay on a pointer step: the pointer glides again, and the words come back.
    const pointerStep = part.steps.findIndex((s) => s.pointer);
    expect(pointerStep, "part 7 has a pointer step").toBeGreaterThan(2);
    for (let i = 2; i < pointerStep; i++) await page.getByTestId("tour-skip").click();
    await expect(instruction).toHaveText(part.steps[pointerStep].instruct, { timeout: 5_000 });
    await expect(page.getByTestId("tour-pointer")).toBeVisible();
    await page.getByTestId("tour-replay").click();
    await expect(instruction).toHaveText("…");
    await expect(page.getByTestId("tour-pointer")).toHaveAttribute("data-gliding", "true");
    await expect(instruction).toHaveText(part.steps[pointerStep].instruct, { timeout: 5_000 });

    await page.getByTestId("tour-dismiss").click();
    await expect(page.getByTestId("tour-bar")).toHaveCount(0);
  });

  test("narration is off by default, remembered when turned on, and hands each caption to speech", async ({ page }) => {
    await stubSpeech(page);
    const part = loadWalkthrough("orientation-settings");
    await page.goto(`/?tour=${part.id}`);
    const toggle = page.getByTestId("tour-narration");
    await expect(toggle).toHaveText("🔇 Narration off");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("tour-caption")).toHaveText(part.steps[0].say!);
    expect(await spoken(page)).toEqual([]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((k) => localStorage.getItem(k), NARRATION_KEY)).toBe("on");
    await expect.poll(() => spoken(page)).toEqual([part.steps[0].say]);

    // The next step's caption is read as it shows.
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("tour-instruction")).toHaveText(part.steps[1].instruct, { timeout: 5_000 });
    // Spoken with pronunciations.yaml's respellings (#1407); the caption on screen keeps the real word.
    const said = (text: string) => text.replace(/PsyNeuLink/g, "Sigh-new-link");
    await expect.poll(() => spoken(page)).toEqual([said(part.steps[0].say!), said(part.steps[1].say!)]);

    // Remembered: the next walkthrough starts with narration on.
    await page.reload();
    await expect(page.getByTestId("tour-narration")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => spoken(page)).toEqual([part.steps[0].say]);

    await page.getByTestId("tour-narration").click();
    expect(await page.evaluate((k) => localStorage.getItem(k), NARRATION_KEY)).toBe("off");
  });

  test("without speech in the browser, the toggle is there but disabled", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
    });
    await page.goto("/?tour=orientation-settings");
    await expect(page.getByTestId("tour-narration")).toBeDisabled();
    await expect(page.getByTestId("tour-caption")).toBeVisible();
  });
});
