/**
 * Inputs on the bottom, outputs on top (#212, #219).
 *
 * The rule, applied separately inside each composition (the nodes that share
 * a parent): a composition's INPUT nodes share its lowest row, with nothing
 * of that composition below them, and its OUTPUT nodes share its highest row,
 * with nothing above them except the learning and control apparatus (targets,
 * learning mechanisms, controllers and their objective mechanisms), which
 * show_graph draws beyond the outputs it hangs off. A node that is both an
 * input and an output (a single-node model, a node in a cycle) is left where
 * it is and is not in anyone's way. Composition frames are not judged, and
 * are only kept clear of.
 *
 * "Below" and "above" are by position, as the #217 test measures them: two
 * boxes are on the same row when their centres are within a quarter of their
 * two heights of each other.
 *
 * Three things use the rule:
 *  - `tidyIoRows` moves the inputs and outputs of each composition that breaks
 *    it onto their rows: after an automatic layout (Like show_graph, and
 *    Layered when it flows bottom-to-top), and from the Layout menu's Tidy
 *    inputs and outputs, for a layout of your own;
 *  - `clampIoDrag` keeps a drag within it, when the setting says so;
 *  - `ioRowViolations` says where a layout breaks it, so the Layout menu only
 *    offers Tidy when there is something to tidy.
 *
 * The setting itself, and which layouts it applies to, are in
 * stores/ioRowsStore.ts.
 */

import type { Node } from "@xyflow/react";
import { knownSize } from "./showGraphLayout";
import { ovalBoxFor } from "./nodeBox";

/** The learning and control apparatus: may sit above the outputs. */
const APPARATUS = ["LEARNING", "LEARNING_OBJECTIVE", "TARGET", "CONTROLLER", "CONTROLLER_OBJECTIVE", "CONTROL_OBJECTIVE"];

export type IoKind = "input" | "output" | "both" | "apparatus" | "other";

const rolesOf = (n: Node): string[] =>
  (((n.data as { roles?: string[] } | undefined)?.roles) ?? []).map((r) => r.toUpperCase());

/** What a node is for the rule; null for anything that is not a mechanism node. */
export function ioKind(n: Node): IoKind | null {
  if (n.type !== "mechanismNode") return null;
  const roles = rolesOf(n);
  const input = roles.includes("INPUT");
  const output = roles.includes("OUTPUT");
  if (input && output) return "both";
  if (input) return "input";
  if (output) return "output";
  if (roles.some((r) => APPARATUS.includes(r) || r.startsWith("TARGET"))) return "apparatus";
  return "other";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A node's drawn size: as measured, or before it is drawn, the size for its name. */
export function sizeOf(n: Node): { w: number; h: number } {
  const known = knownSize(n);
  if (known.w !== undefined && known.h !== undefined) return { w: known.w, h: known.h };
  if (n.type === "compositionNode") return { w: known.w ?? 300, h: known.h ?? 200 };
  const label = (n.data as { label?: string } | undefined)?.label;
  const box = ovalBoxFor(label ?? n.id);
  return { w: known.w ?? box.width, h: known.h ?? box.height };
}

const boxOf = (n: Node): Box => ({ x: n.position.x, y: n.position.y, ...sizeOf(n) });
const cy = (b: Box) => b.y + b.h / 2;
const sameRow = (a: Box, b: Box) => Math.abs(cy(a) - cy(b)) < (a.h + b.h) / 4;
/** `a` is above `b`. */
const above = (a: Box, b: Box) => !sameRow(a, b) && cy(a) < cy(b);

/** The nodes of each composition, keyed by parent ("" at the top). Hidden nodes and CIMs don't count. */
function levels(nodes: Node[]): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const n of nodes) {
    if (n.hidden || (n.type !== "mechanismNode" && n.type !== "compositionNode")) continue;
    const key = n.parentId ?? "";
    (out.get(key) ?? out.set(key, []).get(key)!).push(n);
  }
  return out;
}

interface Level {
  inputs: Node[];
  outputs: Node[];
  /** What the inputs must not sit above: every mechanism but the inputs and the both-ways nodes. */
  belowInputs: Node[];
  /** What the outputs must not sit below: as above, less the outputs and the apparatus. */
  aboveOutputs: Node[];
}

function sort(members: Node[]): Level {
  const kind = new Map(members.map((n) => [n.id, ioKind(n)]));
  const is = (n: Node, ...k: IoKind[]) => k.includes(kind.get(n.id) as IoKind);
  return {
    inputs: members.filter((n) => is(n, "input")),
    outputs: members.filter((n) => is(n, "output")),
    belowInputs: members.filter((n) => is(n, "output", "apparatus", "other")),
    aboveOutputs: members.filter((n) => is(n, "input", "other")),
  };
}

function levelViolations(members: Node[], at: string): string[] {
  const { inputs, outputs, belowInputs, aboveOutputs } = sort(members);
  const out: string[] = [];
  const name = (n: Node) => ((n.data as { label?: string } | undefined)?.label ?? n.id);
  for (let a = 1; a < inputs.length; a++) {
    if (!sameRow(boxOf(inputs[0]), boxOf(inputs[a]))) out.push(`inputs ${name(inputs[0])} and ${name(inputs[a])} on different rows${at}`);
  }
  for (const i of inputs) {
    for (const n of belowInputs) if (above(boxOf(i), boxOf(n))) out.push(`input ${name(i)} above ${name(n)}${at}`);
  }
  for (let a = 1; a < outputs.length; a++) {
    if (!sameRow(boxOf(outputs[0]), boxOf(outputs[a]))) out.push(`outputs ${name(outputs[0])} and ${name(outputs[a])} on different rows${at}`);
  }
  for (const o of outputs) {
    for (const n of aboveOutputs) if (above(boxOf(n), boxOf(o))) out.push(`output ${name(o)} below ${name(n)}${at}`);
  }
  return out;
}

/** Where these nodes break the rule, composition by composition; empty when they keep it. */
export function ioRowViolations(nodes: Node[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return [...levels(nodes)].flatMap(([parent, members]) => {
    const frame = parent ? byId.get(parent) : undefined;
    const label = frame ? ((frame.data as { label?: string } | undefined)?.label ?? frame.id) : "";
    return levelViolations(members, label ? ` (in ${label})` : "");
  });
}

const DEFAULT_ROW_GAP = 60;
const SIDE_GAP = 24;

/**
 * The clear space between this composition's rows, so a row made for the
 * inputs or outputs is as far off as the others are: the smallest gap between
 * two boxes on different rows, within reason.
 */
function rowGap(members: Node[]): number {
  const boxes = members.filter((n) => n.type === "mechanismNode").map(boxOf).sort((a, b) => cy(a) - cy(b));
  let best = Infinity;
  for (let i = 1; i < boxes.length; i++) {
    const [a, b] = [boxes[i - 1], boxes[i]];
    if (sameRow(a, b)) continue;
    const gap = b.y - (a.y + a.h);
    if (gap > 0 && gap < best) best = gap;
  }
  return isFinite(best) ? Math.min(150, Math.max(30, best)) : DEFAULT_ROW_GAP;
}

/** Push the moved boxes rightwards until none overlaps another, or a box that stays, on its row. */
function packRow(moved: Node[], staying: Node[]): void {
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.w + SIDE_GAP && b.x < a.x + a.w + SIDE_GAP && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed: Node[] = [...staying];
  for (const n of [...moved].sort((a, b) => a.position.x - b.position.x)) {
    for (let i = 0; i < 200; i++) {
      const box = boxOf(n);
      const hit = placed.find((p) => overlaps(box, boxOf(p)));
      if (!hit) break;
      const h = boxOf(hit);
      n.position = { x: h.x + h.w + SIDE_GAP, y: n.position.y };
    }
    placed.push(n);
  }
}

/** Put every node of `row` on one row with its centre at `centre`. */
function setRow(row: Node[], centre: number): void {
  for (const n of row) n.position = { x: n.position.x, y: centre - sizeOf(n).h / 2 };
}

/** Tidy one composition's nodes, in place; true if anything moved. */
function tidyLevel(members: Node[]): boolean {
  const { inputs, outputs, belowInputs, aboveOutputs } = sort(members);
  const at = (n: Node) => `${n.position.x},${n.position.y}`;
  const before = new Map(members.map((n) => [n.id, at(n)]));
  const gap = rowGap(members);

  // Inputs: the lowest input's row if everything else is on it or above it;
  // otherwise a new row below everything.
  const inputsOk = levelViolations([...inputs, ...belowInputs], "").filter((v) => v.startsWith("input")).length === 0;
  if (inputs.length && !inputsOk) {
    const lowest = Math.max(...inputs.map((n) => cy(boxOf(n))));
    const clear = (c: number) => belowInputs.every((n) => !above({ ...boxOf(inputs[0]), y: c - sizeOf(inputs[0]).h / 2 }, boxOf(n)));
    const tallest = Math.max(...inputs.map((n) => sizeOf(n).h));
    const floor = Math.max(...belowInputs.map((n) => boxOf(n).y + boxOf(n).h), -Infinity);
    const centre = clear(lowest) || !isFinite(floor) ? lowest : Math.max(lowest, floor + gap + tallest / 2);
    setRow(inputs, centre);
    packRow(inputs, members.filter((n) => !inputs.includes(n)));
  }

  // Outputs: likewise, the highest output's row, or a new row above
  // everything but the apparatus.
  const outputsOk = levelViolations([...outputs, ...aboveOutputs], "").filter((v) => v.startsWith("output")).length === 0;
  if (outputs.length && !outputsOk) {
    const highest = Math.min(...outputs.map((n) => cy(boxOf(n))));
    const clear = (c: number) => aboveOutputs.every((n) => !above(boxOf(n), { ...boxOf(outputs[0]), y: c - sizeOf(outputs[0]).h / 2 }));
    const tallest = Math.max(...outputs.map((n) => sizeOf(n).h));
    const ceiling = Math.min(...aboveOutputs.map((n) => boxOf(n).y), Infinity);
    const centre = clear(highest) || !isFinite(ceiling) ? highest : Math.min(highest, ceiling - gap - tallest / 2);
    setRow(outputs, centre);
    packRow(outputs, members.filter((n) => !outputs.includes(n)));
  }

  return members.some((n) => before.get(n.id) !== at(n));
}

/**
 * A frame whose members moved keeps them inside: they shift down together by
 * as much as one rose above the topmost member before, and the frame grows to
 * fit what moved right or down. A frame never shrinks here.
 */
function refit(frame: Node, members: Node[], was: { top: number; right: number; bottom: number }): void {
  const boxes = () => members.map(boxOf);
  const top = Math.min(...boxes().map((b) => b.y));
  if (top < was.top) {
    for (const n of members) n.position = { x: n.position.x, y: n.position.y + (was.top - top) };
  }
  const w = frame.style?.width, h = frame.style?.height;
  if (typeof w !== "number" || typeof h !== "number") return; // sized after layout (autoSizeGroups)
  const right = Math.max(...boxes().map((b) => b.x + b.w));
  const bottom = Math.max(...boxes().map((b) => b.y + b.h));
  frame.style = {
    ...frame.style,
    width: Math.max(w, w + right - was.right),
    height: Math.max(h, h + bottom - was.bottom),
  };
  if (frame.measured) frame.measured = { width: frame.style.width as number, height: frame.style.height as number };
}

/**
 * Move each composition's inputs and outputs onto their rows, where the
 * composition breaks the rule; a composition that keeps it is left exactly
 * as it is. Returns new nodes (the given ones are not changed) and the ids
 * of those that moved. The deepest compositions go first, so a frame that
 * grew to fit its members is then kept clear of in its own composition.
 */
export function tidyIoRows(nodes: Node[]): { nodes: Node[]; moved: string[] } {
  const copies = nodes.map((n) => ({ ...n, position: { ...n.position }, ...(n.style ? { style: { ...n.style } } : {}) }));
  const byId = new Map(copies.map((n) => [n.id, n]));
  const depth = (id: string): number => {
    let d = 0;
    for (let cur = byId.get(id); cur?.parentId && d < 50; cur = byId.get(cur.parentId)) d++;
    return d;
  };
  const order = [...levels(copies)].sort(([a], [b]) => (b ? depth(b) + 1 : 0) - (a ? depth(a) + 1 : 0));
  const before = new Map(copies.map((n) => [n.id, `${n.position.x},${n.position.y}`]));
  for (const [parent, members] of order) {
    const boxes = members.map(boxOf);
    const was = {
      top: Math.min(...boxes.map((b) => b.y)),
      right: Math.max(...boxes.map((b) => b.x + b.w)),
      bottom: Math.max(...boxes.map((b) => b.y + b.h)),
    };
    if (!tidyLevel(members)) continue;
    const frame = parent ? byId.get(parent) : undefined;
    if (frame) refit(frame, members, was);
  }
  const moved = copies.filter((n) => before.get(n.id) !== `${n.position.x},${n.position.y}`).map((n) => n.id);
  return { nodes: moved.length ? copies : nodes, moved };
}

/**
 * Where a dragged node may go, given where the drag would put it: an input or
 * an output slides sideways along its row; any other node stays on or above
 * the inputs' row, and on or below the outputs' row unless it is learning or
 * control apparatus. Composition frames and nodes that are both an input and
 * an output go where they are dragged. Rows are those of the node's own
 * composition.
 */
export function clampIoDrag(node: Node, proposed: { x: number; y: number }, nodes: Node[]): { x: number; y: number } {
  const kind = ioKind(node);
  if (kind === null || kind === "both") return proposed;
  if (kind === "input" || kind === "output") return { x: proposed.x, y: node.position.y };
  const siblings = nodes.filter((n) => n.id !== node.id && !n.hidden && (n.parentId ?? "") === (node.parentId ?? ""));
  const centres = (k: IoKind) => siblings.filter((n) => ioKind(n) === k).map((n) => cy(boxOf(n)));
  const h = sizeOf(node).h;
  let centre = proposed.y + h / 2;
  const outputs = centres("output");
  if (kind !== "apparatus" && outputs.length) centre = Math.max(centre, Math.min(...outputs));
  const inputs = centres("input");
  if (inputs.length) centre = Math.min(centre, Math.max(...inputs));
  return { x: proposed.x, y: centre - h / 2 };
}
