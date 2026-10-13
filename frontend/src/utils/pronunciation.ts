/**
 * What narration says in place of the words a voice gets wrong (#1407).
 *
 * The dictionary is `src/walkthroughs/pronunciations.yaml`. It changes only
 * what is spoken: the caption on screen keeps the real word. Live narration
 * (the browser's voices) uses each entry's respelling; recording with Piper
 * uses its phonemes where it has them (`scripts/record-narration.py`).
 */

import yaml from "js-yaml";
import pronunciationsYaml from "@/walkthroughs/pronunciations.yaml?raw";

export interface Pronunciation {
  word: string;
  say: string;
  phonemes?: string;
  confirm?: boolean;
}

export interface PronunciationDictionary {
  words: Pronunciation[];
  readsFine: string[];
}

export function parsePronunciations(text: string): PronunciationDictionary {
  const raw = (yaml.load(text) ?? {}) as { words?: Pronunciation[]; reads_fine?: string[] };
  const words = raw.words ?? [];
  for (const w of words) {
    if (typeof w.word !== "string" || typeof w.say !== "string") {
      throw new Error(`pronunciations: every entry needs a word and a say, got ${JSON.stringify(w)}`);
    }
  }
  return { words, readsFine: raw.reads_fine ?? [] };
}

export const PRONUNCIATIONS: PronunciationDictionary = parsePronunciations(pronunciationsYaml);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `word` on its own: not inside a longer word or a hyphenated name. */
function wholeWord(word: string): RegExp {
  return new RegExp(`(?<![\\w-])${escapeRegExp(word)}(?![\\w-])`, "g");
}

/** The caption as a live voice should read it: each dictionary word respelt. */
export function spokenText(text: string, dict: PronunciationDictionary = PRONUNCIATIONS): string {
  // Longest first, so "PsyNeuLink" is never half-replaced by a shorter entry.
  const words = [...dict.words].sort((a, b) => b.word.length - a.word.length);
  return words.reduce((out, w) => out.replace(wholeWord(w.word), w.say), text);
}

/**
 * The words in a caption a voice might misread: runs of capitals (DDM, EGO,
 * ISC-CI, FIELD_MEMORY) and names with a capital inside (PsyNeuLink, ReLU).
 */
export function trickyWords(text: string): string[] {
  const re = /(?<![\w-])(?:[A-Z][A-Z0-9]+(?:[-_][A-Z0-9]+)*|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*)(?![\w-])/g;
  return [...text.matchAll(re)].map((m) => m[0]);
}

/** Tricky words the dictionary has no decision for: neither respelt nor listed as reading fine. */
export function undecidedWords(text: string, dict: PronunciationDictionary = PRONUNCIATIONS): string[] {
  const known = new Set([...dict.words.map((w) => w.word), ...dict.readsFine]);
  return [...new Set(trickyWords(text).filter((w) => !known.has(w)))];
}
