/**
 * Narration for guided walkthroughs (#1310): each step's caption, read aloud
 * by the browser's own speech (the Web Speech API, `speechSynthesis`).
 *
 * Three rules:
 *
 *  - **Never required.** The caption is always on screen; speech is an extra.
 *    A browser without `speechSynthesis` simply has no narration toggle.
 *  - **Off by default, remembered per browser.** Sound that starts on its
 *    own is the thing people turn off first. The choice is kept in
 *    localStorage, like the Open menu's fold state.
 *  - **One line at a time.** Starting a line cancels the one before it, so a
 *    learner who moves on quickly never hears two steps at once.
 *
 * The speech engine is a parameter so the logic can be tested without a
 * browser; the app passes `window.speechSynthesis`.
 */

import { spokenText } from "./pronunciation";

export const NARRATION_KEY = "psyneuview.tour.narration";

/** The smallest slice of `speechSynthesis` narration uses. */
export interface SpeechEngine {
  speak: (utterance: SpeechSynthesisUtterance) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  /** The installed voices; optional so a test engine can leave it out. */
  getVoices?: () => SpeechSynthesisVoice[];
}

/** Whether this browser can read captions aloud at all. */
export function narrationAvailable(w: { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown } = globalThis as never): boolean {
  return typeof w.speechSynthesis === "object" && w.speechSynthesis !== null && typeof w.SpeechSynthesisUtterance === "function";
}

/** The remembered choice; off when nothing is remembered or storage is blocked. */
export function loadNarrationPref(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(NARRATION_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveNarrationPref(on: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(NARRATION_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts the session. Nothing else to do.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A touch slower than the default: a learner is reading and looking at the same time. */
export const NARRATION_RATE = 0.95;

/** Where the chosen speaking rate is kept (Settings ▸ Tutorials and Voice). */
export const NARRATION_RATE_KEY = "psyneuview.tour.narrationRate";

/** The rates Settings offers; 1 is the voice's own pace. */
export const NARRATION_RATES: { rate: number; label: string }[] = [
  { rate: 0.8, label: "Slower" },
  { rate: 0.9, label: "A little slower" },
  { rate: NARRATION_RATE, label: "Default" },
  { rate: 1, label: "The voice's own pace" },
  { rate: 1.1, label: "A little faster" },
  { rate: 1.25, label: "Faster" },
];

/** The chosen rate, or the default when none is chosen, it's not one Settings offers, or storage is blocked. */
export function loadNarrationRate(storage: Pick<Storage, "getItem"> | null = safeStorage()): number {
  try {
    const v = Number(storage?.getItem(NARRATION_RATE_KEY));
    return NARRATION_RATES.some((r) => r.rate === v) ? v : NARRATION_RATE;
  } catch {
    return NARRATION_RATE;
  }
}

export function saveNarrationRate(rate: number, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): void {
  try {
    if (rate === NARRATION_RATE) storage?.removeItem(NARRATION_RATE_KEY);
    else storage?.setItem(NARRATION_RATE_KEY, String(rate));
  } catch {
    // Storage blocked: the choice lasts the session. Nothing else to do.
  }
}

/** Joke and effect voices macOS ships alongside the real ones. Never used for narration. */
const NOVELTY_VOICES = new Set([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "good news", "jester",
  "organ", "superstar", "trinoids", "whisper", "wobble", "zarvox", "fred", "junior", "ralph", "kathy",
]);

/** The older formant voices (Eddy, Flo, Grandma, …): usable, but flat. Picked only if nothing better is there. */
const FORMANT_VOICES = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/;

/** Voices that read well, best first: Karen and Daniel were the picks in a listening test. */
const GOOD_VOICES = ["karen", "daniel", "ava", "zoe", "evan", "allison", "samantha", "serena", "moira", "tessa"];

function voiceScore(v: SpeechSynthesisVoice, preferredLang: string): number {
  const name = v.name.toLowerCase();
  const uri = (v.voiceURI ?? "").toLowerCase();
  const base = name.replace(/\s*\(.*\)\s*$/, "");
  if (NOVELTY_VOICES.has(base)) return -Infinity;
  let score = 0;
  if (name.includes("premium") || uri.includes(".premium.")) score += 60;
  else if (name.includes("enhanced") || uri.includes(".enhanced.")) score += 50;
  else if (name.includes("natural") || name.includes("online")) score += 45; // Edge / Windows neural voices
  else if (name.startsWith("google")) score += 30; // Chrome's network voices
  // The preferred names outweigh the reader's accent, but never a quality step.
  const good = GOOD_VOICES.indexOf(base);
  if (good >= 0) score += (GOOD_VOICES.length - good) * 3;
  if (FORMANT_VOICES.test(name)) score -= 20;
  if (v.lang.toLowerCase() === preferredLang.toLowerCase()) score += 2;
  else if (v.lang.toLowerCase().startsWith("en-us")) score += 1;
  return score;
}

/**
 * The voice to read captions in: the best English one installed.
 *
 * The browser's default is whatever the system picks, which on a Mac can be
 * a flat older voice. Premium and Enhanced voices (downloaded in System
 * Settings ▸ Accessibility ▸ Spoken Content) come first, then the natural
 * voices other browsers offer, then the standard voices that read well.
 * The novelty voices (Bubbles, Zarvox, …) are never picked. Null when there
 * is no English voice, leaving the browser's default.
 */
export function pickVoice(voices: SpeechSynthesisVoice[], preferredLang: string = globalThis.navigator?.language ?? "en-US"): SpeechSynthesisVoice | null {
  const lang = preferredLang.toLowerCase().startsWith("en") ? preferredLang : "en-US";
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    if (!v.lang?.toLowerCase().replace("_", "-").startsWith("en")) continue;
    const s = voiceScore(v, lang);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/** Where the chosen voice is kept: its `voiceURI`, or nothing for Automatic. */
export const NARRATION_VOICE_KEY = "psyneuview.tour.narrationVoice";

/** The chosen voice's `voiceURI`; null for Automatic, or when storage is blocked. */
export function loadNarrationVoice(storage: Pick<Storage, "getItem"> | null = safeStorage()): string | null {
  try {
    return storage?.getItem(NARRATION_VOICE_KEY) || null;
  } catch {
    return null;
  }
}

/** Remember a voice by its `voiceURI`; null goes back to Automatic. */
export function saveNarrationVoice(
  voiceURI: string | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage(),
): void {
  try {
    if (voiceURI) storage?.setItem(NARRATION_VOICE_KEY, voiceURI);
    else storage?.removeItem(NARRATION_VOICE_KEY);
  } catch {
    // Storage blocked: the choice lasts the session. Nothing else to do.
  }
}

export type VoiceQuality = "premium" | "enhanced" | "natural" | "standard";

/** How a voice sounds, from what its name and identifier say. */
export function voiceQuality(v: SpeechSynthesisVoice): VoiceQuality {
  const name = v.name.toLowerCase();
  const uri = (v.voiceURI ?? "").toLowerCase();
  if (name.includes("premium") || uri.includes(".premium.")) return "premium";
  if (name.includes("enhanced") || uri.includes(".enhanced.")) return "enhanced";
  if (name.includes("natural") || name.includes("online") || name.startsWith("google")) return "natural";
  return "standard";
}

const ACCENTS: Record<string, string> = {
  "en-us": "American", "en-gb": "British", "en-au": "Australian", "en-ie": "Irish", "en-za": "South African",
  "en-in": "Indian", "en-nz": "New Zealand", "en-ca": "Canadian", "en-sc": "Scottish",
};

/** One entry in Settings' voice list. */
export interface NarrationVoiceOption {
  voiceURI: string;
  name: string;
  /** e.g. "Karen (Premium) · Australian". */
  label: string;
  quality: VoiceQuality;
}

/**
 * The voices Settings offers, best first: every English voice except the
 * novelty ones, ranked as Automatic would rank them.
 */
export function listNarrationVoices(voices: SpeechSynthesisVoice[], preferredLang: string = globalThis.navigator?.language ?? "en-US"): NarrationVoiceOption[] {
  const lang = preferredLang.toLowerCase().startsWith("en") ? preferredLang : "en-US";
  return voices
    .filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("en"))
    .map((v) => ({ v, score: voiceScore(v, lang) }))
    .filter(({ score }) => score > -Infinity)
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
    .map(({ v }) => {
      const accent = ACCENTS[v.lang.toLowerCase().replace("_", "-")];
      return {
        voiceURI: v.voiceURI,
        name: v.name,
        label: accent ? `${v.name} · ${accent}` : v.name,
        quality: voiceQuality(v),
      };
    });
}

/**
 * The voice to read in: the chosen one while it's installed, otherwise the
 * best available (a chosen voice can vanish: removed, or another machine).
 */
export function resolveVoice(voices: SpeechSynthesisVoice[], chosen: string | null): SpeechSynthesisVoice | null {
  if (chosen) {
    const v = voices.find((x) => x.voiceURI === chosen);
    if (v && listNarrationVoices([v]).length > 0) return v;
  }
  return pickVoice(voices);
}

/** What Settings' ▶ Play sample reads. */
export const SAMPLE_CAPTION = "Select the hidden layer. Watch its values change as the model runs, one trial at a time.";

/**
 * Read one caption aloud, replacing whatever was being read. A blank caption
 * only silences what was playing. It reads in the voice and at the rate
 * chosen in Settings (or the best available voice and the default rate), with
 * the words voices misread respelt (`pronunciations.yaml`, #1407).
 */
export function speakCaption(
  text: string,
  engine: SpeechEngine | null,
  makeUtterance: (text: string) => SpeechSynthesisUtterance = (t) => new SpeechSynthesisUtterance(t),
  chosenVoice: string | null = loadNarrationVoice(),
  rate: number = loadNarrationRate(),
  events: { onStart?: () => void; onEnd?: () => void } = {},
): boolean {
  if (!engine) return false;
  // Narration is never worth the app: a voice that won't take an utterance
  // (or a browser that rejects one) means silence, not an error screen.
  try {
    return speakLine(text, engine, makeUtterance, chosenVoice, rate, events);
  } catch {
    return false;
  }
}

function speakLine(
  text: string,
  engine: SpeechEngine,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
  chosenVoice: string | null,
  rate: number,
  events: { onStart?: () => void; onEnd?: () => void },
): boolean {
  engine.cancel();
  const line = text.trim();
  if (!line) return false;
  const utterance = makeUtterance(spokenText(line));
  const voice = resolveVoice(engine.getVoices?.() ?? [], chosenVoice);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  // So the bar can light the line while it's being read (#86).
  if (events.onStart) utterance.onstart = events.onStart;
  if (events.onEnd) {
    utterance.onend = events.onEnd;
    utterance.onerror = events.onEnd;
  }
  engine.speak(utterance);
  return true;
}

/** Stop reading, for when the walkthrough ends or narration is turned off. */
export function stopSpeaking(engine: SpeechEngine | null): void {
  engine?.cancel();
}

/**
 * Who the bar says is speaking (#93): the voice's own name, without the
 * quality note macOS adds ("Karen (Premium)" → "Karen"), or "Narration" when
 * no voice is known yet.
 */
export function speakerLabel(voice: Pick<SpeechSynthesisVoice, "name"> | null | undefined): string {
  const name = voice?.name?.replace(/\s*\(.*\)\s*$/, "").trim();
  return name || "Narration";
}
