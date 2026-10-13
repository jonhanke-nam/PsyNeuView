/**
 * Every Inspector edit records its undo step before it changes the model (#1369).
 *
 * The condition removes edited the model with no step first; undo still
 * worked, but only because the reload afterwards happened to record one, and
 * whatever the editor held just before the edit was in no step at all. A
 * source guard, like the settings and dialog inventories: each structural
 * change the Inspector sends has a `recordAction(` shortly before it, with no
 * other structural change in between.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(path.join(__dirname, "InspectorPanel.tsx"), "utf8");
const CALL = '"/api/model/structural-change"';
/** How far above the fetch the step may be recorded (a confirm, a few lets). */
const WINDOW_LINES = 30;

describe("Inspector structural changes record a step first (#1369)", () => {
  const lines = SOURCE.split("\n");
  const sites = lines.flatMap((l, i) => (l.includes(CALL) ? [i] : []));

  it("finds the structural changes", () => {
    // Scheduler mode, the condition removes and adds, the builder, termination.
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it.each(sites.map((i) => [i + 1]))("the change at line %i records a step before it", (lineNo) => {
    const at = lineNo - 1;
    const previous = sites.filter((i) => i < at).pop() ?? -1;
    const from = Math.max(previous + 1, at - WINDOW_LINES);
    const before = lines.slice(from, at).join("\n");
    expect(before, `no recordAction( within ${WINDOW_LINES} lines above line ${lineNo}`).toContain("recordAction(");
  });
});
