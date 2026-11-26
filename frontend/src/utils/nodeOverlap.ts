/**
 * Nodes never overlap other nodes (design principle 3, #389).
 *
 * The automatic layouts keep nodes apart themselves. A saved (Custom) layout
 * can still put two nodes on top of each other: positions written for nodes
 * of another size (the type and role tags on, a longer name), a hand-edited
 * sidecar, or a bundled layout that was simply off. So when a saved layout is
 * applied, two nodes whose boxes overlap by more than a few pixels are nudged
 * apart, minimally and the same way every time:
 *
 * - Only the overlap is resolved. One node of the pair moves, the shortest way
 *   out (right, down, left or up, in that order on a tie), just far enough to
 *   leave a small gap. Every node that overlaps nothing stays exactly where
 *   it was saved.
 * - The node that moves is the later of the two in reading order (top to
 *   bottom, then left to right, then by id), so the result does not depend on
 *   the order the nodes arrive in.
 * - A moved node that then lands on another pushes that one along the same
 *   way, so a row packed too tight opens up in one direction instead of
 *   scattering.
 *
 * Siblings are compared within their own parent (positions inside a frame are
 * relative to it). Open composition frames are left out: their room among
 * their neighbours is utils/frameRoom.ts's.
 */

import type { Node } from "@xyflow/react";

/** Boxes may touch, or overlap by a border's width; more than this is an overlap. */
export const OVERLAP_TOLERANCE = 4;
/** The clear space a nudged node is given from the node it overlapped. */
export const NUDGE_GAP = 8;

type Way = "right" | "down" | "left" | "up";
/** The tie-break order: the graph reads left to right and top to bottom. */
const WAYS: Way[] = ["right", "down", "left", "up"];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far two boxes overlap on each axis (negative: the space between them). */
function overlapOf(a: Box, b: Box): { dx: number; dy: number } {
  return {
    dx: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    dy: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
  };
}

/** How far `b` would move each way to clear `a` by `gap`. */
function waysOut(a: Box, b: Box, gap: number): Record<Way, number> {
  return {
    right: a.x + a.w + gap - b.x,
    down: a.y + a.h + gap - b.y,
    left: b.x + b.w + gap - a.x,
    up: b.y + b.h + gap - a.y,
  };
}

function shift(p: { x: number; y: number }, way: Way, by: number): { x: number; y: number } {
  if (way === "right") return { x: p.x + by, y: p.y };
  if (way === "left") return { x: p.x - by, y: p.y };
  if (way === "down") return { x: p.x, y: p.y + by };
  return { x: p.x, y: p.y - by };
}

export interface OverlapOptions {
  tolerance?: number;
  gap?: number;
}

/** Whether two boxes overlap by more than `tolerance` on both axes. */
export function boxesOverlap(a: Box, b: Box, tolerance = OVERLAP_TOLERANCE): boolean {
  const { dx, dy } = overlapOf(a, b);
  return dx > tolerance && dy > tolerance;
}

/**
 * Nudge overlapping nodes apart. Edits positions in place (each moved node
 * gets a new `position` object) and returns the ids of the nodes moved, in
 * the order they first moved. Nodes that overlap nothing are untouched.
 */
export function separateOverlappingNodes(
  nodes: Node[],
  sizeOf: (n: Node) => { w: number; h: number },
  options: OverlapOptions = {},
): string[] {
  const tolerance = options.tolerance ?? OVERLAP_TOLERANCE;
  const gap = options.gap ?? NUDGE_GAP;

  const parents = new Set<string>();
  for (const n of nodes) if (n.parentId) parents.add(n.parentId);
  const isOpenFrame = (n: Node) => n.type === "compositionNode" && parents.has(n.id);

  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    if (n.hidden || isOpenFrame(n)) continue;
    if (n.type !== "mechanismNode" && n.type !== "compositionNode") continue;
    const key = n.parentId ?? "";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }

  const moved: string[] = [];
  for (const siblings of groups.values()) {
    if (siblings.length < 2) continue;
    const sizes = new Map(siblings.map((n) => [n.id, sizeOf(n)]));
    const box = (n: Node): Box => ({ x: n.position.x, y: n.position.y, ...sizes.get(n.id)! });
    // Reading order, fixed before anything moves, decides who gives way.
    const rank = new Map(
      [...siblings]
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((n, i) => [n.id, i]),
    );
    const ordered = [...siblings].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const way = new Map<string, Way>();

    // Each node only ever moves one way, so the passes settle; the cap is a
    // guard against a pathological pile, not a step the usual case reaches.
    for (let pass = 0; pass < 50; pass++) {
      let changed = false;
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const [a, b] = [ordered[i], ordered[j]];
          if (!boxesOverlap(box(a), box(b), tolerance)) continue;
          // The later node gives way, unless it has been moved already and
          // the earlier one not: a moved node pushes what it lands on along.
          const [stay, go] = way.has(b.id) && !way.has(a.id) ? [b, a] : [a, b];
          const out = waysOut(box(stay), box(go), gap);
          const chosen =
            way.get(go.id) ??
            way.get(stay.id) ??
            WAYS.reduce((best, w) => (out[w] < out[best] ? w : best), WAYS[0]);
          const by = out[chosen];
          if (by <= 0) continue;
          go.position = shift(go.position, chosen, by);
          if (!way.has(go.id)) {
            way.set(go.id, chosen);
            moved.push(go.id);
          }
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return moved;
}

/** "Two nodes overlapped; moved BIAS slightly." The once-per-load notice. */
export function overlapNotice(movedLabels: string[]): string {
  const names = movedLabels.length <= 3
    ? movedLabels.join(", ")
    : `${movedLabels.slice(0, 3).join(", ")} and ${movedLabels.length - 3} more`;
  const count = movedLabels.length === 1 ? "Two nodes" : "Some nodes";
  return (
    `${count} overlapped in the saved layout; moved ${names} slightly so all are visible. ` +
    "The layout file is unchanged until you next move a node or save the layout."
  );
}
