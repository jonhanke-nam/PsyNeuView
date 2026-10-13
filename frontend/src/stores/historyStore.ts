/**
 * Session-wide undo/redo history store.
 *
 * Tracks application state snapshots with action descriptions.
 * Every user action (parameter edits, node moves, structural changes,
 * code edits) creates a labeled entry in the history stack.
 *
 * Features:
 * - Undo/redo as far back as the session goes (#558), see "How deep" below
 * - Action descriptions for each entry ("Modified gain in hidden_layer")
 * - Smart batching: rapid edits within 500ms are grouped into one entry
 * - Includes node positions, selection state, and graph settings
 * - Skips duplicate snapshots (no change = no entry)
 * - Saves are marked on the step they wrote (#1349), see `SaveMark`
 *
 * Saves are flags on a step, not steps of their own. A save does not change
 * the model, it writes the state the current step already describes to disk,
 * so it belongs to that step: undo and redo still move one *change* at a
 * time, never stop on a save, and a save carries the exact source it wrote
 * (the step's own `source`) for "Revert the file to this save". History draws
 * each mark as a line under its step ("Saved 14:32"). A step that carries a
 * save is never merged into by the 500 ms batching, which would change the
 * text the mark says was written.
 *
 * ## How deep (#558)
 *
 * History keeps every step of the session. What it does not keep is a full
 * copy of everything for every step: a step's graph (`nodes`, `edges`) is
 * by far its largest part, and it can always be rebuilt from the step's code.
 * So:
 *
 *  - the newest steps are kept whole, up to `budget.fullBytes` of them (and
 *    never fewer than `KEEP_FULL_MIN`);
 *  - older steps are kept *compact* (`compact: true`): the graph is dropped,
 *    and the code is stored as the difference from the next newer step (one
 *    edit is usually a few characters), with the whole text kept every
 *    `KEYFRAME_EVERY` steps so reading one back never walks far. Positions,
 *    the description, the file path and save marks are kept as they were;
 *  - only if even the compact steps outgrow `budget.totalBytes` is the oldest
 *    dropped, and `evicted` counts them so History can say so.
 *
 * A compact step's `source` reads exactly like any other step's (it is
 * rebuilt on read), so saves, "on disk" and the History diffs work the same.
 * Undoing into one restores its code and positions and rebuilds the graph by
 * previewing the code (hooks/useUndoRedo.ts), as typing does.
 *
 * The sizes are estimates of what each step holds on the JavaScript heap,
 * counting what a step shares with its neighbour (an unchanged node's data,
 * unchanged positions, unchanged code) once. See
 * docs/saving-autosave-and-undo.md for the measurements behind them.
 */

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";

export interface Snapshot {
  /** Python source code */
  source: string;
  /** React Flow nodes (includes positions). Empty on a compact step. */
  nodes: Node[];
  /** React Flow edges. Empty on a compact step. */
  edges: Edge[];
  /** Path to the .py file */
  filePath: string | null;
  /** Human-readable description of the action */
  description: string;
  /** Timestamp for batching decisions */
  timestamp: number;
  /** Layout positions (for restore) */
  positions?: Record<string, { x: number; y: number }>;
  /** Saves that wrote this step's `source` to disk, oldest first (#1349). */
  saves?: SaveMark[];
  /**
   * True when the step is held compactly (#558): its graph was dropped to
   * save memory, and is rebuilt from `source` when undo reaches it.
   */
  compact?: boolean;
}

/** How a save came about. */
export type SaveKind = "manual" | "auto" | "revert";

/** One save of a step's source to the model file (#1349). */
export interface SaveMark {
  /** When it was written (ms since the epoch). */
  at: number;
  /** Save or ⌘S; autosave; or "Revert the file to this save". */
  kind: SaveKind;
  /** For a revert: when the save it went back to was made. */
  revertedTo?: number;
}

const MB = 1024 * 1024;

/** How much memory History may use (#558). */
export interface HistoryBudget {
  /** Estimated bytes the whole (uncompacted) newest steps may hold. */
  fullBytes: number;
  /** Estimated bytes all steps together may hold before the oldest is dropped. */
  totalBytes: number;
}

/**
 * Measured on the EGO reference model (docs/saving-autosave-and-undo.md): a
 * whole step there holds about 90 KB when the edit rebuilt the graph and 42
 * KB when it didn't (the code alone is 21,000 characters), a compact step
 * well under 1 KB. So 32 MB keeps the newest 350 to 750 EGO steps whole
 * (thousands for a small model), and the other 64 MB holds on the order of
 * 100,000 compact steps before the oldest is dropped.
 */
export const DEFAULT_BUDGET: HistoryBudget = { fullBytes: 32 * MB, totalBytes: 96 * MB };
/** The newest steps are always kept whole, whatever they weigh. */
export const KEEP_FULL_MIN = 20;
/** A compact step keeps its whole code at least this often (bounds a read). */
export const KEYFRAME_EVERY = 32;

/** What History holds, for the panel and for tests. */
export interface HistoryStats {
  steps: number;
  full: number;
  compact: number;
  /** Estimated bytes held, in all. */
  bytes: number;
  /** Estimated bytes held by the whole steps. */
  fullBytes: number;
}

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  budget: HistoryBudget;
  /** Steps dropped this session because History was over `budget.totalBytes`. */
  evicted: number;
  /** Last push timestamp for smart batching */
  lastPushTime: number;
  /** Batch window in ms — rapid actions within this window merge */
  batchWindowMs: number;
  /** Whether we're currently restoring (to prevent recording during undo/redo) */
  isRestoring: boolean;

  pushSnapshot: (snapshot: Snapshot) => void;
  /**
   * Record that `snapshot.source` was just written to the model file. Marks
   * the current step when it holds that text; otherwise `snapshot` is added
   * as a new step, carrying the mark.
   */
  markSaved: (snapshot: Snapshot, mark: SaveMark) => void;
  undo: () => Snapshot | null;
  redo: () => Snapshot | null;
  /**
   * Undo (`delta` < 0) or redo (`delta` > 0) several steps at once, as far as
   * History goes: one change to the store, whatever the count (#1377: a jump
   * in History is one action). Returns the step now current and how many
   * steps were taken, or null when none could be.
   */
  move: (delta: number) => { snapshot: Snapshot; moved: number } | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  setRestoring: (v: boolean) => void;
  /** Change the memory budget (tests; the app uses `DEFAULT_BUDGET`). */
  setBudget: (budget: Partial<HistoryBudget>) => void;
  stats: () => HistoryStats;

  /** Get the current action description for display */
  currentDescription: () => string;
  /** Get the next undo description */
  undoDescription: () => string | null;
  /** Get the next redo description */
  redoDescription: () => string | null;
}

// ---------------------------------------------------------------------------
// Compact steps: the code as a difference from the next newer step.

/** `source` = base's text with [start, length - end) replaced by `insert`. */
interface Delta {
  base: Snapshot;
  start: number;
  end: number;
  insert: string;
}

/** Steps whose `source` is a delta (a getter). Never set for a whole step. */
const deltas = new WeakMap<Snapshot, Delta>();

/** What each step is estimated to hold, and a fingerprint of its code. */
interface Meta {
  bytes: number;
  length: number;
  hash: number;
}
const metas = new WeakMap<Snapshot, Meta>();

/**
 * A copy of `s` that shares nothing with the string it was cut from. V8 keeps
 * a slice as a view onto its parent, which would keep every full text a
 * delta was cut from alive and undo the point of storing the delta.
 */
function detached(s: string): string {
  return s.length < 16 ? s : (JSON.parse(JSON.stringify(s)) as string);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The step's code, rebuilt along its chain of deltas when it is compact. */
export function resolveSource(step: Snapshot): string {
  const chain: Delta[] = [];
  let s = step;
  for (let d = deltas.get(s); d; d = deltas.get(s)) {
    chain.push(d);
    s = d.base;
  }
  let text = s.source;
  for (let i = chain.length - 1; i >= 0; i--) {
    const d = chain[i];
    text = text.slice(0, d.start) + d.insert + text.slice(text.length - d.end);
  }
  return text;
}

/** The difference that turns `newer` back into `older`. */
function makeDelta(older: string, newer: string): Omit<Delta, "base"> {
  const max = Math.min(older.length, newer.length);
  let start = 0;
  while (start < max && older.charCodeAt(start) === newer.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < max - start &&
    older.charCodeAt(older.length - 1 - end) === newer.charCodeAt(newer.length - 1 - end)
  ) end++;
  return { start, end, insert: detached(older.slice(start, older.length - end)) };
}

/** Give a delta step its whole text back (a plain `source` property). */
function materialize(step: Snapshot): void {
  if (!deltas.has(step)) return;
  const text = detached(resolveSource(step));
  deltas.delete(step);
  Object.defineProperty(step, "source", { value: text, writable: true, enumerable: true, configurable: true });
  const meta = metas.get(step);
  if (meta) meta.bytes += textBytes(text);
}

/**
 * Whether `step` holds exactly `text`, without rebuilding a compact step's
 * code unless its length and fingerprint already match. History compares
 * every step with the file ("on disk"), so this is the common question.
 */
let lastHashed: { text: string; hash: number } | null = null;
export function sameSource(step: Snapshot, text: string): boolean {
  const meta = metas.get(step);
  if (!deltas.has(step) || !meta) return step.source === text;
  if (meta.length !== text.length) return false;
  if (lastHashed?.text !== text) lastHashed = { text, hash: fnv1a(text) };
  if (meta.hash !== lastHashed.hash) return false;
  return resolveSource(step) === text;
}

// ---------------------------------------------------------------------------
// Size estimates. Calibrated against the heap (docs/saving-autosave-and-undo.md).

/**
 * Heap bytes a string of code takes: one a character, or two when any
 * character is outside Latin-1 (a single "—" in a comment does it; the EGO
 * model is stored two bytes a character).
 */
function textBytes(s: string): number {
  return /[^\u0000-\u00ff]/.test(s) ? 2 * s.length : s.length;
}
/** Heap bytes per character of a graph object's JSON (measured on EGO: about 1.3). */
const HEAP_PER_JSON_CHAR = 1.5;
const NODE_SHELL_BYTES = 300;
const EDGE_SHELL_BYTES = 200;
const POSITION_BYTES = 80;
const STEP_BYTES = 300;

const dataSizes = new WeakMap<object, number>();
function dataBytes(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const hit = dataSizes.get(data);
  if (hit !== undefined) return hit;
  let size: number;
  try {
    size = (JSON.stringify(data)?.length ?? 0) * HEAP_PER_JSON_CHAR;
  } catch {
    size = 4096;
  }
  dataSizes.set(data, size);
  return size;
}

/** The graph's bytes, counting data objects the neighbour already holds once. */
function graphBytes(step: Snapshot, neighbour: Snapshot | undefined): number {
  const shared = new Set<unknown>();
  for (const n of neighbour?.nodes ?? []) shared.add(n.data);
  for (const e of neighbour?.edges ?? []) shared.add(e.data);
  let bytes = 0;
  for (const n of step.nodes) bytes += NODE_SHELL_BYTES + (shared.has(n.data) ? 0 : dataBytes(n.data));
  for (const e of step.edges) bytes += EDGE_SHELL_BYTES + (shared.has(e.data) ? 0 : dataBytes(e.data));
  return bytes;
}

function positionsBytes(step: Snapshot, neighbour: Snapshot | undefined): number {
  if (!step.positions || step.positions === neighbour?.positions) return 0;
  return Object.keys(step.positions).length * POSITION_BYTES;
}

function positionsEqual(a: Snapshot["positions"], b: Snapshot["positions"]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const p = a[k];
    const q = b[k];
    if (!q || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

/**
 * Prepare a new step to sit after `previous`: share what it has in common
 * with it (unchanged code, unchanged positions) and estimate what it holds.
 */
function admit(step: Snapshot, previous: Snapshot | undefined): Snapshot {
  if (previous && !deltas.has(previous)) {
    if (step.source === previous.source) step.source = previous.source;
    if (positionsEqual(step.positions, previous.positions)) step.positions = previous.positions;
  }
  const sourceShared = previous !== undefined && !deltas.has(previous) && step.source === previous.source;
  metas.set(step, {
    bytes:
      STEP_BYTES +
      (sourceShared ? 0 : textBytes(step.source)) +
      positionsBytes(step, previous) +
      graphBytes(step, previous),
    length: step.source.length,
    hash: fnv1a(step.source),
  });
  return step;
}

function bytesOf(step: Snapshot): number {
  return metas.get(step)?.bytes ?? STEP_BYTES + textBytes(step.source);
}

/**
 * Drop `step`'s graph and keep its code as a delta from `newer` (or whole,
 * as a keyframe). The step object is changed in place: older delta steps
 * point at it, and History caches per step object.
 */
function compact(step: Snapshot, newer: Snapshot, keyframe: boolean): void {
  const text = step.source;
  step.nodes = [];
  step.edges = [];
  step.compact = true;
  if (positionsEqual(step.positions, newer.positions)) step.positions = newer.positions;
  const meta = metas.get(step) ?? { bytes: 0, length: text.length, hash: fnv1a(text) };
  let codeBytes = textBytes(text);
  if (!keyframe) {
    const d = makeDelta(text, resolveSource(newer));
    deltas.set(step, { base: newer, ...d });
    Object.defineProperty(step, "source", {
      get: () => resolveSource(step),
      enumerable: true,
      configurable: true,
    });
    codeBytes = textBytes(d.insert);
  }
  meta.bytes = STEP_BYTES + codeBytes + positionsBytes(step, newer);
  metas.set(step, meta);
}

/** How many delta steps sit directly before `index` (bounded). */
function deltaRunBefore(steps: Snapshot[], index: number): number {
  let run = 0;
  for (let i = index - 1; i >= 0 && run < KEYFRAME_EVERY && deltas.has(steps[i]); i--) run++;
  return run;
}

/**
 * Keep History inside its budget: compact the oldest whole steps while the
 * whole ones are over `fullBytes`, then drop the oldest steps while all of
 * them are over `totalBytes`. Returns the steps kept and how many were dropped.
 */
function enforceBudget(past: Snapshot[], budget: HistoryBudget): { past: Snapshot[]; dropped: number } {
  const protectedFrom = past.length - KEEP_FULL_MIN;
  let fullBytes = 0;
  for (const s of past) if (!s.compact) fullBytes += bytesOf(s);
  for (let i = 0; i < protectedFrom && fullBytes > budget.fullBytes; i++) {
    const s = past[i];
    if (s.compact) continue;
    fullBytes -= bytesOf(s);
    compact(s, past[i + 1], deltaRunBefore(past, i) >= KEYFRAME_EVERY - 1);
  }
  let total = 0;
  for (const s of past) total += bytesOf(s);
  let dropped = 0;
  while (total > budget.totalBytes && past.length - dropped > KEEP_FULL_MIN) {
    total -= bytesOf(past[dropped]);
    dropped++;
  }
  return { past: dropped ? past.slice(dropped) : past, dropped };
}

/**
 * `next` replaces `old` at the top of `past`. The step before it may hold its
 * code as a delta from `old`: point it at `next` when the code is the same,
 * otherwise give it its whole text back.
 */
function rebaseOnto(past: Snapshot[], old: Snapshot, next: Snapshot): void {
  const below = past[past.length - 2];
  const d = below ? deltas.get(below) : undefined;
  if (!below || !d || d.base !== old) return;
  if (sameSource(next, resolveSource(old))) d.base = next;
  else materialize(below);
}

function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  if (a.filePath !== b.filePath || !sameSource(a, b.source)) return false;
  // A compact step's graph is rebuilt from its code, so the code decides.
  if (a.compact) return true;
  return a.nodes.length === b.nodes.length && a.edges.length === b.edges.length;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  budget: DEFAULT_BUDGET,
  evicted: 0,
  lastPushTime: 0,
  batchWindowMs: 500,
  isRestoring: false,

  pushSnapshot: (snapshot) => {
    const state = get();

    // Don't record during undo/redo restore
    if (state.isRestoring) return;

    const now = Date.now();
    const lastEntry = state.past[state.past.length - 1];

    // Skip if snapshot is identical to the last one
    if (lastEntry && snapshotsEqual(lastEntry, snapshot)) return;

    // The redo steps are about to go; the current step may hold its code as a
    // delta from one of them.
    if (lastEntry) materialize(lastEntry);

    // Smart batching: if the last push was within the batch window
    // AND has the same description prefix, merge instead of creating new entry
    if (
      lastEntry &&
      !lastEntry.saves?.length &&
      now - state.lastPushTime < state.batchWindowMs &&
      snapshot.description &&
      lastEntry.description &&
      getBatchKey(lastEntry.description) === getBatchKey(snapshot.description)
    ) {
      // Replace the last entry instead of adding a new one
      const next = admit({ ...snapshot, timestamp: now }, state.past[state.past.length - 2]);
      rebaseOnto(state.past, lastEntry, next);
      set({
        past: [...state.past.slice(0, -1), next],
        future: [],
        lastPushTime: now,
      });
      return;
    }

    const next = admit({ ...snapshot, timestamp: now }, lastEntry);
    const { past, dropped } = enforceBudget([...state.past, next], state.budget);
    set({
      past,
      future: [], // Clear redo stack on new action
      lastPushTime: now,
      evicted: state.evicted + dropped,
    });
  },

  markSaved: (snapshot, mark) => {
    const { past, budget, evicted } = get();
    const top = past[past.length - 1];
    if (top && sameSource(top, snapshot.source)) {
      // Replaced, not mutated: the panel memoizes on the step objects.
      const marked: Snapshot = {
        ...top,
        source: deltas.has(top) ? detached(resolveSource(top)) : top.source,
        saves: [...(top.saves ?? []), mark],
      };
      metas.set(marked, {
        ...(metas.get(top) ?? { bytes: 0, length: marked.source.length, hash: fnv1a(marked.source) }),
        bytes: bytesOf(top) + (deltas.has(top) ? textBytes(marked.source) : 0),
      });
      rebaseOnto(past, top, marked);
      set({ past: [...past.slice(0, -1), marked] });
      return;
    }
    // The text written is not a step yet (it was saved before the edit was
    // recorded): it becomes one, like any other change, and carries the mark.
    if (top) materialize(top);
    const now = Date.now();
    const next = admit({ ...snapshot, timestamp: now, saves: [mark] }, top);
    const kept = enforceBudget([...past, next], budget);
    set({
      past: kept.past,
      future: [],
      lastPushTime: now,
      evicted: evicted + kept.dropped,
    });
  },

  undo: () => {
    const { past } = get();
    if (past.length <= 1) return null; // Need at least 2: initial + one action
    const current = past[past.length - 1];
    const previous = past[past.length - 2];
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [current, ...state.future],
    }));
    return previous;
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    set((state) => ({
      past: [...state.past, next],
      future: state.future.slice(1),
    }));
    return next;
  },

  move: (delta) => {
    const { past, future } = get();
    if (delta < 0) {
      const moved = Math.min(-delta, past.length - 1);
      if (moved <= 0) return null;
      const keep = past.length - moved;
      set({ past: past.slice(0, keep), future: [...past.slice(keep), ...future] });
      return { snapshot: past[keep - 1], moved };
    }
    const moved = Math.min(delta, future.length);
    if (moved <= 0) return null;
    set({ past: [...past, ...future.slice(0, moved)], future: future.slice(moved) });
    return { snapshot: future[moved - 1], moved };
  },

  canUndo: () => get().past.length > 1,
  canRedo: () => get().future.length > 0,

  clear: () => set({ past: [], future: [], lastPushTime: 0, evicted: 0 }),

  setRestoring: (v) => set({ isRestoring: v }),

  setBudget: (budget) => set((s) => ({ budget: { ...s.budget, ...budget } })),

  stats: () => {
    const { past, future } = get();
    const out: HistoryStats = { steps: 0, full: 0, compact: 0, bytes: 0, fullBytes: 0 };
    for (const s of [...past, ...future]) {
      const b = bytesOf(s);
      out.steps++;
      out.bytes += b;
      if (s.compact) out.compact++;
      else {
        out.full++;
        out.fullBytes += b;
      }
    }
    return out;
  },

  currentDescription: () => {
    const { past } = get();
    if (past.length === 0) return "";
    return past[past.length - 1].description;
  },

  undoDescription: () => {
    const { past } = get();
    if (past.length <= 1) return null;
    return past[past.length - 1].description;
  },

  redoDescription: () => {
    const { future } = get();
    if (future.length === 0) return null;
    return future[0].description;
  },

}));


/**
 * Extract a batch key from an action description.
 * Actions with the same batch key within the batch window are merged.
 * e.g., "Modified gain in hidden" and "Modified gain in hidden" → same key
 * but "Modified gain in hidden" and "Added node x" → different keys
 */
function getBatchKey(description: string): string {
  // Group by action type + target
  // "Modified X in Y" → "modify:Y"
  // "Moved node X" → "move:X"
  const m = description.match(/^(Modified|Changed)\s+\w+\s+in\s+(\w+)/i);
  if (m) return `modify:${m[2]}`;

  const mv = description.match(/^Moved\s+(?:node\s+)?(\w+)/i);
  if (mv) return `move:${mv[1]}`;

  return description; // No batching for unique descriptions
}
