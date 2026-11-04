/**
 * An open composition frame never covers a node beside it (#208).
 *
 * In a custom layout a composition keeps one saved position whether it is
 * folded to a node or open as a frame. Folded, it is a small box; opened, the
 * frame grows right and down from the same corner, over whatever the user had
 * placed there — in a layout arranged around the folded node, that is its
 * neighbours. So, once the frames are sized, the nodes an open frame would
 * cover are moved out from under it, each the shortest way out (up, down,
 * left or right), and a moved node that then lands on another moves that one
 * along the same way. Everything else stays where the user put it: the frame
 * keeps its corner, nodes clear of the frames keep their places, and two
 * mechanisms the user placed over one another are left as they are.
 *
 * The same rule answers a drag: a frame dropped on nodes moves them aside, and
 * a node dropped on a frame is put beside it, so a later rebuild has nothing to
 * move and nothing jumps.
 *
 * Siblings are compared within their own parent (positions inside a frame are
 * relative to it), the deepest frames first, so a frame that grows to fit
 * what moved inside it can then make its own room among its siblings.
 */

import type { Node } from "@xyflow/react";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Way = "left" | "right" | "up" | "down";

/** How far `b` would have to move each way to clear `a` by `gap`. */
function waysOut(a: Box, b: Box, gap: number): Record<Way, number> {
  return {
    left: b.x + b.w + gap - a.x,
    right: a.x + a.w + gap - b.x,
    up: b.y + b.h + gap - a.y,
    down: a.y + a.h + gap - b.y,
  };
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function move(node: Node, way: Way, by: number): void {
  const p = node.position;
  node.position =
    way === "left" ? { x: p.x - by, y: p.y }
    : way === "right" ? { x: p.x + by, y: p.y }
    : way === "up" ? { x: p.x, y: p.y - by }
    : { x: p.x, y: p.y + by };
}

export interface RoomOptions {
  /** Clear space kept between a frame and what was moved out from under it. */
  gap?: number;
  /** Called after each group of siblings is done, to refit frames to what moved inside them. */
  refit?: () => void;
  /** Where two frames meet, these stay: the frames the user just dropped. */
  keep?: ReadonlySet<string>;
}

/**
 * Move nodes out from under the open frames beside them. Edits positions in
 * place; returns the ids of the nodes moved, in the order they first moved.
 */
export function makeRoomForFrames(
  nodes: Node[],
  sizeOf: (n: Node) => { w: number; h: number },
  options: RoomOptions = {},
): string[] {
  const gap = options.gap ?? 12;
  const keep = options.keep;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: Node): number => {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    return parent ? 1 + depth(parent) : 0;
  };
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  // Deepest first: a frame refitted to its moved members then makes room
  // among its own siblings.
  const order = [...groups.entries()].sort(([a], [b]) => {
    const da = a ? depth(byId.get(a)!) : -1;
    const db = b ? depth(byId.get(b)!) : -1;
    return db - da;
  });

  const moved: string[] = [];
  const way = new Map<string, Way>();
  const isFrame = (n: Node) => n.type === "compositionNode";
  const box = (n: Node): Box => ({ ...n.position, ...sizeOf(n) });

  for (const [, siblings] of order) {
    if (!siblings.some(isFrame)) continue;
    // Pairs are settled until a pass finds none; each node only ever moves one
    // way, so this ends.
    for (let pass = 0; pass < 100; pass++) {
      let changed = false;
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          const [a, b] = [siblings[i], siblings[j]];
          // Only a frame's room is made, and the room of what was moved for it.
          const concerns = isFrame(a) || isFrame(b) || way.has(a.id) || way.has(b.id);
          if (!concerns) continue;
          const [ba, bb] = [box(a), box(b)];
          const g = isFrame(a) || isFrame(b) ? gap : 0;
          if (!overlaps(ba, bb, g)) continue;
          // Who moves: a mechanism rather than a frame; else the one not
          // already moved; else the later of the two. It goes the way it
          // already went, or the way the node it is clearing went, or else
          // the shortest way out. A frame the user just dropped stays put.
          let [stay, go] = [a, b];
          if (isFrame(b) && !isFrame(a)) [stay, go] = [b, a];
          else if (isFrame(a) && isFrame(b) && keep?.has(b.id) && !keep.has(a.id)) [stay, go] = [b, a];
          else if (isFrame(a) && isFrame(b) && keep?.has(a.id)) [stay, go] = [a, b];
          else if (isFrame(a) === isFrame(b) && way.has(b.id) && !way.has(a.id)) [stay, go] = [b, a];
          const out = waysOut(box(stay), box(go), g);
          const chosen =
            way.get(go.id) ??
            way.get(stay.id) ??
            (Object.entries(out) as [Way, number][]).sort((p, q) => p[1] - q[1])[0][0];
          const by = out[chosen];
          if (by <= 0) continue;
          move(go, chosen, by);
          if (!way.has(go.id)) {
            way.set(go.id, chosen);
            moved.push(go.id);
          }
          changed = true;
        }
      }
      if (!changed) break;
    }
    options.refit?.();
  }
  return moved;
}
