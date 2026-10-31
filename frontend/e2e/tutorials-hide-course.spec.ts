/**
 * Settings ▸ Tutorials and Voice ▸ Tutorials ▸ Hide the Cognitive
 * Neuroscience Course (#136).
 *
 * On by default, so the course's section is not in the Tutorials menu until
 * someone taking the course unticks the box. Unticking brings that one section
 * back, ticking takes it out again, each choice survives a reload, and a
 * course walkthrough opened by link still runs: hiding is about the menu only.
 */
import { readOnlyTest, mutatingTest, expect } from "./test-base";
import type { Page } from "@playwright/test";

const HIDE_COURSE_KEY = "psyneuview.tutorials.hideCourse";

async function openMenu(page: Page) {
  await page.getByTestId("walkthrough-menu").click();
  await expect(page.getByTestId("walkthrough-menu-list")).toBeVisible();
}

readOnlyTest.describe("Hide the Cognitive Neuroscience Course", { tag: "@ci" }, () => {
  readOnlyTest("the course is hidden by default, and the setting shows and hides it across reloads", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate((k) => localStorage.getItem(k), HIDE_COURSE_KEY)).toBeNull();
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-general")).toBeVisible();
    await expect(page.getByTestId("walkthrough-group-course")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Unticking shows the course, and the choice survives a reload.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-tutorials-voice").click();
    const box = page.getByTestId("setting-hide-course");
    await expect(box).toBeChecked();
    await box.uncheck();
    expect(await page.evaluate((k) => localStorage.getItem(k), HIDE_COURSE_KEY)).toBe("off");
    await page.keyboard.press("Escape");
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-course")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-course")).toBeVisible();
    await page.keyboard.press("Escape");

    // Ticking hides it again.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-tutorials-voice").click();
    await page.getByTestId("setting-hide-course").check();
    expect(await page.evaluate((k) => localStorage.getItem(k), HIDE_COURSE_KEY)).toBe("on");
    await page.keyboard.press("Escape");

    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-course")).toHaveCount(0);
    // Only the course goes; the other sections are as they were.
    await expect(page.getByTestId("walkthrough-group-orientation")).toBeVisible();
    await expect(page.getByTestId("walkthrough-group-general")).toBeVisible();
    await expect(page.getByTestId("walkthrough-group-psyneulink")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-general")).toBeVisible();
    await expect(page.getByTestId("walkthrough-group-course")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // And back: unticking brings the section back at once.
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-section-tutorials-voice").click();
    await expect(page.getByTestId("setting-hide-course")).toBeChecked();
    await page.getByTestId("setting-hide-course").uncheck();
    await page.keyboard.press("Escape");
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-course")).toBeVisible();
  });
});

mutatingTest.describe("Hide the Cognitive Neuroscience Course, by link", { tag: "@ci" }, () => {
  mutatingTest("a course walkthrough opened with ?tour= still runs while the course is hidden", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, "on"), HIDE_COURSE_KEY);
    await page.goto("/?tour=ddm");
    await expect(page.getByTestId("tour-instruction")).toBeVisible({ timeout: 30000 });
    await openMenu(page);
    await expect(page.getByTestId("walkthrough-group-course")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-stop")).toBeVisible();
  });
});
