/**
 * #353: when an edit made on the graph breaks the model, say which edit.
 *
 * An edit made on the graph (adding a node, giving a mechanism a function,
 * connecting two nodes) is written into the code by the backend. When the
 * code it wrote does not run, the failure used to appear as an unexplained
 * error, sometimes only after some later action (#349). What is displayed must
 * match what happened: the warning names the edit and offers to undo it.
 *
 * The edit is blamed only when the line that failed is one it wrote.
 */

/** What kind of graph edit wrote the code. */
export type GraphEditKind = "add" | "function" | "connect";

/** The last edit made on the graph, and the code before it. */
export interface GraphEdit {
  kind: GraphEditKind;
  /** What it was done to, in words: a node's name, "decision's function to Logistic". */
  label: string;
  /** The code before the edit, which Undo puts back. */
  before: string;
}

/** The key of the warning, so a second failing load replaces it in place. */
export const GRAPH_EDIT_BROKE_KEY = "graph-edit-broke";

const VERB: Record<GraphEditKind, string> = {
  add: "Adding",
  function: "Setting",
  connect: "Connecting",
};

/**
 * The lines of `after` that the edit wrote (1-based, inclusive), or null when
 * nothing changed. The lines between the first and the last that differ, so
 * an edit that writes in two places (a declaration and its `add_node`) covers
 * both.
 */
export function writtenLines(before: string, after: string): { first: number; last: number } | null {
  if (before === after) return null;
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  // Only lines taken out: the edit wrote nothing, but the line where they were
  // is the one to point at.
  if (endB < start) return { first: start + 1, last: start + 1 };
  return { first: start + 1, last: endB + 1 };
}

/**
 * The warning for a load that failed at `errorLine` in `source`, when the
 * last graph edit wrote that line; otherwise null.
 */
export function blameGraphEdit(
  edit: GraphEdit | null | undefined,
  source: string,
  errorLine: number | null | undefined,
): string | null {
  if (!edit || !errorLine) return null;
  const range = writtenLines(edit.before, source);
  if (!range || errorLine < range.first || errorLine > range.last) return null;
  return `${VERB[edit.kind]} ${edit.label} broke the model at line ${errorLine}.`;
}
