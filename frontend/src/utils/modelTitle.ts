/**
 * What the toolbar title says about the open model, and what it drops when
 * space runs out (#422).
 *
 * The server says which model a file is (`/api/model/identity`, and the
 * `identity` on every open): its menu label, its file name and where it came
 * from. This module turns that into the parts the title shows, in priority
 * order, and fits them to the width there is:
 *
 *   1. the label (for the user's own file, the file name is the label);
 *   2. the file name;
 *   3. the source tag (Reference, Library, Example, Demo, Your file);
 *   4. the folder (the user's own file only).
 *
 * When they don't fit, parts go from the end: the folder first, then the tag,
 * then the file name. Then the label is shortened in the middle, keeping its
 * start and its author/year end. The label is never hidden entirely. The
 * full text is always on hover and in the model card. Written down in
 * docs/file-conventions.md ("Which model is open").
 */

export type ModelSource = "reference" | "library" | "example" | "demo" | "user";

export interface ModelIdentity {
  source: ModelSource;
  /** The menu label; null for the user's own file. */
  label: string | null;
  /** The file name, `Cohen_Huston1994.py`. */
  file: string;
  /** The full path of the file that is open. */
  path: string;
  /** The catalog file this working copy was made from, if it is one. */
  original?: string | null;
  workingCopy?: boolean;
}

export const SOURCE_TAG: Record<ModelSource, string> = {
  reference: "Reference",
  library: "Library",
  example: "Example",
  demo: "Demo",
  user: "Your file",
};

export const SOURCE_DESCRIPTION: Record<ModelSource, string> = {
  reference: "A Reference Model bundled with PsyNeuView",
  library: "A model in the PsyNeuLink Library",
  example: "One of PsyNeuLink's own examples",
  demo: "A demo bundled with PsyNeuView",
  user: "Your own file",
};

export interface TitleParts {
  label: string;
  file: string | null;
  tag: string;
  folder: string | null;
}

/** The home folder as `~`, as everywhere else the app shows a path. */
export function abbreviateHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

/**
 * A folder shortened to its last two names: `~/…/projects/stroop`. The full
 * path is on hover and in the model card.
 */
export function shortFolder(path: string): string {
  const dir = abbreviateHome(path.replace(/\/[^/]*$/, ""));
  const parts = dir.split("/");
  if (parts.length <= 4) return dir;
  return [parts[0], "…", ...parts.slice(-2)].join("/");
}

/** The parts of the title, in priority order, before any fitting. */
export function titleParts(id: ModelIdentity): TitleParts {
  const user = id.source === "user" || !id.label;
  return {
    label: user ? id.file : (id.label as string),
    file: user ? null : id.file,
    tag: SOURCE_TAG[id.source],
    folder: id.source === "user" ? shortFolder(id.path) : null,
  };
}

/** The label's author/year end: a closing parenthesis group, "(Cohen & Huston 1994)". */
const AUTHOR_END = /\s*\([^()]*\)$/;

/**
 * The label shortened to at most `max` characters, in the middle: its start
 * and its author/year end stay. Never empty — at worst its first character
 * and an ellipsis.
 */
export function shortenLabel(label: string, max: number): string {
  if (label.length <= max) return label;
  const keep = Math.max(1, max - 1); // room for the ellipsis
  const end = label.match(AUTHOR_END)?.[0].trim() ?? "";
  // Keep the whole author/year end when it leaves at least 4 characters of start.
  if (end && keep - end.length - 1 >= 4) {
    const head = label.slice(0, keep - end.length - 1).trimEnd();
    return `${head}… ${end}`;
  }
  const headLen = Math.ceil(keep / 2);
  const tailLen = keep - headLen;
  return `${label.slice(0, headLen).trimEnd()}…${tailLen > 0 ? label.slice(-tailLen).trimStart() : ""}`;
}

/** Width of a part as shown; the tag includes its padding and border. */
export type Measure = (text: string, part: keyof TitleParts) => number;

/**
 * Fit the parts to `available` pixels by the rule above. `gap` is the space
 * between shown parts (the " · " or the flex gap).
 */
export function fitTitle(parts: TitleParts, available: number, measure: Measure, gap = 8): TitleParts {
  const width = (p: TitleParts) => {
    const shown = (["label", "file", "tag", "folder"] as const).filter((k) => p[k]);
    return shown.reduce((sum, k) => sum + measure(p[k] as string, k), 0) + gap * Math.max(0, shown.length - 1);
  };
  let out = { ...parts };
  for (const drop of ["folder", "tag", "file"] as const) {
    if (width(out) <= available) return out;
    out = { ...out, [drop]: null };
  }
  if (width(out) <= available) return out;
  // Longest shortened label that fits, never below one character.
  let lo = 1;
  let hi = parts.label.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(shortenLabel(parts.label, mid), "label") <= available) lo = mid;
    else hi = mid - 1;
  }
  return { ...out, label: shortenLabel(parts.label, lo) };
}

/** The window or tab title: the label, then the app. */
export function windowTitle(id: ModelIdentity | null): string {
  if (!id) return "PsyNeuView";
  return `${id.label ?? id.file} — PsyNeuView`;
}
