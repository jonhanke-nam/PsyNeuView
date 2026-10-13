/**
 * The notice an undo or redo leaves: one for a burst, not one per step (#1377).
 *
 * Every undo used to add its own notice ("Undo: Edit 57", "Undo: Edit 56", …),
 * so holding ⌘Z stacked a column of them down the window. Now undos in quick
 * succession (each within BURST_MS of the one before) are one burst, and the
 * burst is one notice, updated in place:
 *
 *   one undo        Undid Edit 57                      [Redo]
 *   a burst         Undid 21 edits: back to Edit 37    [Redo]   (redoes all 21)
 *   one redo        Redid Edit 38                      [Undo]
 *   a burst         Redid 3 edits: forward to Edit 40  [Undo]
 *   a History jump  Went back 20 steps, to Edit 37     [Redo]
 *
 * The notice clears itself NOTICE_MS after the last step of the burst; its ×
 * clears it sooner. This module holds the burst and words the notice; the
 * steps themselves are taken in hooks/useUndoRedo.ts.
 */

export type HistoryDirection = "undo" | "redo";

/** How a move was asked for: a ⌘Z / button step, a History jump, or a notice's button. */
export type HistoryMoveOrigin = "step" | "jump" | "notice";

/** Steps further apart than this start a new burst. */
export const BURST_MS = 1500;
/** How long the notice stays after the burst's last step. */
export const NOTICE_MS = 5000;
/** "Nothing to undo" is a passing remark. */
export const NOTHING_MS = 1500;
/** The one notice undo and redo share: a new one replaces it in place. */
export const HISTORY_NOTICE_KEY = "history-move";

export interface Burst {
  direction: HistoryDirection;
  /** Steps taken in this burst. */
  count: number;
  /** A History jump: worded as one, and not added to by the steps after it. */
  jump: boolean;
  /** When the burst's last step was taken. */
  lastAt: number;
  /** History's position (`past.length`) after the last step, to see nothing else moved it. */
  position: number;
}

let burst: Burst | null = null;

/**
 * Add a move of `moved` steps to the current burst, or start a new one, and
 * return the burst. A step joins the burst when it goes the same way, within
 * BURST_MS of the last, from where the last one left History (an edit in
 * between starts afresh), and neither is a History jump.
 */
export function noteMove(
  direction: HistoryDirection,
  moved: number,
  origin: HistoryMoveOrigin,
  positionBefore: number,
  positionAfter: number,
  now: number = Date.now(),
): Burst {
  const joins =
    origin === "step" &&
    burst !== null &&
    !burst.jump &&
    burst.direction === direction &&
    burst.position === positionBefore &&
    now - burst.lastAt <= BURST_MS;
  burst = {
    direction,
    count: joins ? burst!.count + moved : moved,
    jump: origin === "jump",
    lastAt: now,
    position: positionAfter,
  };
  return burst;
}

/**
 * The burst a step that could not be taken ("Nothing to undo") belongs to:
 * holding ⌘Z past the start keeps the burst's notice rather than replacing
 * it. Refreshes the burst's time when it does.
 */
export function continuingBurst(direction: HistoryDirection, position: number, now: number = Date.now()): Burst | null {
  if (!burst || burst.jump || burst.direction !== direction || burst.position !== position) return null;
  if (now - burst.lastAt > BURST_MS) return null;
  burst.lastAt = now;
  return burst;
}

/** Forget the burst (tests; and when History is cleared). */
export function resetBurst(): void {
  burst = null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The notice's text. `target` names the step History is at now; `single`
 * names the one step taken, for a burst of one ("Undid Edit 57").
 */
export function historyNoticeText(b: Pick<Burst, "direction" | "count" | "jump">, target: string, single: string): string {
  const back = b.direction === "undo";
  if (b.jump) {
    return `Went ${back ? "back" : "forward"} ${plural(b.count, "step", "steps")}, to ${target}`;
  }
  if (b.count === 1) return `${back ? "Undid" : "Redid"} ${single}`;
  return `${back ? "Undid" : "Redid"} ${b.count} edits: ${back ? "back" : "forward"} to ${target}`;
}

/** What the notice's button does: the other way, for the whole burst. */
export function reverseLabel(b: Pick<Burst, "direction" | "count">): { label: string; title: string } {
  const verb = b.direction === "undo" ? "Redo" : "Undo";
  return { label: verb, title: `${verb} ${b.count === 1 ? "that step" : `all ${b.count} steps`}` };
}
