/**
 * A line diff, for comparing the file now against the version that last built
 * (#1154).
 *
 * Hand-rolled rather than pulled from a package: this renders a read-only
 * diagnostic of two versions of one file, which is the case a plain
 * longest-common-subsequence handles well. A dependency would buy word-level
 * refinement and rename detection that nothing here asks for.
 *
 * The LCS table is O(n·m) in lines. Model files are hundreds of lines, so that
 * is nothing; `MAX_LINES` keeps a pathological input from freezing the tab
 * rather than because any real model approaches it.
 */

export type DiffRowKind = "same" | "added" | "removed";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  /** 1-based line number in the older text, when the row exists there. */
  leftNo: number | null;
  /** 1-based line number in the newer text, when the row exists there. */
  rightNo: number | null;
}

const MAX_LINES = 5000;

/** Rows describing how to get from `before` to `after`, oldest line first. */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    // Degrade to "everything changed" rather than stalling: still truthful,
    // just not minimal.
    return [
      ...a.map((text, i) => ({ kind: "removed" as const, text, leftNo: i + 1, rightNo: null })),
      ...b.map((text, i) => ({ kind: "added" as const, text, leftNo: null, rightNo: i + 1 })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i], leftNo: i + 1, rightNo: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: "removed", text: a[i], leftNo: i + 1, rightNo: null });
      i++;
    } else {
      rows.push({ kind: "added", text: b[j], leftNo: null, rightNo: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    rows.push({ kind: "removed", text: a[i], leftNo: i + 1, rightNo: null });
    i++;
  }
  while (j < b.length) {
    rows.push({ kind: "added", text: b[j], leftNo: null, rightNo: j + 1 });
    j++;
  }
  return rows;
}

/** Whether anything actually differs — cheaper to read than scanning rows. */
export function hasChanges(rows: DiffRow[]): boolean {
  return rows.some((r) => r.kind !== "same");
}

/**
 * Drop long runs of unchanged lines, keeping `context` either side of a change.
 *
 * Without this the interesting two lines sit in three hundred identical ones.
 * A gap is reported rather than silently removed, so the reader knows the
 * distance rather than assuming adjacency.
 */
export function collapseUnchanged(
  rows: DiffRow[],
  context = 3,
): Array<DiffRow | { kind: "gap"; hidden: number }> {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, idx) => {
    if (row.kind === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) {
      keep[k] = true;
    }
  });

  const out: Array<DiffRow | { kind: "gap"; hidden: number }> = [];
  let hidden = 0;
  rows.forEach((row, idx) => {
    if (keep[idx]) {
      if (hidden > 0) {
        out.push({ kind: "gap", hidden });
        hidden = 0;
      }
      out.push(row);
    } else {
      hidden++;
    }
  });
  if (hidden > 0) out.push({ kind: "gap", hidden });
  return out;
}

/** How many lines a diff adds and removes; a changed line counts once each way. */
export interface ChangeCounts {
  added: number;
  removed: number;
}

export function countChanges(rows: DiffRow[]): ChangeCounts {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "added") added++;
    else if (r.kind === "removed") removed++;
  }
  return { added, removed };
}

/**
 * The one-line summary at the top of "Changes since save" (#1348):
 * "No changes", or "3 lines added, 1 removed". Plain words, the larger unit
 * first, and a side that has nothing is left out rather than shown as zero.
 */
export function describeChanges({ added, removed }: ChangeCounts): string {
  if (added === 0 && removed === 0) return "No changes";
  const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
  if (removed === 0) return `${lines(added)} added`;
  if (added === 0) return `${lines(removed)} removed`;
  return `${lines(added)} added, ${removed} removed`;
}

/** One row of a side-by-side diff: the older text on the left, the newer on the right. */
export type SplitRow =
  | { kind: "gap"; hidden: number }
  | { kind: "pair"; left: DiffRow | null; right: DiffRow | null };

/**
 * Lay unified rows out side by side (#1348). A run of removals followed by a
 * run of additions is a change, so the two runs are set beside each other,
 * line for line, with blanks where one side is longer; unchanged lines sit on
 * both sides; a gap stays a gap across the full width.
 */
export function toSideBySide(rows: Array<DiffRow | { kind: "gap"; hidden: number }>): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "gap") {
      out.push(row);
      i++;
    } else if (row.kind === "same") {
      out.push({ kind: "pair", left: row, right: row });
      i++;
    } else {
      const removed: DiffRow[] = [];
      const added: DiffRow[] = [];
      while (i < rows.length && rows[i].kind === "removed") removed.push(rows[i++] as DiffRow);
      while (i < rows.length && rows[i].kind === "added") added.push(rows[i++] as DiffRow);
      for (let k = 0; k < Math.max(removed.length, added.length); k++) {
        out.push({ kind: "pair", left: removed[k] ?? null, right: added[k] ?? null });
      }
    }
  }
  return out;
}
