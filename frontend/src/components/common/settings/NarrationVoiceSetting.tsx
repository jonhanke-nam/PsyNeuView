/**
 * Settings ▸ Tutorials and Voice ▸ Voice: which voice reads the captions.
 *
 * Automatic picks the best English voice installed (Premium and Enhanced
 * first, then Karen, Daniel, …; see utils/narration.ts). The list is the
 * browser's own voices, so it differs between machines; it refreshes when
 * the browser reports new ones (`voiceschanged`), e.g. after a download.
 * Better voices are a free download from the system, so the setting says
 * where to get them. Turning narration on and off stays on the walkthrough
 * bar; this is only the voice.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "../Button";
import { recordSettingChanged } from "@/utils/activityLog";
import {
  SAMPLE_CAPTION,
  listNarrationVoices,
  loadNarrationRate,
  loadNarrationVoice,
  narrationAvailable,
  pickVoice,
  saveNarrationVoice,
  speakCaption,
  type NarrationVoiceOption,
  type SpeechEngine,
} from "@/utils/narration";
import { SettingLabel, linkStyle, mutedStyle, selectStyle } from "./shared";

/** System Settings ▸ Accessibility ▸ Spoken Content, where macOS downloads voices. */
export const SPOKEN_CONTENT_URL = "x-apple.systempreferences:com.apple.Accessibility-Settings.extension?SpokenContent";

const QUALITY_GROUPS: { quality: NarrationVoiceOption["quality"][]; label: string }[] = [
  { quality: ["premium", "enhanced"], label: "Premium and Enhanced" },
  { quality: ["natural"], label: "Natural (online)" },
  { quality: ["standard"], label: "Standard" },
];

function platform(): "mac" | "windows" | "other" {
  const p = `${globalThis.navigator?.platform ?? ""} ${globalThis.navigator?.userAgent ?? ""}`;
  if (/Mac/i.test(p)) return "mac";
  if (/Win/i.test(p)) return "windows";
  return "other";
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    narrationAvailable() ? window.speechSynthesis.getVoices?.() ?? [] : [],
  );
  useEffect(() => {
    if (!narrationAvailable()) return;
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(synth.getVoices?.() ?? []);
    refresh();
    synth.addEventListener?.("voiceschanged", refresh);
    return () => synth.removeEventListener?.("voiceschanged", refresh);
  }, []);
  return voices;
}

export function NarrationVoiceSetting() {
  const voices = useVoices();
  const options = useMemo(() => listNarrationVoices(voices), [voices]);
  const automatic = useMemo(() => pickVoice(voices), [voices]);
  const [chosen, setChosen] = useState<string | null>(() => loadNarrationVoice());
  const os = platform();

  if (!narrationAvailable()) {
    return (
      <div data-testid="narration-voice-unavailable" style={mutedStyle}>
        This browser can't read walkthrough captions aloud, so there is no voice to choose.
      </div>
    );
  }

  // A chosen voice that's no longer installed reads as Automatic.
  const value = chosen && options.some((o) => o.voiceURI === chosen) ? chosen : "";

  const choose = (voiceURI: string) => {
    const next = voiceURI || null;
    saveNarrationVoice(next);
    setChosen(next);
    recordSettingChanged("walkthrough-narration-voice", next ?? "automatic");
  };

  const playSample = () => {
    speakCaption(SAMPLE_CAPTION, window.speechSynthesis as SpeechEngine, undefined, value || null, loadNarrationRate());
  };

  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Narration voice" htmlFor="setting-narration-voice">
        The voice that reads a walkthrough's captions when narration is on (the speaker button on the walkthrough
        bar). Automatic uses the best English voice on this computer.
      </SettingLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <select
          id="setting-narration-voice"
          data-testid="setting-narration-voice"
          value={value}
          onChange={(e) => choose(e.target.value)}
          style={{ ...selectStyle, maxWidth: 360 }}
        >
          <option value="">Automatic — best available{automatic ? ` (now: ${automatic.name})` : ""}</option>
          {QUALITY_GROUPS.map((g) => {
            const inGroup = options.filter((o) => g.quality.includes(o.quality));
            if (inGroup.length === 0) return null;
            return (
              <optgroup key={g.label} label={g.label}>
                {inGroup.map((o) => (
                  <option key={o.voiceURI} value={o.voiceURI}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <Button data-testid="narration-voice-sample" kind="small" onClick={playSample}>
          ▶ Play sample
        </Button>
      </div>
      {options.length === 0 && (
        <div style={{ ...mutedStyle, marginTop: 6 }}>No English voices found yet. The list fills in when the browser reports them.</div>
      )}
      <BetterVoicesHelp os={os} hasPremium={options.some((o) => o.quality === "premium" || o.quality === "enhanced")} />
    </div>
  );
}

/** Where to get better voices: free downloads from the system. */
function BetterVoicesHelp({ os, hasPremium }: { os: "mac" | "windows" | "other"; hasPremium: boolean }) {
  return (
    <div data-testid="narration-voice-help" style={{ ...mutedStyle, marginTop: 8, maxWidth: 560 }}>
      {os === "mac" ? (
        <>
          {hasPremium ? "For more voices, " : "For a much more natural voice, "}download a Premium or Enhanced voice
          (free, a few hundred MB): System Settings ▸ Accessibility ▸ Spoken Content ▸ System Voice ▸ Manage Voices…
          ▸ English, then e.g. <b>Karen (Premium)</b> or <b>Daniel (Enhanced)</b>.{" "}
          <a data-testid="narration-voice-open-system" href={SPOKEN_CONTENT_URL} style={linkStyle}>
            Open Spoken Content settings…
          </a>{" "}
          A new voice shows here once it has downloaded; if it doesn't, restart PsyNeuView.
        </>
      ) : os === "windows" ? (
        <>
          For more voices: Windows Settings ▸ Time &amp; language ▸ Speech ▸ Add voices. In Microsoft Edge the
          natural online voices are already listed. A new voice shows here after restarting the browser.
        </>
      ) : (
        <>Voices come from your system and browser. Chrome and Edge include natural online voices.</>
      )}
    </div>
  );
}
