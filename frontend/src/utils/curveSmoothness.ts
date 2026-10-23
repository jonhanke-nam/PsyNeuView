/**
 * How sharply a drawn course turns (#63): the largest change of direction,
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
