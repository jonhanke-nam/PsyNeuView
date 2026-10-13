import { describe, expect, it } from "vitest";

import { WALKTHROUGHS } from "./tourStep";
import { PRONUNCIATIONS, parsePronunciations, spokenText, trickyWords, undecidedWords } from "./pronunciation";

const dict = parsePronunciations(`
words:
  - word: EGO
    say: Ego
  - word: PsyNeuLink
    say: Sigh-new-link
  - word: ISC-CI
    say: I S C, C I
reads_fine: [CONTEXT]
`);

describe("spokenText (#1407)", () => {
  it("respells whole words only, and keeps a possessive", () => {
    expect(spokenText("This is EGO's working memory.", dict)).toBe("This is Ego's working memory.");
    expect(spokenText("EGOS and LEGO stay.", dict)).toBe("EGOS and LEGO stay.");
    expect(spokenText("Open PsyNeuLink, then ISC-CI.", dict)).toBe("Open Sigh-new-link, then I S C, C I.");
  });

  it("is case-sensitive", () => {
    expect(spokenText("the ego", dict)).toBe("the ego");
  });
});

describe("trickyWords", () => {
  it("finds capitals, hyphenated and joined-up names", () => {
    expect(trickyWords("Select CONTEXT in EGO via ISC-CI, FIELD_MEMORY, PsyNeuLink and ReLU. A word.")).toEqual([
      "CONTEXT", "EGO", "ISC-CI", "FIELD_MEMORY", "PsyNeuLink", "ReLU",
    ]);
  });

  it("names the ones with no decision", () => {
    expect(undecidedWords("CONTEXT, EGO and DDM", dict)).toEqual(["DDM"]);
  });
});

// What narration reads: the caption, or the instruction when there is none (TourBar's captionOf).
describe("every walkthrough caption has a decision for its tricky words", () => {
  it("is in pronunciations.yaml, as a respelling or under reads_fine", () => {
    const undecided: string[] = [];
    for (const w of Object.values(WALKTHROUGHS)) {
      for (const step of w.steps) {
        for (const word of undecidedWords(step.say ?? step.instruct, PRONUNCIATIONS)) {
          undecided.push(`${w.id}/${step.id}: ${word}`);
        }
      }
    }
    expect(
      undecided,
      `Add these to frontend/src/walkthroughs/pronunciations.yaml — a respelling under words, or reads_fine if a voice says it right:\n${undecided.join("\n")}`,
    ).toEqual([]);
  });
});
