// Settings bridge to the macOS app (jonhanke-nam/PsyNeuView-MacApp#200).
//
// There is one Settings: this app's. Inside the Mac app, ⌘, opens it too, and
// the settings only the app can act on — which PsyNeuView install runs,
// auto-restart, launch at login, problem reports — appear in the sections
// they belong to (#1290). They're read and
// written through a WKScriptMessageHandlerWithReply named "pnvSettings", the
// same pattern as the pnvFile bridge (fileBridge.ts). In a browser there is
// no bridge, those parts aren't shown, and nothing else changes.
//
// Contract (the Mac app's half: Services/SettingsBridge.swift):
//   postMessage({ op: "get" })                         -> MacAppSettings
//   postMessage({ op: "set", key, value: boolean })    -> MacAppSettings
//     (key: autoRestart | launchAtLogin | developerMode | receiveReleaseCandidates)
//   postMessage({ op: "set", key: "reportSendWith" | "reportSendTo",
//                 value: string })                    -> MacAppSettings
//   postMessage({ op: "checkInstall",  choice, path? }) -> InstallVerdict
//   postMessage({ op: "switchInstall", choice, path? }) -> InstallVerdict
//   postMessage({ op: "installUpdate" })               -> MacAppSettings
//     (opens the app's own update window; PsyNeuView-MacApp#6)
//   postMessage({ op: "syncPnlSource" })               -> MacAppSettings
//     (the app re-reads the installed PsyNeuLink and makes its record match;
//      PsyNeuView-MacApp#9)
// A refused or malformed message rejects the Promise with the reason.
// The app sends window events: "pnv:mac-settings-changed" (detail:
// MacAppSettings) after any change, and "pnv:open-settings" for ⌘,.

import { record, recordSettingChanged } from "./activityLog";

export interface MacAppInstall {
  /** One plain line: "PsyNeuView 0.5.14, included with this app", or the checkout. */
  running: string;
  choice: "bundled" | "checkout";
  checkoutPath: string | null;
  /** The version the app carries; null when this build has none. */
  includedVersion: string | null;
  /** Checkouts used before, most recent first. */
  recentCheckouts: string[];
  /** When the included version was released, an ISO time (#15); absent or null when unknown. */
  includedReleasedAt?: string | null;
}

/** The Mac app itself (#15); absent from app builds before it. */
export interface MacAppInfo {
  name: string;
  version: string | null;
  build: string | null;
  /** When this app was built, an ISO time; null for a build with no stamp. */
  builtAt: string | null;
}

export interface MacAppSettings {
  install: MacAppInstall;
  autoRestart: boolean;
  launchAtLogin: boolean;
  /** Developer mode's control is in Preferences; the app keeps the value. */
  developerMode: boolean;
  /**
   * How Report a Problem offers to send a saved report
   * (PsyNeuView-MacApp#202). Absent from app builds before it.
   */
  reportSendWith?: ReportSendWith;
  /** The address reports go to; empty means `reportSendToDefault`. */
  reportSendTo?: string;
  /** Who reports go to when "Send to" is empty. The app's, never written here. */
  reportSendToDefault?: string;
  /**
   * Whether an app update is waiting (PsyNeuView-MacApp#6). Absent from app
   * builds before it, which the page treats as "none waiting".
   */
  appUpdate?: MacAppUpdate;
  app?: MacAppInfo;
  /**
   * The app's record of where PsyNeuLink comes from (PsyNeuView-MacApp#9):
   * "github:<branch>", "pypi" or "local:<path>". It decides what a later
   * environment rebuild installs. Absent from app builds before it.
   */
  pnlRecord?: string;
  /**
   * Whether the app's update notice also offers release candidates
   * (Settings ▸ Developer ▸ Get release candidates). Absent from app builds
   * that can't, which hide the switch.
   */
  receiveReleaseCandidates?: boolean;
}

export interface MacAppUpdate {
  available: boolean;
  /** The waiting version, as people read it; present when available. */
  version?: string;
  releaseNotesURL?: string | null;
  /** When it was released, an ISO time (#15); null or absent when unknown. */
  releasedAt?: string | null;
  /** True when the waiting version is a release candidate, a test version. */
  candidate?: boolean;
}

export type ReportSendWith = "ask" | "mail" | "outlook" | "gmail";

export type MacAppSwitchKey = "autoRestart" | "launchAtLogin" | "receiveReleaseCandidates";

export interface InstallChoice {
  choice: "bundled" | "checkout";
  path?: string;
}

export interface InstallVerdict {
  decision: "nothingToDo" | "useBundled" | "useCheckout" | "refuse";
  message: string;
  path?: string;
}

export const MAC_SETTINGS_CHANGED = "pnv:mac-settings-changed";
export const OPEN_SETTINGS = "pnv:open-settings";

const bridge = () => (window as any).webkit?.messageHandlers?.pnvSettings;

/** True only inside the Mac app (a build that has the settings bridge). */
export const hasSettingsBridge = (): boolean => typeof window !== "undefined" && !!bridge();

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const h = bridge();
  if (!h) throw new Error("Not running in the Mac app");
  return (await h.postMessage(body)) as T;
}

export const getMacAppSettings = () => post<MacAppSettings>({ op: "get" });

const MAC_SETTING_IDS: Record<MacAppSwitchKey, string> = {
  autoRestart: "mac-auto-restart",
  launchAtLogin: "mac-launch-at-login",
  receiveReleaseCandidates: "mac-release-candidates",
};

export const setMacAppSetting = (key: MacAppSwitchKey | "developerMode", value: boolean) => {
  // Developer mode is recorded by its one control (uiStore); the app's copy
  // follows it. The two switches of the app's own are recorded here (#1287).
  if (key !== "developerMode") recordSettingChanged(MAC_SETTING_IDS[key], value);
  return post<MacAppSettings>({ op: "set", key, value });
};

export const setMacAppReportSetting = (
  key: "reportSendWith" | "reportSendTo",
  value: string,
) => {
  // The address reports go to is personal: recorded as changed, never what to.
  if (key === "reportSendWith") recordSettingChanged("mac-report-send-with", value);
  else recordSettingChanged("mac-report-send-to");
  return post<MacAppSettings>({ op: "set", key, value });
};

/**
 * Ask the app to re-read the installed PsyNeuLink and bring its record in
 * step (PsyNeuView-MacApp#9). A no-op without the bridge (a browser), and
 * harmless with an app that doesn't know the op: the rejection is swallowed.
 */
export const syncMacAppPnlSource = async (): Promise<MacAppSettings | null> => {
  if (!hasSettingsBridge()) return null;
  try {
    return await post<MacAppSettings>({ op: "syncPnlSource" });
  } catch {
    return null;
  }
};

/** Open the app's own update window for the waiting update (PsyNeuView-MacApp#6). */
export const installMacAppUpdate = () => {
  record("menu", "Mac app: install the waiting update");
  return post<MacAppSettings>({ op: "installUpdate" });
};

export const checkInstall = (c: InstallChoice) => post<InstallVerdict>({ op: "checkInstall", ...c });

export const switchInstall = async (c: InstallChoice) => {
  record("psyneulink", `Mac app: switch which PsyNeuView runs to ${c.choice}${c.path ? ` at ${c.path}` : ""}`, { ...c });
  const verdict = await post<InstallVerdict>({ op: "switchInstall", ...c });
  record("psyneulink", `Mac app: ${verdict.decision} — ${verdict.message}`, { decision: verdict.decision });
  return verdict;
};

/** Call `listener` with the new values whenever the app reports a change. */
export function onMacAppSettingsChanged(listener: (s: MacAppSettings) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail === "object") listener(detail as MacAppSettings);
  };
  window.addEventListener(MAC_SETTINGS_CHANGED, handler);
  return () => window.removeEventListener(MAC_SETTINGS_CHANGED, handler);
}

/**
 * Call `open` when the Mac app asks for Settings (⌘,).
 *
 * The app sets `window.__pnvOpenSettingsRequested` as well as sending the
 * event, so a request made before this listener existed — the page was still
 * starting — is picked up here instead of lost. Listener first, then the flag:
 * a request can't fall between the two.
 */
export function onOpenSettingsRequest(open: () => void): () => void {
  const w = window as any;
  const handle = () => {
    if (!w.__pnvOpenSettingsRequested) return;
    w.__pnvOpenSettingsRequested = false;
    open();
  };
  window.addEventListener(OPEN_SETTINGS, handle);
  handle();
  return () => window.removeEventListener(OPEN_SETTINGS, handle);
}

/**
 * Keep developer mode in step with the Mac app, inside it.
 *
 * Developer mode has one control, Settings ▸ Developer. Inside the Mac app
 * the app keeps the value: the page's own storage starts empty on every
 * launch there (the app serves it from a new port each time, so a new origin),
 * and the app needs the value before the page loads. So the page adopts the
 * app's value when it starts and tells the app when the toggle changes.
 */
export function syncDeveloperModeWithMacApp(store: {
  get: () => boolean;
  set: (on: boolean) => void;
  subscribe: (listener: (on: boolean) => void) => () => void;
}): () => void {
  if (!hasSettingsBridge()) return () => {};
  let known: boolean | null = null;
  const adopt = (on: boolean) => {
    known = on;
    if (store.get() !== on) store.set(on);
  };
  const unsubscribeStore = store.subscribe((on) => {
    if (on === known) return;
    known = on;
    setMacAppSetting("developerMode", on).catch(() => {});
  });
  const unsubscribeApp = onMacAppSettingsChanged((s) => adopt(!!s.developerMode));
  getMacAppSettings()
    .then((s) => adopt(!!s.developerMode))
    .catch(() => {});
  return () => {
    unsubscribeStore();
    unsubscribeApp();
  };
}
