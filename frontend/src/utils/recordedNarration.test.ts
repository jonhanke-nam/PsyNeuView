import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { narratedCaptions } from "./narratedCaptions";
import { SAMPLE_CAPTION } from "./narration";
import { DEFAULT_NARRATION_VOICE, RECORDED_VOICES, clipFile, clipUrl, recordedVoice, wordsHash } from "./recordedNarration";

// Recorded narration (#159): a clip for every caption, in every recorded voice.

const NARRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "narration");
const RENDER = "Run `npm run narration:render` in frontend/ (on a Mac; see docs/guided-walkthroughs.md).";

describe("clip names", () => {
  it("are a hash of the words said, the same every time", () => {
    expect(wordsHash(SAMPLE_CAPTION)).toBe("1f8048545a88ed");
    expect(clipFile(`  ${SAMPLE_CAPTION} `)).toBe("1f8048545a88ed.m4a");
    expect(wordsHash("a")).not.toBe(wordsHash("b"));
  });

  it("follow the respellings: a caption naming PsyNeuLink is said, and named, as respelt", () => {
    expect(clipFile("Open PsyNeuLink.")).not.toBe(`${wordsHash("Open PsyNeuLink.")}.m4a`);
  });

  it("live in the voice's folder", () => {
    expect(clipUrl(RECORDED_VOICES[0], SAMPLE_CAPTION)).toBe("/narration/heart/1f8048545a88ed.m4a");
  });
});

describe("recorded voices", () => {
  it("Heart is the default; a Settings value names a voice only when it is one", () => {
    expect(recordedVoice(DEFAULT_NARRATION_VOICE)?.name).toBe("Heart");
    expect(recordedVoice("recorded:michael")?.kokoro).toBe("am_michael");
    expect(recordedVoice("recorded:nobody")).toBeNull();
    expect(recordedVoice("com.apple.voice.compact.en-US.Samantha")).toBeNull();
    expect(recordedVoice(null)).toBeNull();
  });
});

describe("every caption has its clip, and every clip a caption", () => {
  const captions = narratedCaptions();

  it("has no caption without a clip", () => {
    const missing = RECORDED_VOICES.flatMap((v) =>
      captions.filter((c) => !existsSync(path.join(NARRATION, v.id, clipFile(c)))).map((c) => `${v.id}: ${c}`),
    );
    expect(missing, `Captions with no recorded clip. ${RENDER}\n${missing.join("\n")}`).toEqual([]);
  });

  it("has no clip left over from a caption that changed or went", () => {
    const stale = RECORDED_VOICES.flatMap((v) => {
      const wanted = new Set(captions.map(clipFile));
      const dir = path.join(NARRATION, v.id);
      return existsSync(dir) ? readdirSync(dir).filter((f) => !wanted.has(f)).map((f) => `${v.id}/${f}`) : [];
    });
    expect(stale, `Clips no caption needs. ${RENDER}\n${stale.join("\n")}`).toEqual([]);
  });
});
