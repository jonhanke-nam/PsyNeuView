/**
 * Did this edit break the model? (#1367)
 *
 * A syntax error stops the whole file, so the preview comes back with no
 * compositions and an error, and the graph is held with the stale banner
 * (#1030). A statement that parses but fails when it runs is different: the
 * backend skips it and builds the rest (#615), so the preview comes back with
 * a graph and a list of skipped statements, and no error at all. Typed in the
 * editor (an undefined name, a misspelt class), the line you just wrote then
 * silently does nothing, and nothing says so.
 *
 * This picks out a statement the edit broke: skipped now, and not skipped in
 * the build already on screen. Two kinds of skip are not breakage:
 *  - one the shown build skipped too: a library model's module-level driver
 *    that reads results after the no-op'd run (#796) is skipped on every
 *    build, and must not hold the graph on every keystroke;
 *  - a dangling projection (a projection to a node not defined yet), which the
 *    graph draws with a phantom endpoint (#615, the incomplete-model tutorial).
 */

export interface SkippedStatement {
  line: number | null;
  error: string;
}

/**
 * The first statement skipped in `skipped` that `shownSkippedErrors` does not
 * account for and that is not a dangling projection, or null.
 *
 * Matched by error message rather than line: an edit above a skipped
 * statement moves its line but not its message. Each shown error accounts for
 * one skip, so a second copy of the same failure still counts as new.
 */
export function newlyBrokenStatement(
  skipped: readonly SkippedStatement[] | undefined,
  shownSkippedErrors: readonly string[],
  danglingLines: ReadonlySet<number>,
): SkippedStatement | null {
  if (!skipped?.length) return null;
  const remaining = new Map<string, number>();
  for (const e of shownSkippedErrors) remaining.set(e, (remaining.get(e) ?? 0) + 1);
  for (const s of skipped) {
    const left = remaining.get(s.error) ?? 0;
    if (left > 0) {
      remaining.set(s.error, left - 1);
      continue;
    }
    if (s.line !== null && danglingLines.has(s.line)) continue;
    return s;
  }
  return null;
}
