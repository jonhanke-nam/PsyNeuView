/**
 * Which Tutorials-menu sections are folded (#8).
 *
 * The menu grew to three sections and 25 walkthroughs, so its headings fold
 * like the Open menu's. The choice is kept under a `psyneuview.` key, which
 * the Mac app carries across launches.
 *
 * First run (the key has never been written): First Steps stays open and the
 * rest start folded, so the menu opens short with the orientation on top. An
 * empty stored list is a deliberate "everything open" and is kept as is.
 */

export const TUTORIALS_FOLDED_KEY = "psyneuview.tutorials.foldedSections";

/** Sections folded on first run: all but PsyNeuView First Steps. */
export const DEFAULT_FOLDED_SECTIONS: readonly string[] = ["general", "psyneulink", "course"];

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadFoldedSections(storage: Storage | null = safeStorage()): Set<string> {
  try {
    const raw = storage?.getItem(TUTORIALS_FOLDED_KEY);
    if (raw === null || raw === undefined) return new Set(DEFAULT_FOLDED_SECTIONS);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set(DEFAULT_FOLDED_SECTIONS);
  } catch {
    return new Set(DEFAULT_FOLDED_SECTIONS);
  }
}

export function saveFoldedSections(folded: Set<string>, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(TUTORIALS_FOLDED_KEY, JSON.stringify(Array.from(folded)));
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}

/** The folded set with `id` toggled. */
export function toggleFolded(folded: Set<string>, id: string): Set<string> {
  const next = new Set(folded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The folded set with the running walkthrough's section opened, so the menu
 * shows where you are. Returns the same set when nothing changes.
 */
export function unfoldActive(
  folded: Set<string>,
  groups: readonly { id: string; walkthroughs: readonly { id: string }[] }[],
  activeTourId: string | null,
): Set<string> {
  if (!activeTourId) return folded;
  const group = groups.find((g) => g.walkthroughs.some((w) => w.id === activeTourId));
  if (!group || !folded.has(group.id)) return folded;
  const next = new Set(folded);
  next.delete(group.id);
  return next;
}
