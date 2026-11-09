/**
 * Recorded narration (#159): every walkthrough caption read once, ahead of
 * time, by a voice that ships with the app, so every computer hears the same
 * good voice.
 *
 * The clips are made by `scripts/render-narration.py` with Kokoro, a free
 * voice model whose licence (Apache 2.0) allows shipping what it makes. Each
 * voice has a folder under `public/narration/`, and each clip is named by a
 * hash of the words it says (the caption after `pronunciations.yaml`), so a
 * reworded caption, or a new respelling, gets a new clip, and an unchanged
 * one keeps its own. A caption with no clip is read by the computer's own
 * voice, as before: narration is never silent for want of a file.
 *
 * `recordedNarration.test.ts` fails when a caption has no clip, or a clip
 * belongs to no caption; `npm run narration:render` puts that right.
 */

import { spokenText } from "./pronunciation";

/** One recorded voice. `id` names its folder and is what Settings keeps. */
export interface RecordedVoice {
  id: string;
  /** The Kokoro voice it was rendered with. */
  kokoro: string;
  name: string;
  /** For Settings' list. */
  label: string;
}

export const RECORDED_VOICES: RecordedVoice[] = [
  { id: "heart", kokoro: "af_heart", name: "Heart", label: "Heart · American" },
  { id: "michael", kokoro: "am_michael", name: "Michael", label: "Michael · American" },
];

/** How Settings keeps a recorded voice's choice, beside system voices' `voiceURI`s. */
export const RECORDED_PREFIX = "recorded:";

/** The voice narration uses until one is chosen: Heart, recorded. */
export const DEFAULT_NARRATION_VOICE = `${RECORDED_PREFIX}heart`;

/** Settings' value for "the best voice on this computer", chosen on purpose. */
export const SYSTEM_AUTOMATIC = "system:automatic";

/** The recorded voice a Settings value names, if it names one. */
export function recordedVoice(choice: string | null | undefined): RecordedVoice | null {
  if (!choice?.startsWith(RECORDED_PREFIX)) return null;
  const id = choice.slice(RECORDED_PREFIX.length);
  return RECORDED_VOICES.find((v) => v.id === id) ?? null;
}

/**
 * A 53-bit hash of the words, as 14 hex digits (cyrb53). Short, the same in
 * every browser and in Node, and with 330 captions a clash is out of reach.
 */
export function wordsHash(words: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < words.length; i++) {
    const ch = words.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** What a recorded voice says for a caption: its words, with the respellings. */
export function recordedWords(caption: string): string {
  return spokenText(caption.trim());
}

/** The clip's file name, within its voice's folder. */
export function clipFile(caption: string): string {
  return `${wordsHash(recordedWords(caption))}.m4a`;
}

/** Where the app serves a caption's clip in a voice. */
export function clipUrl(voice: RecordedVoice, caption: string): string {
  return `/narration/${voice.id}/${clipFile(caption)}`;
}
