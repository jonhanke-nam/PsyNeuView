/**
 * View-state-dependent rendering transform for graph nodes. Refs #288.
 *
 * Toggles like "Types" widen on-node labels, which makes the rendered
 * ovals grow. Without a layout adjustment, the wider ovals collide with
 * their neighbors. Re-running dagre would fix the spacing but clobber
 * user-dragged positions, so instead we keep the canonical position
 * untouched and apply a view-dependent stretch at render time only.
 *
 * Approach: per-rank symmetric shift by sort order. For each rank, the
 * max label-width delta D is added between adjacent members; the rank's
 * centroid (in canonical order) stays fixed. The shift is a constant
 * per-node value (not a position-dependent factor), so the drag inverse
 * is the identity — canonical delta equals rendered delta.
 */
import type { Node } from "@xyflow/react";

export interface ViewTransformState {
  showFullTypes: boolean;
}

// Per-character width estimate for the upper-case 10px-font role/type
// badge. Sized empirically against the rendered badge text.
const CHAR_PX = 6.5;
const MECH_SUFFIX = "Mechanism";

/**
 * Estimated badge-width delta for a single node under the given view
 * state. Today the only width-affecting toggle is `showFullTypes`,
 * which restores the "Mechanism" suffix on type names. The delta is
 * zero if the node has no type or its type doesn't contain the suffix.
 */
function nodeBadgeWidthDelta(node: Node, state: ViewTransformState): number {
  if (!state.showFullTypes) return 0;
  const pnlType = (node.data as any)?.type as string | undefined;
  if (!pnlType || !pnlType.includes(MECH_SUFFIX)) return 0;
  return MECH_SUFFIX.length * CHAR_PX;
}

/**
 * Per-rank shift table: for each node id, how many pixels to add to
 * its canonical x (or y, for LR/RL directions) to produce the rendered
 * position. Nodes not in any rank, or in single-node ranks, get 0.
 */
export interface ShiftTable {
  shifts: Map<string, number>;
  isVertical: boolean;
}

/**
 * Build the shift table for the current node set and view state.
 *
 * Ranks are read from `node.data.layoutRank` (populated by
 * applyDagreLayout). Within each rank, nodes are sorted by canonical
 * cross-axis position and assigned symmetric shifts (i - (N-1)/2) * D,
 * where D is the max badge-width delta among the rank's members under
 * the current view state.
 */
export function computeShiftTable(
  nodes: Node[],
  state: ViewTransformState,
  direction: "TB" | "BT" | "LR" | "RL" = "TB",
): ShiftTable {
  const isVertical = direction === "TB" || direction === "BT";
  const shifts = new Map<string, number>();

  const ranks = new Map<number, Node[]>();
  for (const n of nodes) {
    if (n.parentId) continue;
    const r = (n.data as any)?.layoutRank;
    if (typeof r !== "number") continue;
    if (!ranks.has(r)) ranks.set(r, []);
    ranks.get(r)!.push(n);
  }

  for (const members of ranks.values()) {
    if (members.length < 2) continue;
    let maxDelta = 0;
    for (const n of members) {
      const d = nodeBadgeWidthDelta(n, state);
      if (d > maxDelta) maxDelta = d;
    }
    if (maxDelta === 0) continue;

    // Sort by the layout-axis coordinate so the symmetric shift respects
    // current left→right (or top→bottom) ordering within the rank.
    const sorted = [...members].sort((a, b) =>
      isVertical ? a.position.x - b.position.x : a.position.y - b.position.y,
    );
    const center = (sorted.length - 1) / 2;
    for (let i = 0; i < sorted.length; i++) {
      shifts.set(sorted[i].id, (i - center) * maxDelta);
    }
  }

  return { shifts, isVertical };
}

/** Apply the shift table to a single position. */
export function shiftPosition(
  id: string,
  position: { x: number; y: number },
  table: ShiftTable,
): { x: number; y: number } {
  const s = table.shifts.get(id);
  if (!s) return position;
  return table.isVertical
    ? { x: position.x + s, y: position.y }
    : { x: position.x, y: position.y + s };
}

/**
 * Inverse of {@link shiftPosition}. Maps a rendered position back to
 * canonical. Used when intercepting drag updates — React Flow emits
 * positions in rendered space and we store canonical.
 */
export function unshiftPosition(
  id: string,
  position: { x: number; y: number },
  table: ShiftTable,
): { x: number; y: number } {
  const s = table.shifts.get(id);
  if (!s) return position;
  return table.isVertical
    ? { x: position.x - s, y: position.y }
    : { x: position.x, y: position.y - s };
}
