/**
 * Obstacle-avoiding edge router (#914).
 *
 * Hard rule: an edge must never pass over a node it doesn't connect to. Given
 * the two endpoints and the other nodes' boxes, this returns an SVG path that
 * routes *around* every obstacle, with a straight-line fast path when the
 * direct line is already clear.
 *
 * Method: a reduced visibility graph. Obstacles are inflated by a clearance
 * margin; the graph's vertices are the endpoints plus the inflated-box corners,
 * and an edge exists between two vertices only if the segment between them
 * doesn't pass through any obstacle. Dijkstra gives the shortest such polyline
 * (the "taut string" around the obstacles), which is then smoothed into a
 * continuous spline.
 *
 * Smoothing (#914 lever 1): the taut-string waypoints are fitted with a
 * Catmull-Rom spline emitted as cubic Béziers, so the curve passes *through*
 * every clearance-margin corner rather than cutting the corner inward. Each
 * Bézier segment is sampled and checked against the (slightly-shrunk) obstacle
 * boxes; any segment whose curve would clip an obstacle falls back to the
 * straight taut-string segment, which is clear by construction. So the output
 * reads as a smooth spline in the common case while the no-crossing guarantee
 * holds exactly.
 */

export interface Pt { x: number; y: number }
/** Axis-aligned box, top-left origin. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Edge-style families the router can render its detour in (mirrors the UI). */
export type EdgeStyle = "straight" | "spline" | "smoothstep";

export interface RouteOptions {
  /** Clearance kept between routes and node boxes (px). */
  margin?: number;
  /**
   * #939: render the detour in the *selected* edge style, so a routed edge
   * obeys the dropdown exactly like a clear one — instead of always emitting the
   * router's own taut-string. straight = hard polyline, spline = smooth
   * Catmull-Rom, smoothstep = rounded-corner polyline. Default "spline".
   */
  style?: EdgeStyle;
  /**
   * #944: signed lateral lane offset (px). After routing node-safely, the path
   * is bowed sideways by this much (tapered to 0 at the endpoints) so that
   * near-parallel edges separate into distinct lanes instead of running tangent.
   * The bow is re-checked against the node boxes and backed off if it would
   * clip, so the no-crossing guarantee holds. 0 = no lane offset.
   */
  lateralOffset?: number;
}

const EPS = 1e-6;

/** Does the OPEN segment a→b pass through the interior of `r`? (Liang–Barsky.) */
function segCrossesRect(a: Pt, b: Pt, r: Rect): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) {
      if (q[i] < 0) return false; // parallel to this slab and outside it
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return t1 - t0 > EPS; // positive-length overlap inside the rect ⇒ crosses
}

function pointInRect(pt: Pt, r: Rect): boolean {
  return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

function segClear(a: Pt, b: Pt, rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) if (segCrossesRect(a, b, rects[i])) return false;
  return true;
}

function inflate(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Route s→t around `obstacles`. Returns an SVG path string, or `null` when the
 * straight line is already clear (caller renders its normal path) or no route
 * is found (caller falls back).
 */
export function routeAroundObstacles(
  s: Pt, t: Pt, obstacles: Rect[], opts: RouteOptions = {},
): string | null {
  const margin = opts.margin ?? 20;
  const style = opts.style ?? "spline";
  const off = opts.lateralOffset ?? 0;

  const { vis, path } = solveRoute(s, t, obstacles, margin, off);
  // Direct line already clear (or no node anywhere near): bow it into its lane
  // if asked, else defer to the caller's own path.
  if (path === "clear") {
    return off ? renderByStyle(bow([s, t], off, vis), style, vis) : null;
  }
  if (!path) return null; // no route ⇒ let caller fall back

  // #944: bow the node-safe path into its lane (re-checked). #939: render the
  // (possibly bowed) waypoints in the caller's edge style.
  return renderByStyle(off ? bow(path, off, vis) : path, style, vis);
}

/** Obstacles overlapping the bounding box of `pts`, grown by `pad`. */
function obstaclesNear(pts: Pt[], obstacles: Rect[], pad: number): Rect[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  return obstacles.filter((o) =>
    o.x <= maxX && o.x + o.w >= minX && o.y <= maxY && o.y + o.h >= minY);
}

/**
 * The node-safe route s→t and the obstacle boxes it was checked against.
 * `path` is "clear" when the direct line crosses nothing, null when no route
 * exists, else the full polyline `[s, …, t]`.
 *
 * Only obstacles near the route are considered, to keep the visibility graph
 * small. "Near" starts as the s–t box, but a detour leaves that box, so after
 * each solve the set is widened to the route's own extent and the route solved
 * again until no new obstacle comes into range (#1364: EGO's PyTorch view had
 * an edge detour sideways straight through a node the router never saw). The
 * set only grows, so this ends after at most one pass per obstacle.
 */
function solveRoute(
  s: Pt, t: Pt, obstacles: Rect[], margin: number, lateralOffset: number,
): { vis: Rect[]; path: Pt[] | "clear" | null } {
  // A lane bow moves the path sideways by up to |offset|; keep those nodes in.
  const pad = margin + Math.abs(lateralOffset);
  let near = obstaclesNear([s, t], obstacles, pad);
  for (;;) {
    // Inflated boxes for waypoints; visibility tested against a hair-smaller
    // box so a segment may graze a corner/edge without counting as a crossing.
    const grow = near.map((o) => inflate(o, margin));
    const vis = near.map((o) => inflate(o, margin - 1));
    if (near.length === 0 || segClear(s, t, vis)) return { vis, path: "clear" };
    const path = shortestPath(s, t, grow, vis);
    if (!path) return { vis, path: null };
    // Accumulate, never replace: the re-route may swing back to the other side,
    // and it must still respect what the first attempt ran into.
    const added = obstaclesNear(path, obstacles, pad).filter((o) => !near.includes(o));
    if (added.length === 0) return { vis, path };
    near = near.concat(added);
  }
}

/**
 * Shortest node-safe polyline s→t over the visibility graph (endpoints +
 * inflated-box corners; Dijkstra). Returns the full path `[s, …, t]`, or null
 * when no route exists. Shared by routeAroundObstacles and routeWaypoints.
 */
function shortestPath(s: Pt, t: Pt, grow: Rect[], vis: Rect[]): Pt[] | null {
  const verts: Pt[] = [s, t];
  for (const r of grow) {
    const cs = [
      { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h },
    ];
    for (const c of cs) {
      if (!grow.some((o) => o !== r && pointInRect(c, o))) verts.push(c);
    }
  }
  const N = verts.length;
  const dst = new Array<number>(N).fill(Infinity);
  const prev = new Array<number>(N).fill(-1);
  const done = new Array<boolean>(N).fill(false);
  dst[0] = 0;
  for (let iter = 0; iter < N; iter++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dst[i] < best) { best = dst[i]; u = i; }
    if (u === -1 || u === 1) break; // exhausted, or target settled
    done[u] = true;
    for (let v = 0; v < N; v++) {
      if (done[v] || !segClear(verts[u], verts[v], vis)) continue;
      const nd = dst[u] + dist(verts[u], verts[v]);
      if (nd < dst[v]) { dst[v] = nd; prev[v] = u; }
    }
  }
  if (!isFinite(dst[1])) return null;
  const path: Pt[] = [];
  for (let v = 1; v !== -1; v = prev[v]) path.push(verts[v]);
  path.reverse();
  return path.length < 2 ? null : path;
}

/**
 * #951 (promote-on-grab): the INTERIOR waypoints of the node-safe route s→t
 * (the auto corners), or [] when the direct line is clear. Lets the UI
 * materialize an auto-routed edge's corners as editable user waypoints while
 * preserving its exact shape.
 */
export function routeWaypoints(s: Pt, t: Pt, obstacles: Rect[], opts: RouteOptions = {}): Pt[] {
  const margin = opts.margin ?? 20;
  const off = opts.lateralOffset ?? 0;
  // #965 (C): return the interior vertices of the ACTUAL rendered path, incl.
  // the lateral lane-bow midpoint — these are "forced" (geometry-driven) bends.
  // The UI shows them as distinct, promotable dots (#966), so no bend is ever
  // handle-less. #962: bowed to coincide with the rendered edge.
  const { vis, path } = solveRoute(s, t, obstacles, margin, off);
  if (path === "clear") return off ? bow([s, t], off, vis).slice(1, -1) : [];
  if (!path) return [];
  return (off ? bow(path, off, vis) : path).slice(1, -1);
}

/**
 * #944: bow a node-safe path sideways into a lane. Offsets each point
 * perpendicular to the overall source→target direction, tapered (sin) to 0 at
 * the endpoints so the attachment points don't move, and re-checks the bowed
 * path against the obstacle boxes — backing the magnitude off (½, ¼) and finally
 * to the unbowed path if even the gentlest bow would clip a node. So lanes never
 * reintroduce passing-behind-nodes.
 */
function bow(path: Pt[], offset: number, vis: Rect[]): Pt[] {
  // A 2-point path has no interior to move — insert a midpoint to bow.
  let pts = path;
  if (pts.length === 2) {
    pts = [pts[0], { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, pts[1]];
  }
  const s = pts[0], t = pts[pts.length - 1];
  const len = dist(s, t) || 1;
  const px = -(t.y - s.y) / len, py = (t.x - s.x) / len; // unit perpendicular
  const n = pts.length - 1;
  for (const frac of [1, 0.5, 0.25]) {
    const d = offset * frac;
    const bowed = pts.map((p, i) => {
      const taper = Math.sin((Math.PI * i) / n); // 0 at ends, 1 mid
      return { x: p.x + px * d * taper, y: p.y + py * d * taper };
    });
    let ok = true;
    for (let i = 1; i < bowed.length; i++) if (!segClear(bowed[i - 1], bowed[i], vis)) { ok = false; break; }
    if (ok) return bowed;
  }
  return path; // no safe bow ⇒ keep the node-safe original (no lane this time)
}

/** Hard polyline through the waypoints. */
function line(path: Pt[]): string {
  return "M " + path.map((p) => `${p.x} ${p.y}`).join(" L ");
}

/**
 * #951: render an explicit user-defined waypoint list in the given style, with
 * NO obstacle avoidance — a manually-shaped edge follows the user's exact path
 * (Replace, not Augment). Pass-through: the curve/steps go through every point.
 */
export function renderStyledPath(points: Pt[], style: EdgeStyle): string {
  return renderByStyle(points, style, []);
}

/**
 * #963: like renderStyledPath but node-safe. Honors the user's waypoints but
 * obstacle-avoids BETWEEN consecutive ones — each leg routes around any node in
 * its way — so a manually-shaped edge never passes behind a node. The render
 * (straight/spline/smooth-step) is checked against the obstacle boxes too.
 */
/**
 * #1019: the interior corners of the path `renderStyledPathSafe` will draw,
 * each tagged with where it came from.
 *
 * Split out so the handle layer can show a dot on *every* corner. It used to
 * list only the user's waypoints for a manual edge, while the renderer also
 * inserted corners to route around nodes — so a bend could appear in the drawn
 * edge with nothing to grab, at a position the user had not chosen.
 *
 * `forced: false` is a point the caller supplied (a user waypoint);
 * `forced: true` is one this router inserted.
 */
export function expandedCorners(
  points: Pt[],
  obstacles: Rect[],
): { x: number; y: number; forced: boolean }[] {
  const out: { x: number; y: number; forced: boolean }[] = [];
  if (points.length < 2) return out;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    // interior corners that route a→b around any node it would cross
    for (const w of routeWaypoints(a, b, obstacles)) out.push({ x: w.x, y: w.y, forced: true });
    // b is the caller's own point unless it is the final endpoint
    if (i + 1 < points.length - 1) out.push({ x: b.x, y: b.y, forced: false });
  }
  return out;
}

export function renderStyledPathSafe(points: Pt[], style: EdgeStyle, obstacles: Rect[]): string {
  if (points.length < 2) return line(points);
  const expanded: Pt[] = [
    points[0],
    ...expandedCorners(points, obstacles).map((c) => ({ x: c.x, y: c.y })),
    points[points.length - 1],
  ];
  const vis = obstacles.map((o) => inflate(o, 19)); // margin(20) − 1, matches the router
  return renderByStyle(expanded, style, vis);
}

/** Render detour waypoints in the selected edge style (#939). */
function renderByStyle(path: Pt[], style: EdgeStyle, vis: Rect[]): string {
  if (style === "straight") return line(path);
  if (style === "smoothstep") return orthogonalRounded(path, 12, vis);
  return smooth(path, 0.8, vis); // spline
}

/**
 * Orthogonalize the detour into axis-aligned (Manhattan) steps, then round the
 * corners — so a routed smooth-step edge reads with the SAME right-angle idiom
 * as a clear smooth-step edge (React Flow's getSmoothStepPath), rather than a
 * rounded shortest-path (#939 unified renderer). Between each pair of waypoints
 * we insert an L-elbow, choosing the orientation (horizontal- vs vertical-first)
 * that stays clear of obstacles; if neither is clear we keep the diagonal chord
 * (still clear by construction), so the no-crossing guarantee holds.
 */
function orthogonalRounded(path: Pt[], radius: number, vis: Rect[]): string {
  const ortho: Pt[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = ortho[ortho.length - 1];
    const b = path[i];
    if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) { ortho.push(b); continue; }
    const hFirst = { x: b.x, y: a.y };
    const vFirst = { x: a.x, y: b.y };
    if (segClear(a, hFirst, vis) && segClear(hFirst, b, vis)) ortho.push(hFirst, b);
    else if (segClear(a, vFirst, vis) && segClear(vFirst, b, vis)) ortho.push(vFirst, b);
    else ortho.push(b); // no clear elbow ⇒ keep the (clear) diagonal
  }
  return roundedPolyline(ortho, radius, vis);
}

/**
 * Rounded-corner polyline: straight runs joined by quadratic fillets at each
 * waypoint — the "smooth-step" reading of a detour (distinct from the flowing
 * spline). Per-corner obstacle safety: a corner whose fillet chord would clip
 * stays sharp instead of failing the whole path.
 */
function roundedPolyline(path: Pt[], radius: number, vis: Rect[]): string {
  if (path.length <= 2) return line(path);
  let d = `M ${path[0].x} ${path[0].y}`;
  for (let i = 1; i < path.length - 1; i++) {
    const p0 = path[i - 1], p1 = path[i], p2 = path[i + 1];
    const inLen = dist(p0, p1), outLen = dist(p1, p2);
    const rr = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: p1.x - ((p1.x - p0.x) / inLen) * rr, y: p1.y - ((p1.y - p0.y) / inLen) * rr };
    const b = { x: p1.x + ((p2.x - p1.x) / outLen) * rr, y: p1.y + ((p2.y - p1.y) / outLen) * rr };
    if (segClear(a, b, vis)) d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
    else d += ` L ${p1.x} ${p1.y}`;
  }
  d += ` L ${path[path.length - 1].x} ${path[path.length - 1].y}`;
  return d;
}

/** Cubic-Bézier point at parameter u ∈ [0, 1]. */
function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, u: number): Pt {
  const m = 1 - u;
  const a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, e = u * u * u;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + e * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + e * p1.y,
  };
}

/**
 * Does the cubic Bézier p0→p1 (controls c1,c2) stay clear of every obstacle?
 * The curve is approximated by a fine polyline and each chord is tested — dense
 * enough that a clip can't hide between samples at the radii in play.
 */
function bezierClear(p0: Pt, c1: Pt, c2: Pt, p1: Pt, vis: Rect[]): boolean {
  const STEPS = 12;
  let prev = p0;
  for (let k = 1; k <= STEPS; k++) {
    const pt = cubicAt(p0, c1, c2, p1, k / STEPS);
    if (!segClear(prev, pt, vis)) return false;
    prev = pt;
  }
  return true;
}

/** Fractions of the requested tension tried, roundest first (progressive relax). */
const RELAX_STEPS = [1, 0.6, 0.35, 0.15];

/**
 * Catmull-Rom spline through the waypoints, emitted as cubic Béziers. The curve
 * interpolates every waypoint (each sits on the clearance boundary), so it only
 * ever bows *outward* of the taut string at the corners.
 *
 * Progressive relaxation: each segment is drawn as round as it can be. We try
 * the full tension first, then progressively gentler curves (control points
 * pulled toward the waypoints, so the curve hugs the taut string more tightly),
 * and only degrade to the straight taut-string chord if even the gentlest curve
 * would clip a node. Tight clusters therefore stay curved instead of snapping
 * to hard corners, while the no-crossing guarantee still holds exactly.
 */
function smooth(path: Pt[], tension: number, vis: Rect[]): string {
  if (path.length <= 2) {
    return "M " + path.map((p) => `${p.x} ${p.y}`).join(" L ");
  }

  let d = `M ${path[0].x} ${path[0].y}`;
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[i - 1] ?? path[i]; // clamp tangents at the endpoints
    const p1 = path[i];
    const p2 = path[i + 1];
    const p3 = path[i + 2] ?? p2;

    let drawn = false;
    for (const frac of RELAX_STEPS) {
      const t = tension * frac;
      if (t <= 0) break; // tension 0 (straight mode) ⇒ hard chord below
      const c1 = {
        x: p1.x + ((p2.x - p0.x) / 6) * t,
        y: p1.y + ((p2.y - p0.y) / 6) * t,
      };
      const c2 = {
        x: p2.x - ((p3.x - p1.x) / 6) * t,
        y: p2.y - ((p3.y - p1.y) / 6) * t,
      };
      if (bezierClear(p1, c1, c2, p2, vis)) {
        d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
        drawn = true;
        break;
      }
    }
    if (!drawn) d += ` L ${p2.x} ${p2.y}`; // no safe curve ⇒ straight chord
  }
  return d;
}
