// When to say an app update is waiting (PsyNeuView-MacApp#6).
//
// Inside the Mac app, a small notice in the toolbar says a newer version is
// ready, with Install… opening the app's own update window. "Later" hides it
// for that version for a day; a newer version shows again at once. In a
// browser there is no app and no notice.

import type { MacAppUpdate } from "./macAppSettings";

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
