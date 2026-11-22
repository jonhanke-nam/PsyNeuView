import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NARRATION_KEY,
  NARRATION_RATE,
  NARRATION_RATE_KEY,
  NARRATION_VOICE_KEY,
  RECORDED_DEFAULT_KEY,
  adoptRecordedDefaultOnce,
  listNarrationVoices,
  loadNarrationPref,
  loadNarrationRate,
  loadNarrationVoice,
  narrationAvailable,
  pickVoice,
  resolveVoice,
  saveNarrationPref,
  saveNarrationRate,
  saveNarrationVoice,
  narrationVoiceName,
  pauseSpeaking,
  resumeSpeaking,
  setClipPlayer,
  speakCaption,
  voiceShortName,
  stopSpeaking,
  voiceQuality,
} from "./narration";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe("narration preference (#1310)", () => {
  it("is off until someone turns it on", () => {
    expect(loadNarrationPref(storage())).toBe(false);
    expect(loadNarrationPref(null)).toBe(false);
  });

  it("is remembered per browser, as on or off", () => {
    const s = storage();
    saveNarrationPref(true, s);
    expect(s.map.get(NARRATION_KEY)).toBe("on");
    expect(loadNarrationPref(s)).toBe(true);
    saveNarrationPref(false, s);
    expect(loadNarrationPref(s)).toBe(false);
  });

  it("treats blocked storage as off, without throwing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadNarrationPref(blocked)).toBe(false);
    expect(() => saveNarrationPref(true, blocked)).not.toThrow();
  });
});

describe("narration availability", () => {
  it("needs both speechSynthesis and SpeechSynthesisUtterance", () => {
    expect(narrationAvailable({})).toBe(false);
    expect(narrationAvailable({ speechSynthesis: {} })).toBe(false);
    expect(narrationAvailable({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} })).toBe(true);
  });
});

describe("speakCaption", () => {
  const engine = () => ({ speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
  const utterance = (text: string) => ({ text, rate: 0 }) as unknown as SpeechSynthesisUtterance;

  it("cancels what was playing, then speaks the line", () => {
    const e = engine();
    expect(speakCaption("Look here.", e, utterance)).toBe(true);
    expect(e.cancel).toHaveBeenCalledTimes(1);
    expect(e.speak).toHaveBeenCalledTimes(1);
    expect((e.speak.mock.calls[0][0] as { text: string }).text).toBe("Look here.");
  });

  it("a blank caption only silences", () => {
    const e = engine();
    expect(speakCaption("   ", e, utterance)).toBe(false);
    expect(e.cancel).toHaveBeenCalledTimes(1);
    expect(e.speak).not.toHaveBeenCalled();
  });

  it("does nothing without an engine", () => {
    expect(speakCaption("Look here.", null, utterance)).toBe(false);
    expect(() => stopSpeaking(null)).not.toThrow();
  });
});

describe("pickVoice", () => {
  const v = (name: string, lang = "en-US", voiceURI = `com.apple.voice.compact.${lang}.${name}`) =>
    ({ name, lang, voiceURI, localService: true, default: false }) as SpeechSynthesisVoice;
  // What a Mac with no downloaded voices offers (abridged), default first.
  const macDefaults = [v("Albert"), v("Bubbles"), v("Eddy (English (US))"), v("Fred"), v("Daniel", "en-GB"), v("Samantha"), v("Karen", "en-AU"), v("Zarvox")];

  it("picks a real voice over the novelty and formant ones", () => {
    expect(pickVoice(macDefaults, "en-US")?.name).toBe("Karen");
  });

  it("prefers a downloaded Premium or Enhanced voice", () => {
    const enhanced = v("Evan (Enhanced)", "en-US", "com.apple.voice.enhanced.en-US.Evan");
    const premium = v("Ava (Premium)", "en-US", "com.apple.voice.premium.en-US.Ava");
    expect(pickVoice([...macDefaults, enhanced], "en-US")?.name).toBe("Evan (Enhanced)");
    expect(pickVoice([...macDefaults, enhanced, premium], "en-US")?.name).toBe("Ava (Premium)");
  });

  it("takes other browsers' natural voices", () => {
    const voices = [v("Microsoft David - English (United States)"), v("Microsoft Aria Online (Natural) - English (United States)"), v("Google US English")];
    expect(pickVoice(voices, "en-US")?.name).toBe("Microsoft Aria Online (Natural) - English (United States)");
  });

  it("prefers Karen, then Daniel, among the standard voices", () => {
    expect(pickVoice([v("Samantha"), v("Daniel", "en-GB")], "en-US")?.name).toBe("Daniel");
    expect(pickVoice([v("Samantha"), v("Daniel", "en-GB"), v("Karen", "en-AU")], "en-US")?.name).toBe("Karen");
  });

  it("a downloaded Karen beats another Premium voice", () => {
    const ava = v("Ava (Premium)", "en-US", "com.apple.voice.premium.en-US.Ava");
    const karen = v("Karen (Premium)", "en-AU", "com.apple.voice.premium.en-AU.Karen");
    expect(pickVoice([ava, karen], "en-US")?.name).toBe("Karen (Premium)");
  });

  it("never picks a novelty voice, and leaves the default when there's no English voice", () => {
    expect(pickVoice([v("Bubbles"), v("Zarvox")], "en-US")).toBeNull();
    expect(pickVoice([v("Amélie", "fr-CA"), v("Anna", "de-DE")], "en-US")).toBeNull();
  });

  it("speakCaption reads in the picked voice, a touch slower", () => {
    const voices = [v("Bubbles"), v("Karen", "en-AU")];
    const e = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: () => voices };
    const made = (text: string) => ({ text, rate: 0 }) as unknown as SpeechSynthesisUtterance;
    speakCaption("Look here.", e, made);
    const u = e.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(u.voice?.name).toBe("Karen");
    expect(u.rate).toBe(NARRATION_RATE);
  });
});

describe("choosing a narration voice in Settings", () => {
  const v = (name: string, lang = "en-US", voiceURI = `com.apple.voice.compact.${lang}.${name}`) =>
    ({ name, lang, voiceURI, localService: true, default: false }) as SpeechSynthesisVoice;
  const karenPremium = v("Karen (Premium)", "en-AU", "com.apple.voice.premium.en-AU.Karen");
  const installed = [v("Bubbles"), v("Samantha"), v("Daniel", "en-GB"), v("Karen", "en-AU"), v("Eddy (English (US))"), v("Amélie", "fr-CA"), karenPremium];

  it("lists English voices best first, labelled, with no novelty voices", () => {
    const list = listNarrationVoices(installed, "en-US");
    expect(list.map((o) => o.name)).toEqual(["Karen (Premium)", "Karen", "Daniel", "Samantha", "Eddy (English (US))"]);
    expect(list[0]).toMatchObject({ label: "Karen (Premium) · Australian", quality: "premium" });
    expect(list[2].label).toBe("Daniel · British");
  });

  it("names each voice's quality", () => {
    expect(voiceQuality(karenPremium)).toBe("premium");
    expect(voiceQuality(v("Evan (Enhanced)"))).toBe("enhanced");
    expect(voiceQuality(v("Google UK English Female", "en-GB"))).toBe("natural");
    expect(voiceQuality(v("Samantha"))).toBe("standard");
  });

  it("remembers the chosen voice by its identifier; Automatic clears it", () => {
    const s = { ...storage(), removeItem(k: string) { this.map.delete(k); } };
    saveNarrationVoice("com.apple.voice.compact.en-GB.Daniel", s);
    expect(s.map.get(NARRATION_VOICE_KEY)).toBe("com.apple.voice.compact.en-GB.Daniel");
    expect(loadNarrationVoice(s)).toBe("com.apple.voice.compact.en-GB.Daniel");
    saveNarrationVoice(null, s);
    expect(loadNarrationVoice(s)).toBe("recorded:heart"); // the default (#159)
  });

  it("reads in the chosen voice, and falls back to the best one when it's gone", () => {
    expect(resolveVoice(installed, "com.apple.voice.compact.en-US.Samantha")?.name).toBe("Samantha");
    expect(resolveVoice(installed, "com.apple.voice.premium.en-US.Ava")?.name).toBe("Karen (Premium)");
    expect(resolveVoice(installed, null)?.name).toBe("Karen (Premium)");
    // A novelty voice stored somehow is never used.
    expect(resolveVoice(installed, "com.apple.voice.compact.en-US.Bubbles")?.name).toBe("Karen (Premium)");
  });

  it("speakCaption uses the voice chosen in Settings", () => {
    const e = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: () => installed };
    const made = (text: string) => ({ text, rate: 0 }) as unknown as SpeechSynthesisUtterance;
    speakCaption("Look here.", e, made, "com.apple.voice.compact.en-GB.Daniel");
    expect((e.speak.mock.calls[0][0] as SpeechSynthesisUtterance).voice?.name).toBe("Daniel");
  });
});

describe("speaking rate and pronunciation (#1407)", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it("remembers a rate Settings offers, and forgets the default", () => {
    const s = store();
    expect(loadNarrationRate(s)).toBe(NARRATION_RATE);
    saveNarrationRate(1.25, s);
    expect(loadNarrationRate(s)).toBe(1.25);
    saveNarrationRate(NARRATION_RATE, s);
    expect(s.m.has(NARRATION_RATE_KEY)).toBe(false);
    s.setItem(NARRATION_RATE_KEY, "7");
    expect(loadNarrationRate(s)).toBe(NARRATION_RATE);
  });

  it("speakCaption reads at the given rate, with tricky words respelt", () => {
    const e = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    const made = (text: string) => ({ text, rate: 0 }) as unknown as SpeechSynthesisUtterance;
    speakCaption("This is EGO's working memory.", e, made, null, 1.1);
    const u = e.speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(u.text).toBe("This is Ego's working memory.");
    expect(u.rate).toBe(1.1);
  });
});

describe("voiceShortName (#93)", () => {
  it("drops the quality note", () => {
    expect(voiceShortName({ name: "Karen (Premium)" })).toBe("Karen");
    expect(voiceShortName({ name: "Daniel" })).toBe("Daniel");
  });
  it("is null when no voice is known", () => {
    expect(voiceShortName(null)).toBeNull();
    expect(voiceShortName({ name: "" })).toBeNull();
  });
});

describe("speakCaption never throws (#93)", () => {
  it("returns false when the engine rejects the utterance", () => {
    const e = { cancel() {}, speak() { throw new TypeError("Failed to convert value to 'SpeechSynthesisVoice'"); }, pause() {}, resume() {}, getVoices: () => [] };
    expect(speakCaption("Look here.", e as never, (t) => ({ text: t }) as never)).toBe(false);
  });
});

describe("a recorded voice (#159)", () => {
  const engine = () => ({ speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() });
  const utterance = (text: string) => ({ text, rate: 0 }) as unknown as SpeechSynthesisUtterance;
  type Fake = { url: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; playbackRate: number; onplay: null | (() => void); onended: null | (() => void); onerror: null | (() => void) };
  let clips: Fake[];
  let playResult: () => Promise<void>;
  beforeEach(() => {
    clips = [];
    playResult = () => Promise.resolve();
    setClipPlayer((url) => {
      const c: Fake = { url, play: vi.fn(() => playResult()), pause: vi.fn(), playbackRate: 1, onplay: null, onended: null, onerror: null };
      clips.push(c);
      return c as never;
    });
  });
  afterEach(() => setClipPlayer(null));

  it("plays the caption's clip, at the chosen rate against the default, and says when it starts and ends", () => {
    const e = engine();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    expect(speakCaption("Look here.", e, utterance, "recorded:michael", 1.25 * NARRATION_RATE, { onStart, onEnd })).toBe(true);
    expect(clips).toHaveLength(1);
    expect(clips[0].url).toMatch(/^\/narration\/michael\/[0-9a-f]{14}\.m4a$/);
    expect(clips[0].playbackRate).toBeCloseTo(1.25);
    expect(e.speak).not.toHaveBeenCalled();
    clips[0].onplay?.();
    clips[0].onended?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("with no clip for the caption, the computer's voice reads it", () => {
    const e = engine();
    speakCaption("A caption reworded since the clips were made.", e, utterance, "recorded:heart", NARRATION_RATE);
    clips[0].onerror?.();
    expect(e.speak).toHaveBeenCalledTimes(1);
    expect((e.speak.mock.calls[0][0] as { text: string }).text).toBe("A caption reworded since the clips were made.");
  });

  it("when the browser won't play it, the computer's voice reads it", async () => {
    const e = engine();
    playResult = () => Promise.reject(new Error("NotAllowedError"));
    speakCaption("Look here.", e, utterance, "recorded:heart", NARRATION_RATE);
    await vi.waitFor(() => expect(e.speak).toHaveBeenCalledTimes(1));
  });

  it("stops, pauses and resumes with the walkthrough; a stopped line is not read instead", () => {
    const e = engine();
    speakCaption("Look here.", e, utterance, "recorded:heart", NARRATION_RATE);
    pauseSpeaking(e);
    expect(clips[0].pause).toHaveBeenCalledTimes(1);
    resumeSpeaking(e);
    expect(clips[0].play).toHaveBeenCalledTimes(2);
    stopSpeaking(e);
    expect(clips[0].pause).toHaveBeenCalledTimes(2);
    clips[0].onerror?.(); // the stopped clip's late error
    expect(e.speak).not.toHaveBeenCalled();
  });

  it("the next line replaces the clip playing", () => {
    const e = engine();
    speakCaption("One.", e, utterance, "recorded:heart", NARRATION_RATE);
    speakCaption("Two.", e, utterance, "recorded:heart", NARRATION_RATE);
    expect(clips[0].pause).toHaveBeenCalled();
    expect(clips).toHaveLength(2);
  });

  it("names the voice on the bar", () => {
    expect(narrationVoiceName([], "recorded:heart")).toBe("Heart");
    expect(narrationVoiceName([], "recorded:michael")).toBe("Michael");
  });
});

describe("the one-time move to the recorded default (#159)", () => {
  const store = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  const KAREN = "com.apple.voice.premium.en-AU.Karen";

  it("a system voice chosen before gives way to Heart, once", () => {
    const s = store({ [NARRATION_VOICE_KEY]: KAREN });
    expect(adoptRecordedDefaultOnce(s)).toBe(true);
    expect(loadNarrationVoice(s)).toBe("recorded:heart");
    // Karen chosen again afterwards is kept.
    s.setItem(NARRATION_VOICE_KEY, KAREN);
    expect(adoptRecordedDefaultOnce(s)).toBe(false);
    expect(loadNarrationVoice(s)).toBe(KAREN);
  });

  it("keeps a recorded voice, Automatic chosen on purpose, or nothing chosen", () => {
    for (const v of ["recorded:michael", "system:automatic"]) {
      const s = store({ [NARRATION_VOICE_KEY]: v });
      expect(adoptRecordedDefaultOnce(s)).toBe(false);
      expect(loadNarrationVoice(s)).toBe(v);
    }
    const none = store();
    expect(adoptRecordedDefaultOnce(none)).toBe(false);
    expect(none.m.get(RECORDED_DEFAULT_KEY)).toBe("done");
  });
});
