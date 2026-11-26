/**
 * The one-time notice when model files share a name in the PsyNeuLink in use (#422).
 *
 * The server checks the active PsyNeuLink (`/api/psyneulink/name-clashes`);
 * the page asks at start and after a source switch. When something clashes it
 * records the clashes in the activity log and shows a warning naming them —
 * once per source and commit (`key`), not on every start.
 */

import { record } from "@/utils/activityLog";

export const NAME_CLASHES_SEEN_KEY = "psyneuview.nameClashesSeen";

export interface NameClashAnswer {
  clashes: { stem: string; files: string[]; kind: string }[];
  key: string | null;
  message: string | null;
}

/** Whether this answer should be shown: it has clashes and its key is new. */
export function isNewClash(answer: NameClashAnswer, seen: string | null): boolean {
  return answer.clashes.length > 0 && !!answer.key && answer.key !== seen;
}

export async function checkNameClashes(warn: (message: string) => void): Promise<void> {
  let answer: NameClashAnswer;
  try {
    const resp = await fetch("/api/psyneulink/name-clashes");
    if (!resp.ok) return;
    answer = (await resp.json()) as NameClashAnswer;
  } catch {
    return;
  }
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(NAME_CLASHES_SEEN_KEY);
  } catch {
    // Storage blocked: shown this time, as if new.
  }
  if (!isNewClash(answer, seen)) return;
  record("psyneulink", answer.message ?? "Model files share a name in this PsyNeuLink", {
    clashes: answer.clashes,
  });
  warn(`${answer.message} PsyNeuView names models by file name, so these can be confused.`);
  try {
    localStorage.setItem(NAME_CLASHES_SEEN_KEY, answer.key as string);
  } catch {
    // Nothing to remember it in.
  }
}
