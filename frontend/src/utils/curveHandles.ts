/**
 * Curves shaped with handles, like a pen tool's (#39).
 *
 * A Smooth (spline) arrow is a chain of cubic Béziers through its anchors:
 * the source end, each bend, and the target end. Every anchor has a tangent
 * handle. The curve leaves an anchor towards the tip of its "out" handle and
 * arrives at the next anchor from the tip of that anchor's "in" handle, so the
 * handle tips are the Bézier control points.
 *
 * Left alone, a handle follows its neighbours (a Catmull-Rom tangent: parallel
 * to the line from the previous anchor to the next, scaled by the tension), so
 * an arrow nobody has shaped draws exactly as before. Dragging a handle pins it:
 * the offset from its anchor is kept, so the handle moves with the anchor when
 * the anchor is dragged. A bend's two handles stay in line (a smooth point):
 * the in handle is the out handle reversed.
 *
 * Kept as offsets, never as absolute points, so a node moving drags the ends'
 * handles along with the ends.
 */

export interface Pt { x: number; y: number }

/** An anchor with an optional pinned out handle (offset from the anchor). */
export interface Anchor extends Pt { h?: Pt }

/**
 * The pinned handles at an arrow's two ends. `s` is the source's out handle;
 * `t` is the target's in handle (it points back along the arrow). Offsets.
 */
export interface EndHandles { s?: Pt; t?: Pt }

/**
 * How far an unpinned handle reaches: the share of the neighbour-to-neighbour
 * span (÷ 6, as Catmull-Rom does). 1 is the classic Catmull-Rom curve.
 *
 * Softer since #39: the old 0.8 drew a bend as two near-straight runs with a
 * rounded corner between them. A longer tangent turns it into a curve.
 */
export const SOFT_TENSION = 1.3;

/**
 * The tension every arrow was drawn with before #39. A route saved then has no
 * `tension`, and is drawn with this one, so an old layout looks as it did.
 */
export const LEGACY_TENSION = 0.8;

/** Each anchor's in and out handle offsets; null where the end has none. */
export interface AnchorHandles { in: Pt | null; out: Pt | null }

/**
 * The handle of every anchor in `points` (source, bends…, target), pinned or
 * automatic.
 */
export function anchorHandles(points: Anchor[], tension: number, ends?: EndHandles): AnchorHandles[] {
  const n = points.length;
  const out: AnchorHandles[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[i - 1] ?? points[i]; // clamped at the ends, as smooth() is
    const next = points[i + 1] ?? points[i];
    const auto = { x: ((next.x - prev.x) / 6) * tension, y: ((next.y - prev.y) / 6) * tension };
    if (i === 0) {
      out.push({ in: null, out: ends?.s ? { ...ends.s } : auto });
    } else if (i === n - 1) {
      out.push({ in: ends?.t ? { ...ends.t } : { x: -auto.x, y: -auto.y }, out: null });
    } else {
      const h = points[i].h ?? auto;
      out.push({ in: { x: -h.x, y: -h.y }, out: { x: h.x, y: h.y } });
    }
  }
  return out;
}

/** Whether an arrow has any pinned handle. */
export function hasPinnedHandles(waypoints: Anchor[] | undefined, ends: EndHandles | undefined): boolean {
  return !!(ends?.s || ends?.t || waypoints?.some((p) => p.h));
}

/**
 * The SVG path through `points` with their handles. Follows the user's curve
 * exactly — no obstacle avoidance: a hand-shaped curve is the user's own.
 */
export function handlePath(points: Anchor[], tension: number, ends?: EndHandles): string {
  if (points.length < 2) return points.length ? `M ${points[0].x} ${points[0].y}` : "";
  const hs = anchorHandles(points, tension, ends);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const o = hs[i].out!, n = hs[i + 1].in!;
    d += ` C ${a.x + o.x} ${a.y + o.y} ${b.x + n.x} ${b.y + n.y} ${b.x} ${b.y}`;
  }
  return d;
}

/**
 * The offset to pin when the `side` handle of anchor `index` is dragged to
 * `to`. A bend keeps its out handle, so dragging its in handle pins the
 * reverse. Returns where it goes: an end's handle, or a bend's (index into
 * the bends, not the anchors).
 */
export function pinFromDrag(
  points: Pt[], index: number, side: "in" | "out", to: Pt,
): { end: "s" | "t"; h: Pt } | { bend: number; h: Pt } {
  const a = points[index];
  const v = { x: to.x - a.x, y: to.y - a.y };
  if (index === 0) return { end: "s", h: v };
  if (index === points.length - 1) return { end: "t", h: v };
  return { bend: index - 1, h: side === "out" ? v : { x: -v.x, y: -v.y } };
}

/** Where a handle is drawn: at its tip, but never so close it hides the anchor. */
export function handleTip(anchor: Pt, h: Pt, minLen = 18): Pt {
  const len = Math.hypot(h.x, h.y);
  if (len >= minLen || len < 1e-6) return { x: anchor.x + h.x, y: anchor.y + h.y };
  const k = minLen / len;
  return { x: anchor.x + h.x * k, y: anchor.y + h.y * k };
}
