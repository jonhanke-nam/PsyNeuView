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

import type { Pt } from "@/stores/edgeAttachStore";

export interface EdgeRoute {
  waypoints?: Pt[];
  /** Per-end attachment angles in radians (#947). */
  ends?: { s?: number; t?: number };
}

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
  waypoints: Record<string, Pt[]>,
  overrides: Record<string, { s?: number; t?: number }>,
): EdgeRouteMap {
  const skip = ambiguousKeys(edges);
  const out: EdgeRouteMap = {};
  for (const edge of edges) {
    if (!shaped[edge.id]) continue;
    const key = routeKey(edge);
    if (skip.has(key)) continue;
    const route: EdgeRoute = {};
    const wps = waypoints[edge.id];
    if (wps?.length) route.waypoints = wps.map((p) => ({ x: p.x, y: p.y }));
    const ends = overrides[edge.id];
    if (ends && (ends.s !== undefined || ends.t !== undefined)) route.ends = { ...ends };
    if (route.waypoints || route.ends) out[key] = route;
  }
  return out;
}

/** Saved routes resolved back onto the edges of a freshly built graph. */
export function hydrateRoutes(
  edges: RoutableEdge[],
  saved: EdgeRouteMap | null | undefined,
): {
  waypoints: Record<string, Pt[]>;
  overrides: Record<string, { s?: number; t?: number }>;
  shaped: Record<string, true>;
} {
  const waypoints: Record<string, Pt[]> = {};
  const overrides: Record<string, { s?: number; t?: number }> = {};
  const shaped: Record<string, true> = {};
  if (!saved) return { waypoints, overrides, shaped };

  const skip = ambiguousKeys(edges);
  for (const edge of edges) {
    const key = routeKey(edge);
    if (skip.has(key)) continue;
    const route = saved[key];
    if (!route) continue;
    if (route.waypoints?.length) waypoints[edge.id] = route.waypoints.map((p) => ({ ...p }));
    if (route.ends) overrides[edge.id] = { ...route.ends };
    // Restored shaping is still shaping: a later save must not drop it just
    // because this session has not touched the edge yet.
    shaped[edge.id] = true;
  }
  return { waypoints, overrides, shaped };
}
