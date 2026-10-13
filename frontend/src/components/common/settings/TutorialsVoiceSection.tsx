/**
 * Settings ▸ Tutorials and Voice (#1404, #1407).
 *
 * Voice: how narration sounds, the voice and the speaking rate. One voice for
 * everything that speaks, so a later use of speech (a "run finished"
 * announcement, say) reuses it rather than growing its own picker. Turning
 * narration on and off stays on the walkthrough bar, where it is reached for
 * mid-walkthrough; this section has no second switch for it.
 *
 * Tutorials: the walkthrough choices that used to have no way back, such as
 * "Don't remind me" on the orientation reminder.
 */

import { useState } from "react";
import { recordSettingChanged } from "@/utils/activityLog";
import { NARRATION_RATES, loadNarrationRate, narrationAvailable, saveNarrationRate } from "@/utils/narration";
import { readOfferChoice, writeOfferChoice, clearOfferChoice, type OfferChoice } from "@/utils/orientationOffer";
import { NarrationVoiceSetting } from "./NarrationVoiceSetting";
import { Group, SettingLabel, mutedStyle, selectStyle } from "./shared";

export function TutorialsVoiceSection() {
  return (
    <>
      <Group id="voice" title="Voice">
        <NarrationVoiceSetting />
        {narrationAvailable() && <NarrationRateSetting />}
      </Group>
      <Group id="tutorials" title="Tutorials">
        <OrientationReminderSetting />
      </Group>
    </>
  );
}

/** How fast narration reads. The default is a touch slower than the voice's own pace. */
function NarrationRateSetting() {
  const [rate, setRate] = useState(() => loadNarrationRate());
  const choose = (value: string) => {
    const next = Number(value);
    saveNarrationRate(next);
    setRate(next);
    recordSettingChanged("walkthrough-narration-rate", value);
  };
  return (
    <div style={{ fontSize: 13, marginTop: 14 }}>
      <SettingLabel title="Speaking rate" htmlFor="setting-narration-rate">
        How fast narration reads. The default is a touch slower than the voice's own pace, for reading and looking at
        the same time. ▶ Play sample uses it too.
      </SettingLabel>
      <select
        id="setting-narration-rate"
        data-testid="setting-narration-rate"
        value={String(rate)}
        onChange={(e) => choose(e.target.value)}
        style={{ ...selectStyle, marginTop: 6 }}
      >
        {NARRATION_RATES.map((r) => (
          <option key={r.rate} value={String(r.rate)}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type ReminderValue = "ask" | "later" | "never" | "started";

/**
 * The first-launch offer of PsyNeuView First Steps (#1310) and its reminder.
 * "Don't remind me" on the Tutorials menu used to be final; here it can be
 * undone, and the offer can be made again.
 */
function OrientationReminderSetting() {
  const [choice, setChoice] = useState<OfferChoice | null>(() => readOfferChoice());
  const value: ReminderValue = choice ?? "ask";
  const choose = (next: ReminderValue) => {
    if (next === "ask") clearOfferChoice();
    else writeOfferChoice(next);
    setChoice(next === "ask" ? null : next);
    recordSettingChanged("orientation-reminder", next);
  };
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="PsyNeuView First Steps reminder" htmlFor="setting-orientation-reminder">
        The eight short walkthroughs of the app itself. They are always in the Tutorials menu; this is only whether
        PsyNeuView reminds you about them.
      </SettingLabel>
      <select
        id="setting-orientation-reminder"
        data-testid="setting-orientation-reminder"
        value={value}
        onChange={(e) => choose(e.target.value as ReminderValue)}
        style={{ ...selectStyle, marginTop: 6 }}
      >
        <option value="ask">Offer them the next time PsyNeuView opens</option>
        <option value="later">Remind me in the Tutorials menu</option>
        <option value="never">Don't remind me</option>
        {value === "started" && <option value="started">Started — no reminder needed</option>}
      </select>
      <div style={{ ...mutedStyle, marginTop: 6 }}>Remembered in this browser.</div>
    </div>
  );
}
