/**
 * Saves in History (#1349): the rules, as plain functions, so they can be
 * tested without a browser.
 *
 * A save is a mark on the step whose text it wrote (`Snapshot.saves`, see
 * historyStore.ts). From the marks History draws a line under each saved
 * step, and decides where "Revert the file to this save" is offered:
 *
 *  - for a save whose text is not what the file holds now. PsyNeuView's idea
 *    of the file is `savedSource` (the text it last opened, saved or took
 *    from disk), so the latest save is normally excluded, and so is any
 *    earlier one that wrote the same text;
 *  - never for a model that can't be saved here: no file, locked (view only),
 *    or a PsyNeuLink file that can't be edited here. The revert *is* a Save,
 *    so what stops Save stops it.
 *
 * Writing to disk is always the user's choice: undo never writes the file,
 * and a revert asks first, showing what will change.
 */

import { sameSource, type SaveMark, type Snapshot } from "@/stores/historyStore";

/** One save as History lists it. */
export interface SaveEntry {
  /** Index of its step in `[...past, ...future]`. */
  index: number;
  snapshot: Snapshot;
  mark: SaveMark;
}

/** Every save in the history, oldest first. */
export function listSaves(entries: Snapshot[]): SaveEntry[] {
  const out: SaveEntry[] = [];
  entries.forEach((snapshot, index) => {
    for (const mark of snapshot.saves ?? []) out.push({ index, snapshot, mark });
  });
  return out;
}

/** The most recent save, by time (a redo step can hold it after an undo). */
export function latestSave(entries: Snapshot[]): SaveEntry | null {
  let best: SaveEntry | null = null;
  for (const s of listSaves(entries)) if (!best || s.mark.at >= best.mark.at) best = s;
  return best;
}

/** "14:32" (or "2:32 PM"), in the user's locale, with seconds only when asked. */
export function formatSaveTime(at: number, withSeconds = false): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

/** The marker's words: "Saved 14:32", "Autosaved 14:32", "Saved 14:40 (reverted to 14:32)". */
export function saveLabel(mark: SaveMark, withSeconds = false): string {
  const t = formatSaveTime(mark.at, withSeconds);
  if (mark.kind === "auto") return `Autosaved ${t}`;
  if (mark.kind === "revert" && mark.revertedTo !== undefined)
    return `Saved ${t} (reverted to ${formatSaveTime(mark.revertedTo, withSeconds)})`;
  return `Saved ${t}`;
}

/**
 * Whether the markers need seconds to tell saves apart: true when two saves
 * fall in the same minute, which "Saved 14:32" twice would leave ambiguous.
 */
export function needsSeconds(marks: SaveMark[]): boolean {
  const seen = new Set<string>();
  for (const m of marks) {
    const minute = formatSaveTime(m.at);
    if (seen.has(minute)) return true;
    seen.add(minute);
    if (m.revertedTo !== undefined) seen.add(formatSaveTime(m.revertedTo));
  }
  return false;
}

/** The marker's tooltip. */
export function saveTooltip(mark: SaveMark): string {
  const when = new Date(mark.at).toLocaleString();
  if (mark.kind === "auto") return `Saved automatically at ${when}: autosave is on (Settings ▸ General ▸ Model files).`;
  if (mark.kind === "revert") return `Saved at ${when}, by Revert the file to this save.`;
  return `Saved at ${when}.`;
}

/** Why a revert can't be offered for this model, or null when it can. */
export type RevertBlock = "noFile" | "locked" | "protected";

export function revertBlock(i: { filePath: string | null; viewOnly: boolean; pnlProtected: boolean }): RevertBlock | null {
  if (!i.filePath) return "noFile";
  if (i.pnlProtected) return "protected";
  if (i.viewOnly) return "locked";
  return null;
}

export function revertBlockReason(b: RevertBlock): string {
  if (b === "protected") return "This PsyNeuLink file can't be edited here, so it can't be reverted.";
  if (b === "locked") return "The model is locked (view only); unlock it to revert the file.";
  return "There is no file to revert.";
}

/** True when the file holds something other than this save: reverting would change it. */
export function canRevertTo(save: SaveEntry, savedSource: string): boolean {
  return !sameSource(save.snapshot, savedSource);
}

/**
 * Where undo has left you, when that is a save the file no longer holds: the
 * current step carries a save mark and its text is not on disk. History then
 * says so at the top and offers the revert (#1349 item 2).
 */
export function saveAtPosition(past: Snapshot[], savedSource: string): SaveEntry | null {
  const index = past.length - 1;
  const top = past[index];
  if (!top?.saves?.length || sameSource(top, savedSource)) return null;
  return { index, snapshot: top, mark: top.saves[top.saves.length - 1] };
}

/**
 * The step whose text is on disk now, for the "on disk" tag: the newest step
 * holding `savedSource`, or -1 when none does (the file was saved before the
 * history began, or changed since).
 */
export function onDiskIndex(entries: Snapshot[], savedSource: string): number {
  for (let i = entries.length - 1; i >= 0; i--) if (sameSource(entries[i], savedSource)) return i;
  return -1;
}

/**
 * What the counts line says about how deep History goes (#558). It keeps
 * every step, holding older ones compactly, unless even that outgrows its
 * memory budget, when the oldest go and it says how many.
 */
export function depthLabel(evicted: number, totalBytes: number): { text: string; title: string } {
  const mb = Math.round(totalBytes / (1024 * 1024));
  const how =
    "Older steps are kept compactly: their code and layout, with the graph rebuilt from the code when you undo that far.";
  const scope = "Opening a model starts it afresh, and it isn't kept when you quit.";
  if (evicted === 0) {
    return {
      text: "keeps every step",
      title: `History keeps every step of this session. ${how} Only past about ${mb} MB would the oldest be dropped. ${scope}`,
    };
  }
  return {
    text: `keeps about ${mb} MB; ${evicted} oldest dropped`,
    title: `History keeps about ${mb} MB of steps. ${how} This session outgrew that, so its ${evicted} oldest steps were dropped. ${scope}`,
  };
}
