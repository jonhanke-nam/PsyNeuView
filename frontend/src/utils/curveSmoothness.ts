/**
 * How smooth a drawn line is. `sharpestTurn` (#63): the largest change of direction,
 * in degrees, between successive short steps along an SVG path made of
 * cubic Béziers (`M x y C …`). A smooth curve turns a few degrees per step;
 * a spike turns back on itself, close to 180.
 */

import type { Point } from "@/stores/showGraphCurvesStore";

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** The path sampled densely along its Bézier segments. */
export function samplePath(d: string, perSegment = 40): Point[] {
  const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  if (nums.length < 2) return [];
  let cur = { x: nums[0], y: nums[1] };
  const out: Point[] = [cur];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const c1 = { x: nums[i], y: nums[i + 1] };
    const c2 = { x: nums[i + 2], y: nums[i + 3] };
    const end = { x: nums[i + 4], y: nums[i + 5] };
    for (let k = 1; k <= perSegment; k++) out.push(cubic(cur, c1, c2, end, k / perSegment));
    cur = end;
  }
  return out;
}

/**
 * The sharpest turn along the path, measured between steps of about
 * `step` units (closer points are merged so rounding doesn't count).
 */
export function sharpestTurn(d: string, step = 4): number {
  const pts = samplePath(d);
  const even: Point[] = [];
  for (const p of pts) {
    const last = even[even.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= step) even.push(p);
  }
  let worst = 0;
  for (let i = 1; i + 1 < even.length; i++) {
    const a = Math.atan2(even[i].y - even[i - 1].y, even[i].x - even[i - 1].x);
    const b = Math.atan2(even[i + 1].y - even[i].y, even[i + 1].x - even[i].x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    worst = Math.max(worst, (turn * 180) / Math.PI);
  }
  return worst;
}

/** A polyline resampled every `step` units along its length. */
export function resample(pts: Point[], step = 2): Point[] {
  if (pts.length < 2) return pts.slice();
  const out: Point[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let d = step - carry;
    while (d <= L) {
      out.push({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L });
      d += step;
    }
    carry = L - (d - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * How smooth one drawn line is (#416).
 *  - changes: how often the line changes the way it turns (0: straight or
 *    one bend; 1: an S; 2+: more);
 *  - wiggles: bumps between two changes of direction shorter than
 *    `wiggleLen` units (ripples, as opposed to a long detour round a node);
 *  - ripple: the tallest such bump, in units;
 *  - hooks: one stretch turning back on itself by more than 150° within 150
 *    units (a loop or a hairpin), which counting changes can't see.
 */
export interface Smoothness { changes: number; wiggles: number; ripple: number; hooks: number }

/**
 * Smoothness of a line sampled every `step` units (see `resample`). Turning
 * is measured over `win` units either side of each sample, so pixel noise
 * doesn't count, and a stretch turning one way counts once it has turned
 * `minRunDeg` in all. The first and last `trimEnds` units are left out.
 */
export function smoothness(
  pts: Point[],
  { step = 2, win = 8, minRunDeg = 3, trimEnds = 6, wiggleLen = 80, hookDeg = 150, hookLen = 150 } = {},
): Smoothness {
  const w = Math.max(1, Math.round(win / step));
  const t = Math.round(trimEnds / step);
  const ang = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
  const turns: number[] = [];
  for (let k = w + t; k < pts.length - w - t; k++) {
    let d = ang(pts[k], pts[k + w]) - ang(pts[k - w], pts[k]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turns.push(d);
  }
  type Run = { sign: number; from: number; to: number; turn: number };
  const runs: Run[] = [];
  const eps = (0.15 * Math.PI) / 180;
  turns.forEach((d, i) => {
    const sign = d > eps ? 1 : d < -eps ? -1 : 0;
    if (!sign) return;
    const last = runs[runs.length - 1];
    if (last && last.sign === sign) { last.to = i; last.turn += Math.abs(d) / w; }
    else runs.push({ sign, from: i, to: i, turn: Math.abs(d) / w });
  });
  const deg = (r: number) => (r * 180) / Math.PI;
  const merged: Run[] = [];
  for (const r of runs.filter((r) => deg(r.turn) >= minRunDeg)) {
    const last = merged[merged.length - 1];
    if (last && last.sign === r.sign) { last.to = r.to; last.turn += r.turn; }
    else merged.push({ ...r });
  }
  const hooks = merged.filter((r) => deg(r.turn) > hookDeg && (r.to - r.from) * step < hookLen).length;
  let ripple = 0, wiggles = 0;
  for (const r of merged.slice(1, -1)) {
    if ((r.to - r.from) * step >= wiggleLen) continue;
    const a = pts[r.from + w + t], b = pts[r.to + w + t];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let bulge = 0;
    for (let k = r.from + w + t; k <= r.to + w + t; k++) {
      const p = pts[k];
      bulge = Math.max(bulge, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L);
    }
    if (bulge > 0.5) { wiggles++; ripple = Math.max(ripple, bulge); }
  }
  return { changes: Math.max(0, merged.length - 1), wiggles, ripple: Math.round(ripple * 10) / 10, hooks };
}
