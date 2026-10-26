// When to say an app update is waiting (PsyNeuView-MacApp#6).
//
// Inside the Mac app, a small notice in the toolbar says a newer version is
// ready, with Install… opening the app's own update window. "Later" hides it
// for that version for a day; a newer version shows again at once. In a
// browser there is no app and no notice.

import type { MacAppInfo, MacAppSettings, MacAppUpdate } from "./macAppSettings";
import { ago } from "./runningFrom";

export const UPDATE_NOTICE_DISMISS_KEY = "psyneuview.appUpdate.dismissed";
export const UPDATE_NOTICE_SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface Dismissal {
  version: string;
  /** When "Later" was pressed, in ms since the epoch. */
  at: number;
}

/** Show the notice? Only for a waiting update not put off within the last day. */
export function shouldShowUpdateNotice(
  update: MacAppUpdate | null | undefined,
  dismissal: Dismissal | null,
  now: number,
): boolean {
  if (!update?.available || !update.version) return false;
  if (dismissal && dismissal.version === update.version && now - dismissal.at < UPDATE_NOTICE_SNOOZE_MS) {
    return false;
  }
  return true;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDismissal(s: Pick<Storage, "getItem"> | null = storage()): Dismissal | null {
  try {
    const raw = s?.getItem(UPDATE_NOTICE_DISMISS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return typeof d?.version === "string" && typeof d?.at === "number" ? d : null;
  } catch {
    return null;
  }
}

export function saveDismissal(
  version: string,
  now: number,
  s: Pick<Storage, "setItem"> | null = storage(),
): Dismissal {
  const d = { version, at: now };
  try {
    s?.setItem(UPDATE_NOTICE_DISMISS_KEY, JSON.stringify(d));
  } catch {
    // Storage blocked: "Later" lasts until the page reloads. Nothing else to do.
  }
  return d;
}

/**
 * The notice's words: "PsyNeuView 0.6.5 is available, released …", and for a
 * release candidate "PsyNeuView 0.6.5-rc1 (release candidate) is available",
 * so a person who asked for candidates knows they're getting a test version.
 */
export function updateNoticeText(update: MacAppUpdate, now: Date = new Date()): string {
  const released = releasedPhrase(update.releasedAt, now);
  const what = update.candidate ? `${update.version} (release candidate)` : update.version;
  return `PsyNeuView ${what} is available${released ? `, ${released}` : ""}`;
}

/**
 * "Oct 15, 2:33 PM (2 hours ago)" (#15), in the viewer's time zone, with the
 * year only when it isn't this year; null when the date is unknown.
 */
export function datePhrase(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const when = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  const since = ago(iso, now);
  return `${when}${since ? ` (${since})` : ""}`;
}

/** "released Oct 15, 2:33 PM (2 hours ago)", or null when the date is unknown. */
export function releasedPhrase(iso: string | null | undefined, now: Date = new Date()): string | null {
  const when = datePhrase(iso, now);
  return when ? `released ${when}` : null;
}

/**
 * Settings ▸ About's "Mac app" row (#15): "0.6.2, built Oct 15, 6:33 PM
 * (2 hours ago)", with the build number when it differs. Null for an app
 * from before #15, which says nothing about itself.
 */
export function macAppLine(app: MacAppInfo | null | undefined, now: Date = new Date()): string | null {
  if (!app?.version) return null;
  let line = app.version;
  if (app.build && app.build !== app.version) line += ` (build ${app.build})`;
  const built = datePhrase(app.builtAt, now);
  return built ? `${line}, built ${built}` : line;
}

/**
 * The PsyNeuView version, with when it was released (#15) when what runs is
 * the copy included with the Mac app and the app knows that copy's date.
 */
export function psyneuviewVersionLine(
  version: string,
  mac: Pick<MacAppSettings, "install"> | null | undefined,
  now: Date = new Date(),
): string {
  const install = mac?.install;
  if (install?.choice !== "bundled" || install.includedVersion !== version) return version;
  const released = releasedPhrase(install.includedReleasedAt, now);
  return released ? `${version}, ${released}` : version;
}
