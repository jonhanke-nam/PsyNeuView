/**
 * Turning hand-shaped edges into something that survives a reload (#1162).
 *
 * The store keys everything by React Flow's edge id, which is the projection's
 * PsyNeuLink name. That is fine within a session and wrong to persist: renaming
 * a projection would silently lose its shape, and auto-generated projection
 * names carry `-N` suffixes that move as the model changes.
 *
 * What does not move is where an edge starts and ends. So routes are stored
 * under the endpoints, and resolved back to whatever edge currently connects
 * them.
 */

import type { Pt, Waypoint } from "@/stores/edgeAttachStore";
import { LEGACY_TENSION, SOFT_TENSION, type EndHandles } from "@/utils/curveHandles";

export interface EdgeRoute {
  /** Bends; a bend's `h` is its pinned handle (#39). */
  waypoints?: Waypoint[];
  /** Per-end attachment angles in radians (#947). */
  ends?: { s?: number; t?: number };
  /** #39: pinned handles at the two ends (offsets). */
  handles?: EndHandles;
  /**
   * #39: the spline tension the route is drawn with. Written with every route
   * that has bends or handles since the softer default; a route saved before
   * has none and is drawn with LEGACY_TENSION, as it was then.
   */
  tension?: number;
}

/** #39: the curve state beside the bends, as the edge store holds it. */
export interface CurveState {
  handles?: Record<string, EndHandles>;
  tension?: Record<string, number>;
}

const copyPt = (p: Pt): Pt => ({ x: p.x, y: p.y });
const copyWaypoint = (p: Waypoint): Waypoint => (p.h ? { x: p.x, y: p.y, h: copyPt(p.h) } : copyPt(p));
const copyHandles = (h: EndHandles): EndHandles => ({
  ...(h.s ? { s: copyPt(h.s) } : {}),
  ...(h.t ? { t: copyPt(h.t) } : {}),
});

export type EdgeRouteMap = Record<string, EdgeRoute>;

/** The minimum an edge must tell us to be addressable across a rebuild. */
export interface RoutableEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Endpoint-derived key: stable across renames, unique per port pair. */
export function routeKey(edge: RoutableEdge): string {
  return [edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? ""].join("|");
}

/**
 * Keys that more than one current edge claims.
 *
 * Two projections between the same pair of ports are unusual but legal, and a
 * saved route cannot say which one it belonged to. Applying it to whichever
 * happens to come first would attach someone's shaping to an edge they never
 * touched — worse than losing it, because it looks like the app moved something
 * on its own. Those keys are skipped on both save and load.
 */
export function ambiguousKeys(edges: RoutableEdge[]): Set<string> {
  const seen = new Map<string, number>();
  for (const e of edges) seen.set(routeKey(e), (seen.get(routeKey(e)) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * What to write to the sidecar.
 *
 * Only edges the user actually shaped: `waypoints` alone is not evidence, since
 * grabbing a handle on an auto-routed edge materialises the router's corners
 * before any movement ("promote on grab", #951). Persisting those would freeze
 * an automatic shape into the file because someone touched it.
 */
export function serializeRoutes(
  edges: RoutableEdge[],
  shaped: Record<string, true>,
  waypoints: Record<string, Waypoint[]>,
  overrides: Record<string, { s?: number; t?: number }>,
  curves: CurveState = {},
): EdgeRouteMap {
  const skip = ambiguousKeys(edges);
  const out: EdgeRouteMap = {};
  for (const edge of edges) {
    if (!shaped[edge.id]) continue;
    const key = routeKey(edge);
    if (skip.has(key)) continue;
    const route: EdgeRoute = {};
    const wps = waypoints[edge.id];
    if (wps?.length) route.waypoints = wps.map(copyWaypoint);
    const ends = overrides[edge.id];
    if (ends && (ends.s !== undefined || ends.t !== undefined)) route.ends = { ...ends };
    const hs = curves.handles?.[edge.id];
    if (hs && (hs.s || hs.t)) route.handles = copyHandles(hs);
    if (route.waypoints || route.handles) route.tension = curves.tension?.[edge.id] ?? SOFT_TENSION;
    if (route.waypoints || route.ends || route.handles) out[key] = route;
  }
  return out;
}

/** Saved routes resolved back onto the edges of a freshly built graph. */
export function hydrateRoutes(
  edges: RoutableEdge[],
  saved: EdgeRouteMap | null | undefined,
): {
  waypoints: Record<string, Waypoint[]>;
  overrides: Record<string, { s?: number; t?: number }>;
  shaped: Record<string, true>;
  handles: Record<string, EndHandles>;
  tension: Record<string, number>;
} {
  const waypoints: Record<string, Waypoint[]> = {};
  const overrides: Record<string, { s?: number; t?: number }> = {};
  const shaped: Record<string, true> = {};
  const handles: Record<string, EndHandles> = {};
  const tension: Record<string, number> = {};
  if (!saved) return { waypoints, overrides, shaped, handles, tension };

  const skip = ambiguousKeys(edges);
  for (const edge of edges) {
    const key = routeKey(edge);
    if (skip.has(key)) continue;
    const route = saved[key];
    if (!route) continue;
    if (route.waypoints?.length) waypoints[edge.id] = route.waypoints.map(copyWaypoint);
    if (route.ends) overrides[edge.id] = { ...route.ends };
    if (route.handles && (route.handles.s || route.handles.t)) handles[edge.id] = copyHandles(route.handles);
    // #39: a curve keeps the tension it was saved with; one saved before the
    // softer default was drawn with the old one, and still is.
    if (waypoints[edge.id] || handles[edge.id]) {
      const t = typeof route.tension === "number" ? route.tension : LEGACY_TENSION;
      if (t !== SOFT_TENSION) tension[edge.id] = t;
    }
    // Restored shaping is still shaping: a later save must not drop it just
    // because this session has not touched the edge yet.
    shaped[edge.id] = true;
  }
  return { waypoints, overrides, shaped, handles, tension };
}

/**
 * Whether two saved route maps shape every arrow the same way (#164). Used to
 * tell an arrow's reshape apart from the step before it in History, and to
 * skip writing the layout file when an Undo leaves the arrows as they are.
 */
export function sameRoutes(a: EdgeRouteMap | undefined, b: EdgeRouteMap | undefined): boolean {
  const [ra, rb] = [a ?? {}, b ?? {}];
  const keys = Object.keys(rb);
  if (keys.length !== Object.keys(ra).length) return false;
  const close = (p?: number, q?: number) =>
    p === q || (p !== undefined && q !== undefined && Math.abs(p - q) < 1e-6);
  return keys.every((k) => {
    const [x, y] = [ra[k], rb[k]];
    if (!x) return false;
    const [wx, wy] = [x.waypoints ?? [], y.waypoints ?? []];
    if (wx.length !== wy.length) return false;
    const near = (p?: Pt, q?: Pt) =>
      (!p && !q) || (!!p && !!q && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5);
    if (!wx.every((p, i) => near(p, wy[i]) && near(p.h, wy[i].h))) return false;
    // #39: a handle drag is a reshape of its own.
    if (!near(x.handles?.s, y.handles?.s) || !near(x.handles?.t, y.handles?.t)) return false;
    if (!close(x.tension, y.tension)) return false;
    return close(x.ends?.s, y.ends?.s) && close(x.ends?.t, y.ends?.t);
  });
}
