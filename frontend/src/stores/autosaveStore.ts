/**
 * Autosave (#1347): the setting, and what the toolbar status needs to know.
 *
 * The setting is stored by the backend in the app preferences, beside the
 * sidecar-placement default (Settings ▸ General ▸ Model files), and loaded
 * once when the page starts. The rules are in utils/autosave.ts and the
 * timer in hooks/useAutosave.ts.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";
import { AUTOSAVE_DEFAULT_SECONDS } from "@/utils/autosave";

export interface AutosaveSetting {
  enabled: boolean;
  seconds: number;
}

interface AutosaveState extends AutosaveSetting {
  loaded: boolean;
  /** Saves (manual or automatic) in flight, counted by the editor's save routine. */
  savesInFlight: number;
  /** An autosave has been requested and has not finished. */
  autosaving: boolean;
  /** The file last autosaved, and when; the status shows it only for that file. */
  lastAutosaved: { filePath: string; at: number } | null;
  /** The last autosave for this file did not save. */
  lastFailedPath: string | null;
  /** The open file changed on disk under unsaved edits; paused until a Save or reload. */
  diskChangedPath: string | null;
  /** The idle time has passed and a save is owed (something is stopping it). */
  due: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AutosaveSetting>) => Promise<void>;
  beginSave: () => () => void;
}

async function post(patch: Partial<AutosaveSetting>): Promise<AutosaveSetting> {
  const resp = await fetch("/api/settings/autosave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      detail = (await resp.json()).detail ?? detail;
    } catch {
      // keep the status text
    }
    throw new Error(String(detail));
  }
  return resp.json();
}

export const useAutosaveStore = create<AutosaveState>((set, get) => ({
  enabled: false,
  seconds: AUTOSAVE_DEFAULT_SECONDS,
  loaded: false,
  savesInFlight: 0,
  autosaving: false,
  lastAutosaved: null,
  lastFailedPath: null,
  diskChangedPath: null,
  due: false,

  load: async () => {
    try {
      const resp = await fetch("/api/settings/autosave");
      if (!resp.ok) return;
      const data = (await resp.json()) as AutosaveSetting;
      set({ enabled: !!data.enabled, seconds: data.seconds, loaded: true });
    } catch {
      // Unknown means off: the default, and the safe side.
    }
  },

  update: async (patch) => {
    const before = { enabled: get().enabled, seconds: get().seconds };
    set(patch); // optimistic; put back if the backend refuses
    try {
      const saved = await post(patch);
      set({ enabled: saved.enabled, seconds: saved.seconds, loaded: true });
      if (patch.enabled !== undefined) recordSettingChanged("autosave", saved.enabled);
      if (patch.seconds !== undefined) recordSettingChanged("autosave-delay", saved.seconds);
    } catch (e) {
      set(before);
      throw e;
    }
  },

  beginSave: () => {
    set((s) => ({ savesInFlight: s.savesInFlight + 1 }));
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      set((s) => ({ savesInFlight: Math.max(0, s.savesInFlight - 1) }));
    };
  },
}));
