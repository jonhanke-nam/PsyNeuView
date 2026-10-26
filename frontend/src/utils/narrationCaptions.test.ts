/**
 * What narration reads, checked over every walkthrough without the app (#87).
 *
 * Narration reads each step's caption (`say:`), not its instruction. These
 * checks keep the two lined up and keep the caption speakable:
 *
 * - every step has a caption, so narration never falls back to reading an
 *   instruction full of control names;
 * - a caption has no code names (backticks, snake_case, calls), which a voice
 *   reads as noise and the review book already warns about;
 * - a label a caption quotes ("Run", "Fit") is one the instruction names too,
 *   so what is heard points at something on screen;
 * - respelling changes only how a word sounds: undo every respelling and the
 *   caption on screen comes back exactly.
 */
import { describe, expect, it } from "vitest";

import { WALKTHROUGHS } from "./tourStep";
import { PRONUNCIATIONS, spokenText } from "./pronunciation";

const steps = Object.values(WALKTHROUGHS).flatMap((w) => w.steps.map((step) => ({ w: w.id, step })));

describe("walkthrough captions (#87)", () => {
  it("sees every walkthrough", () => {
    expect(steps.length).toBeGreaterThan(150);
  });

  it("every step has a caption", () => {
    const missing = steps.filter(({ step }) => !step.say?.trim()).map(({ w, step }) => `${w}/${step.id}`);
    expect(missing, `Add a say: line to these steps:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no caption speaks a code name", () => {
    const codey = /`|\b[a-z]+_[a-z0-9_]+\b|\w\(\)|\.py\b/;
    const bad = steps
      .filter(({ step }) => step.say && codey.test(step.say))
      .map(({ w, step }) => `${w}/${step.id}: ${step.say}`);
    expect(bad, `Say what these are, not their code names (the instruction can keep the name):\n${bad.join("\n")}`).toEqual([]);
  });

  it("a label a caption quotes is named in the instruction too", () => {
    const bad: string[] = [];
    for (const { w, step } of steps) {
      for (const [, label] of (step.say ?? "").matchAll(/["“]([^"”]+)["”]/g)) {
        if (!step.instruct.toLowerCase().includes(label.toLowerCase())) bad.push(`${w}/${step.id}: "${label}"`);
      }
    }
    expect(bad, `The caption quotes a label the instruction doesn't name:\n${bad.join("\n")}`).toEqual([]);
  });
});

describe("respellings change only the sound (#87)", () => {
  it("each respelling differs from its word and is plain speech", () => {
    const bad = PRONUNCIATIONS.words.filter((p) => p.say === p.word || /[`_()]/.test(p.say)).map((p) => p.word);
    expect(bad).toEqual([]);
  });

  it("undoing every respelling gives back the caption on screen", () => {
    // Longest respelling first, mirroring how spokenText applies them.
    const back = [...PRONUNCIATIONS.words].sort((a, b) => b.say.length - a.say.length);
    const bad: string[] = [];
    for (const { w, step } of steps) {
      if (!step.say) continue;
      const restored = back.reduce((out, p) => out.split(p.say).join(p.word), spokenText(step.say));
      if (restored !== step.say) bad.push(`${w}/${step.id}`);
    }
    expect(bad, `Respelling changed more than sound in:\n${bad.join("\n")}`).toEqual([]);
  });
});
