/**
 * Settings ▸ General: the everyday settings. (#1290)
 *
 * In the Mac app, the two switches the app acts on; everywhere, which
 * PsyNeuLink version to use (the simple view of Developer's full form,
 * #1295), autosave (#1347), and where new models' layout files go. The
 * narration voice is in Tutorials and Voice. My Project
 * Folder itself is in Folders, with every other folder.
 */

import { useEffect, useState } from "react";
import { useAutosaveStore } from "@/stores/autosaveStore";
import { BUSY_THRESHOLDS, DEFAULT_BUSY_THRESHOLD_MS, useBusyStore } from "@/stores/busyStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { AUTOSAVE_MAX_SECONDS, AUTOSAVE_MIN_SECONDS, clampAutosaveSeconds } from "@/utils/autosave";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import type { PsyNeuLinkInfo } from "@/utils/pnlSources";
import { getPlacementDefault, setPlacementDefault } from "@/utils/sidecarApi";
import { MacAppLaunchToggles } from "../MacAppSettingsSection";
import { PnlUpdateStatus } from "./PnlUpdateStatus";
import { PnlVersionChoice } from "./PnlVersionChoice";
import { Group, SettingLabel, errorStyle, mutedStyle } from "./shared";
import type { InstallCapabilities, SettingsInfo } from "./types";

export function GeneralSection({
  info,
  loadError,
  capabilities,
  onInstallSucceeded,
}: {
  info: SettingsInfo | null;
  loadError: string | null;
  capabilities: InstallCapabilities | null;
  onInstallSucceeded: (snapshot: PsyNeuLinkInfo) => void;
}) {
  return (
    <>
      {hasSettingsBridge() && (
        <Group id="mac-app" title="Mac app">
          <MacAppLaunchToggles />
        </Group>
      )}
      <Group id="pnl-version" title="PsyNeuLink version">
        {loadError && <div style={errorStyle}>Failed to load: {loadError}</div>}
        {!loadError && !(info && capabilities) && <div style={mutedStyle}>Loading…</div>}
        {info && capabilities && (
          <PnlVersionChoice capabilities={capabilities} currentPnl={info.psyneulink} onInstallSucceeded={onInstallSucceeded} />
        )}
        {/* How current it is, Check now, and automatic updates for Latest development (#1304). */}
        {info && capabilities?.enabled && <PnlUpdateStatus currentPnl={info.psyneulink} />}
      </Group>
      <Group id="model-files" title="Model files">
        <AutosaveRows />
        <SidecarPlacementDefaultRow />
        <div style={{ ...mutedStyle, marginTop: 10 }}>Where models are saved, and every other folder: Folders.</div>
      </Group>
      <Group id="busy-indicator" title="Busy indicator">
        <BusyThresholdRow />
      </Group>
    </>
  );
}

/**
 * Autosave (#1347): off by default, so a model's .py changes only when you
 * press Save — what an external editor open on the same file needs (#1029).
 * When on, the number of idle seconds shows under it. Two settings, one
 * control each; the store keeps them, the backend remembers them.
 */
function AutosaveRows() {
  const enabled = useAutosaveStore((s) => s.enabled);
  const seconds = useAutosaveStore((s) => s.seconds);
  const loaded = useAutosaveStore((s) => s.loaded);
  const update = useAutosaveStore((s) => s.update);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [draft, setDraft] = useState(String(seconds));

  useEffect(() => {
    void useAutosaveStore.getState().load();
  }, []);
  useEffect(() => setDraft(String(seconds)), [seconds]);

  const change = async (patch: { enabled?: boolean; seconds?: number }) => {
    try {
      await update(patch);
    } catch (e: any) {
      addNotification("error", `Couldn't change autosave: ${e?.message || e}`);
    }
  };

  const commitSeconds = () => {
    const n = clampAutosaveSeconds(Number(draft));
    setDraft(String(n));
    if (n !== seconds) void change({ seconds: n });
  };

  return (
    <div style={{ fontSize: 13, marginBottom: 12 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
        <input
          type="checkbox"
          data-testid="setting-autosave"
          checked={enabled}
          disabled={!loaded}
          onChange={(e) => void change({ enabled: e.target.checked })}
          style={{ marginTop: 2 }}
        />
        <span>
          <span style={{ fontWeight: 500 }}>Autosave</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--pnv-text-muted)", marginTop: 2, maxWidth: 560 }}>
            Save the model's <code>.py</code> automatically after a pause in editing. Off, it changes only when you
            press Save, which is what you want if another editor (PyCharm) has the same file open. Autosave waits
            while the code has an error, and never saves when the file changed on disk, the model is locked, or it
            is a PsyNeuLink file that can't be edited here.
          </span>
        </span>
      </label>
      {enabled && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, marginLeft: 22, fontSize: 12 }}>
          after
          <input
            type="number"
            data-testid="setting-autosave-delay"
            min={AUTOSAVE_MIN_SECONDS}
            max={AUTOSAVE_MAX_SECONDS}
            step={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Kept as typed (#37): closing Settings with Escape or ✕ unmounts
              // the field without a blur, so waiting for blur or Enter lost it.
              // An out-of-range value waits for blur/Enter to be clamped.
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isInteger(n) && n === clampAutosaveSeconds(n) && n !== seconds)
                void change({ seconds: n });
            }}
            onBlur={commitSeconds}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSeconds();
            }}
            style={{ width: 60, fontSize: 12, padding: "2px 4px" }}
          />
          seconds without activity
          <span style={{ color: "var(--pnv-text-hint)" }}>
            ({AUTOSAVE_MIN_SECONDS}–{AUTOSAVE_MAX_SECONDS})
          </span>
        </label>
      )}
    </div>
  );
}

function SidecarPlacementDefaultRow() {
  const [value, setValue] = useState<string>("auto");
  const [loaded, setLoaded] = useState(false);
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    let alive = true;
    getPlacementDefault()
      .then((r) => alive && (setValue(r.placement), setLoaded(true)))
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const onChange = async (v: string) => {
    const prev = value;
    setValue(v); // optimistic
    try {
      const r = await setPlacementDefault(v as "auto" | "lateral" | "dotfolder");
      setValue(r.placement);
    } catch (e: any) {
      setValue(prev);
      addNotification("error", e?.message || "Couldn't update the placement default");
    }
  };

  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Sidecar files (new models)" htmlFor="setting-sidecar-placement">
        Where a new model's layout / label files go by default. Individual
        models can override this from the Layout menu. Existing files aren't
        moved — a model that already has files beside its <code>.py</code> keeps
        them there.
      </SettingLabel>
      <select
        id="setting-sidecar-placement"
        data-testid="setting-sidecar-placement"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!loaded}
        style={{ marginTop: 6, fontSize: 12, padding: "3px 6px" }}
      >
        <option value="auto">Auto — dot-folder for new models</option>
        <option value="lateral">Beside the .py</option>
        <option value="dotfolder">Hidden .psyneuview/</option>
      </select>
    </div>
  );
}

/**
 * When the wheel of patience appears (#38): anything that takes longer than
 * this shows it in the toolbar and where the result will appear.
 */
function BusyThresholdRow() {
  const ms = useBusyStore((s) => s.thresholdMs);
  const setMs = useBusyStore((s) => s.setThresholdMs);
  return (
    <div style={{ fontSize: 13 }}>
      <SettingLabel title="Show the busy wheel" htmlFor="setting-busy-threshold">
        When something takes a while (opening a model, saving, undo, a layout,
        a run), a spinning wheel and Working… show in the toolbar and over the
        graph, and the pointer shows it is busy. Anything quicker than this
        shows nothing.
      </SettingLabel>
      <select
        id="setting-busy-threshold"
        data-testid="setting-busy-threshold"
        value={ms}
        onChange={(e) => setMs(Number(e.target.value))}
        style={{ marginTop: 6, fontSize: 12, padding: "3px 6px" }}
      >
        {BUSY_THRESHOLDS.map((t) => (
          <option key={t.ms} value={t.ms}>
            {t.label}
            {t.ms === DEFAULT_BUSY_THRESHOLD_MS ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
