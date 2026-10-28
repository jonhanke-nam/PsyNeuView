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
 * "Don't remind me" on the orientation reminder, and which sections the
 * Tutorials menu lists (#136).
 */

import { useState } from "react";
import { recordSettingChanged } from "@/utils/activityLog";
import { NARRATION_RATES, loadNarrationRate, narrationAvailable, saveNarrationRate } from "@/utils/narration";
import { readOfferChoice, writeOfferChoice, clearOfferChoice, type OfferChoice } from "@/utils/orientationOffer";
import {
  RING_COLORS,
  RING_PULSES,
  RING_THICKNESSES,
  ringColor,
  ringWidth,
  useTourHighlightStore,
  type RingColor,
  type RingPulse,
  type RingThickness,
} from "@/stores/tourHighlightStore";
import { NarrationVoiceSetting } from "./NarrationVoiceSetting";
import { useTutorialsMenuStore } from "@/stores/tutorialsMenuStore";
import { Group, SettingLabel, mutedStyle, selectStyle } from "./shared";

export function TutorialsVoiceSection() {
  return (
    <>
      <Group id="voice" title="Voice">
        <NarrationVoiceSetting />
        {narrationAvailable() && <NarrationRateSetting />}
      </Group>
      <Group id="highlight" title="Highlight">
        <HighlightSettings />
      </Group>
      <Group id="tutorials" title="Tutorials">
        <OrientationReminderSetting />
        <HideCourseSetting />
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
    <div style={{ fontSize: "var(--pnv-fs-13)", marginTop: 14 }}>
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
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
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

/**
 * Whether the Tutorials menu lists the Cognitive Neuroscience Course (#136).
 * Off by default, so the course shows. Hiding it is about the menu only: a
 * course walkthrough opened by link still runs.
 */
function HideCourseSetting() {
  const hideCourse = useTutorialsMenuStore((s) => s.hideCourse);
  const setHideCourse = useTutorialsMenuStore((s) => s.setHideCourse);
  return (
    <label style={{ fontSize: "var(--pnv-fs-13)", marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        data-testid="setting-hide-course"
        checked={hideCourse}
        onChange={(e) => setHideCourse(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span>
        Hide the Cognitive Neuroscience Course
        <span style={{ ...mutedStyle, display: "block" }}>
          Leaves the course's walkthroughs out of the Tutorials menu. A course walkthrough opened by link still runs.
          Remembered in this browser.
        </span>
      </span>
    </label>
  );
}

/**
 * How a walkthrough marks what a step points at (#100): the ring's thickness,
 * pulse and colour, and whether the gliding arrow is shown. A sample ring
 * shows the choice.
 */
function HighlightSettings() {
  const h = useTourHighlightStore();
  const row = { fontSize: "var(--pnv-fs-13)", marginTop: 10 } as const;
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 280px" }}>
        <SettingLabel title="Ring" htmlFor="setting-tour-ring-thickness">
          The ring round what a walkthrough step points at.
        </SettingLabel>
        <div style={{ ...row, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            id="setting-tour-ring-thickness"
            data-testid="setting-tour-ring-thickness"
            aria-label="Ring thickness"
            value={h.thickness}
            onChange={(e) => h.setThickness(e.target.value as RingThickness)}
            style={selectStyle}
          >
            {RING_THICKNESSES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            data-testid="setting-tour-ring-pulse"
            aria-label="Ring pulse"
            value={h.pulse}
            onChange={(e) => h.setPulse(e.target.value as RingPulse)}
            style={selectStyle}
          >
            {RING_PULSES.map((p) => (
              <option key={p.id} value={p.id}>
                Pulse: {p.label}
              </option>
            ))}
          </select>
          <select
            data-testid="setting-tour-ring-color"
            aria-label="Ring colour"
            value={h.color}
            onChange={(e) => h.setColor(e.target.value as RingColor)}
            style={selectStyle}
          >
            {RING_COLORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <label style={{ ...row, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            data-testid="setting-tour-arrow"
            checked={h.showArrow}
            onChange={(e) => h.setShowArrow(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            Show the pointer arrow
            <span style={{ ...mutedStyle, display: "block" }}>
              An arrow that glides to each step. Off by default: it can be mistaken for your own pointer.
            </span>
          </span>
        </label>
      </div>
      {/* A sample, so the choice can be seen without starting a walkthrough. */}
      <div
        data-testid="tour-ring-sample"
        aria-hidden="true"
        className={h.pulse !== "off" ? `pnv-tour-ring-pulse-${h.pulse}` : undefined}
        style={{
          width: 120,
          height: 44,
          marginTop: 6,
          borderRadius: 12,
          color: ringColor(h.color),
          border: `${ringWidth(h.thickness)}px solid currentColor`,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

