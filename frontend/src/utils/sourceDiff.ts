/**
 * Line diff between two versions of a model's source. (#1093)
 *
 * A graph edit rewrites the .py file, but the user never sees what it wrote.
 * A tester's point was that this is not only a trust problem — it is a learning
 * one: "some of the graphical things I can do I am not sure how to do
 * programmatically". Showing the lines an edit added and removed turns the
 * graph into a way of reading the API.
 *
 * Implemented here rather than pulled from a library: the inputs are two
 * versions of one generated file, usually differing by a handful of lines, and
 * a longest-common-subsequence over lines is both small and exact. Snapshots
 * already store `source`, so no new state is needed — the diff is derived.
 */

export interface DiffLine {
  kind: "added" | "removed" | "context";
  text: string;
  /** 1-based line number in whichever side the line belongs to. */
  lineNumber: number;
}

export interface SourceDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the two sources are identical — an edit that changed nothing. */
  unchanged: boolean;
}

/**
 * Longest common subsequence over lines, as a table of match lengths.
 *
 * Bounded deliberately: this runs on every history-panel render, and the
 * quadratic table is fine for generated model files but not for something
 * pathological. Past the bound we report the change without the line detail
 * rather than locking the UI up.
 */
const MAX_LINES_FOR_DIFF = 2000;

export function diffSource(before: string, after: string): SourceDiff {
  if (before === after) {
    return { lines: [], added: 0, removed: 0, unchanged: true };
  }

  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length > MAX_LINES_FOR_DIFF || b.length > MAX_LINES_FOR_DIFF) {
    // Say what we know rather than pretend precision we didn't compute.
    return {
      lines: [],
      added: Math.max(0, b.length - a.length),
      removed: Math.max(0, a.length - b.length),
      unchanged: false,
    };
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "context", text: a[i], lineNumber: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i], lineNumber: i + 1 });
      removed++;
      i++;
    } else {
      lines.push({ kind: "added", text: b[j], lineNumber: j + 1 });
      added++;
      j++;
    }
  }
  while (i < a.length) {
    lines.push({ kind: "removed", text: a[i], lineNumber: i + 1 });
    removed++;
    i++;
  }
  while (j < b.length) {
    lines.push({ kind: "added", text: b[j], lineNumber: j + 1 });
    added++;
    j++;
  }

  return { lines, added, removed, unchanged: added === 0 && removed === 0 };
}

/**
 * Drop context lines that are far from any change, so the panel shows the edit
 * rather than the whole file. Runs of elided lines become a single gap marker,
 * which the caller renders as "…".
 */
export function condense(diff: SourceDiff, context = 2): DiffLine[] {
  if (diff.lines.length === 0) return [];
  const keep = new Set<number>();
  diff.lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < diff.lines.length) keep.add(k);
    }
  });

  const out: DiffLine[] = [];
  let skipping = false;
  diff.lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push({ kind: "context", text: "…", lineNumber: line.lineNumber });
      skipping = true;
    }
  });
  return out;
}

/** One-line summary, e.g. "+3 −1". */
export function summarize(diff: SourceDiff): string {
  if (diff.unchanged) return "no change to the code";
  const parts: string[] = [];
  if (diff.added) parts.push(`+${diff.added}`);
  if (diff.removed) parts.push(`−${diff.removed}`);
  return parts.join(" ");
}
