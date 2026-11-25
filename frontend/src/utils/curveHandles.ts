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
export const SOFT_TENSION = 1.6;

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
  // Which handles are automatic, so a segment with both ends automatic can be
  // kept from wiggling (#416).
  const autoOut: boolean[] = [];
  const autoIn: boolean[] = [];
  const reach = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y) * HANDLE_REACH;
  for (let i = 0; i < n; i++) {
    const prev = points[i - 1] ?? points[i]; // clamped at the ends, as smooth() is
    const next = points[i + 1] ?? points[i];
    const auto = { x: ((next.x - prev.x) / 6) * tension, y: ((next.y - prev.y) / 6) * tension };
    // #416: an automatic handle reaches no further than its own segment.
    const autoOutH = capHandle(auto, reach(points[i], next));
    const autoInH = capHandle({ x: -auto.x, y: -auto.y }, reach(prev, points[i]));
    if (i === 0) {
      out.push({ in: null, out: ends?.s ? { ...ends.s } : autoOutH });
      autoOut.push(!ends?.s);
      autoIn.push(false);
    } else if (i === n - 1) {
      out.push({ in: ends?.t ? { ...ends.t } : autoInH, out: null });
      autoOut.push(false);
      autoIn.push(!ends?.t);
    } else {
      const h = points[i].h;
      out.push(h ? { in: { x: -h.x, y: -h.y }, out: { x: h.x, y: h.y } } : { in: autoInH, out: autoOutH });
      autoOut.push(!h);
      autoIn.push(!h);
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    if (!autoOut[i] || !autoIn[i + 1]) continue;
    const a = points[i], b = points[i + 1];
    const o = out[i].out!, m = out[i + 1].in!;
    const [c1, c2] = oneWay(a, { x: a.x + o.x, y: a.y + o.y }, { x: b.x + m.x, y: b.y + m.y }, b);
    out[i].out = { x: c1.x - a.x, y: c1.y - a.y };
    out[i + 1].in = { x: c2.x - b.x, y: c2.y - b.y };
  }
  return out;
}

/**
 * #416: the longest an automatic handle reaches, as a share of its own
 * segment. A Catmull-Rom handle is set by the corner's two neighbours, so a
 * short segment beside a long run would otherwise get a handle many times its
 * own length and loop. A whole segment stops the loops; a third (the usual
 * choice) also pulls in the curves that keep a fan of lines apart, and the
 * nothing-hidden check (#389) saw lines run together longer.
 */
export const HANDLE_REACH = 1;

/** The handle (dx, dy), shortened to at most `cap` long, same direction (#416). */
export function capHandle(h: Pt, cap: number): Pt {
  const len = Math.hypot(h.x, h.y);
  const k = len > cap ? cap / len : 1;
  return { x: h.x * k, y: h.y * k };
}

const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);

/**
 * #416: keep a segment that should bend one way from wiggling. Its end
 * directions on opposite sides of the straight line between its ends mean
 * one bend; it wiggles when one handle is too long for the other, so its
 * control polygon turns back at the other end. Only that handle is
 * shortened, as little as it takes, so the curve keeps its reach (a fan of
 * lines from one node keeps spreading as soon as it did). A real S (both end
 * directions on one side) is left as it is.
 */
// A turn back this small leaves no visible wiggle; correcting it would only
// pull the curve in.
const TURN_BACK_DEG = 2;

export function oneWay(p1: Pt, c1: Pt, c2: Pt, p2: Pt): [Pt, Pt] {
  // Which side of the straight line each end direction leaves on: -1, 0
  // (along it, within a degree) or 1.
  const side = (u: Pt, v: Pt) => {
    const c = cross(p1, p2, u, v);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) * Math.hypot(v.x - u.x, v.y - u.y);
    return len && Math.abs(c) / len > Math.sin(Math.PI / 180) ? Math.sign(c) : 0;
  };
  const bend = cross(p1, c1, c2, p2);
  if (side(p1, c1) * side(c2, p2) >= 0 || bend === 0) return [c1, c2];
  // How far the polygon turns against the bend at a corner, in degrees.
  const back = (u: Pt, v: Pt, w: Pt, x: Pt) => {
    const c = cross(u, v, w, x) * Math.sign(bend);
    const d = (v.x - u.x) * (x.x - w.x) + (v.y - u.y) * (x.y - w.y);
    return c < 0 ? (Math.atan2(-c, d) * 180) / Math.PI : 0;
  };
  let a = c1, b = c2;
  for (let i = 0; i < 20; i++) {
    const atA = back(p1, a, a, b), atB = back(a, b, b, p2);
    if (atA <= TURN_BACK_DEG && atB <= TURN_BACK_DEG) break;
    // Turning back at the start: the end's handle is too long, and the reverse.
    if (atA > atB) b = { x: p2.x + (b.x - p2.x) * 0.8, y: p2.y + (b.y - p2.y) * 0.8 };
    else a = { x: p1.x + (a.x - p1.x) * 0.8, y: p1.y + (a.y - p1.y) * 0.8 };
  }
  return [a, b];
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
