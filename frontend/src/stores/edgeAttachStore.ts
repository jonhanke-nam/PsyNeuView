/**
 * Per-edge attachment overrides (#947).
 *
 * By default an edge attaches at the oval boundary facing its counterpart (or
 * at a lane-spread point). Dragging an edge's connection dot pins THAT edge's
 * end to a specific spot on the node oval, independent of the port's other
 * edges. The override is an ellipse-parameter angle in radians (same convention
 * as portLayoutStore: 0 = right, π/2 = bottom, π = left, −π/2 = top).
 *
 * Alt-drag moves the whole PORT instead — that path writes portLayoutStore, not
 * this store.
 *
 * Persisted to the sidecar since #1162 — this is the user's shaping, the same
 * category as dragging a node, and losing it on reload was worse than not
 * offering it.
 *
 * Only what the user *changed* is persisted, which is not the same as what the
 * store holds. Grabbing a bend on an auto-routed edge first materialises the
 * router's corners as editable waypoints ("promote on grab", #951) — before any
 * movement. Persisting at that moment would freeze the router's own shape into
 * the file because someone touched a handle, and that edge would stop following
 * the router forever. So `shaped` records the edges an actual insert / move /
 * remove / reset touched, and only those are written.
 */

import { create } from "zustand";
import type { EndHandles } from "@/utils/curveHandles";

/** s = source end, t = target end. */
export type EdgeEnd = "s" | "t";
export interface Pt { x: number; y: number }
/**
 * A bend. `h`, when present, is its pinned out handle (#39): an offset from
 * the bend, so it moves with it. Absent, the curve picks the tangent itself.
 */
export interface Waypoint extends Pt { h?: Pt }

interface EdgeAttachState {
  /** edgeId → { s?: angle, t?: angle } (radians). */
  overrides: Record<string, { s?: number; t?: number }>;
  /** #951: edgeId → user waypoints the edge routes through (absolute flow coords). */
  waypoints: Record<string, Waypoint[]>;
  /** #39: edgeId → the pinned handles at the arrow's two ends (offsets). */
  handles: Record<string, EndHandles>;
  /**
   * #39: edgeId → the spline tension the arrow is drawn with, when it is not
   * the current default — a route saved before the softer default keeps its
   * old one, so an old layout looks as it did.
   */
  tension: Record<string, number>;
  /** #39: pin (or, with null, release) bend `index`'s handle. */
  setWaypointHandle: (edgeId: string, index: number, h: Pt | null) => void;
  /** #39: pin (or, with null, release) the handle at one end of the arrow. */
  setEndHandle: (edgeId: string, end: EdgeEnd, h: Pt | null) => void;
  setEnd: (edgeId: string, end: EdgeEnd, angle: number) => void;
  /** Replace an edge's waypoints wholesale (e.g. materialize auto corners, #951). */
  setWaypoints: (edgeId: string, pts: Pt[]) => void;
  /** Insert a waypoint at `index` (splice) — used when a drag creates a bend. */
  insertWaypoint: (edgeId: string, index: number, p: Pt) => void;
  /** Move the waypoint at `index` to `p` (drag). */
  moveWaypoint: (edgeId: string, index: number, p: Pt) => void;
  /** Remove the waypoint at `index` (double-click / drag-off). */
  removeWaypoint: (edgeId: string, index: number) => void;
  /** Clear all waypoints for an edge ("Reset route"). */
  clearWaypoints: (edgeId: string) => void;
  /**
   * Edges the user has actually shaped, as opposed to merely grabbed.
   *
   * Promote-on-grab writes waypoints before any movement, so the presence of
   * waypoints is not evidence of intent; this is (#1162).
   */
  shaped: Record<string, true>;
  clearEdge: (edgeId: string) => void;
  /** Replace everything — used to restore a loaded sidecar (#1162). */
  hydrate: (state: {
    waypoints: Record<string, Waypoint[]>;
    overrides: Record<string, { s?: number; t?: number }>;
    shaped: Record<string, true>;
    handles?: Record<string, EndHandles>;
    tension?: Record<string, number>;
  }) => void;
  clearAll: () => void;
}

export const useEdgeAttach = create<EdgeAttachState>((set) => ({
  overrides: {},
  waypoints: {},
  shaped: {},
  handles: {},
  tension: {},
  setWaypointHandle: (edgeId, index, h) =>
    set((s) => {
      const cur = s.waypoints[edgeId];
      if (!cur || index < 0 || index >= cur.length) return s;
      const next = cur.slice();
      const { h: _old, ...rest } = next[index];
      next[index] = h ? { ...rest, h: { x: h.x, y: h.y } } : rest;
      return {
        waypoints: { ...s.waypoints, [edgeId]: next },
        shaped: { ...s.shaped, [edgeId]: true },
      };
    }),
  setEndHandle: (edgeId, end, h) =>
    set((s) => {
      const cur = { ...(s.handles[edgeId] || {}) };
      if (h) cur[end] = { x: h.x, y: h.y }; else delete cur[end];
      const handles = { ...s.handles };
      if (cur.s || cur.t) handles[edgeId] = cur; else delete handles[edgeId];
      return { handles, shaped: { ...s.shaped, [edgeId]: true } };
    }),
  setEnd: (edgeId, end, angle) =>
    set((s) => ({
      overrides: {
        ...s.overrides,
        [edgeId]: { ...(s.overrides[edgeId] || {}), [end]: angle },
      },
      // Dragging a connection dot is an explicit act, with no promote-on-grab
      // equivalent — so it always counts as shaping (#947, #1162).
      shaped: { ...s.shaped, [edgeId]: true },
    })),
  setWaypoints: (edgeId, pts) =>
    set((s) => ({ waypoints: { ...s.waypoints, [edgeId]: pts.slice() } })),
  insertWaypoint: (edgeId, index, p) =>
    set((s) => {
      const cur = s.waypoints[edgeId] || [];
      const next = cur.slice();
      next.splice(Math.max(0, Math.min(index, next.length)), 0, p);
      return {
        waypoints: { ...s.waypoints, [edgeId]: next },
        shaped: { ...s.shaped, [edgeId]: true },
      };
    }),
  moveWaypoint: (edgeId, index, p) =>
    set((s) => {
      const cur = s.waypoints[edgeId];
      if (!cur || index < 0 || index >= cur.length) return s;
      const next = cur.slice();
      // #39: the bend's pinned handle is an offset, so it comes along.
      next[index] = cur[index].h ? { x: p.x, y: p.y, h: cur[index].h } : { x: p.x, y: p.y };
      return {
        waypoints: { ...s.waypoints, [edgeId]: next },
        shaped: { ...s.shaped, [edgeId]: true },
      };
    }),
  removeWaypoint: (edgeId, index) =>
    set((s) => {
      const cur = s.waypoints[edgeId];
      if (!cur || index < 0 || index >= cur.length) return s;
      const next = cur.slice();
      next.splice(index, 1);
      const wp = { ...s.waypoints };
      if (next.length) wp[edgeId] = next; else delete wp[edgeId];
      return {
        waypoints: wp,
        shaped: { ...s.shaped, [edgeId]: true },
      };
    }),
  clearWaypoints: (edgeId) =>
    set((s) => {
      if (!s.waypoints[edgeId] && !s.handles[edgeId]) return s;
      const wp = { ...s.waypoints };
      delete wp[edgeId];
      // #39: "Reset shape" puts the curve back too: no pinned handles, and
      // the current default tension.
      const handles = { ...s.handles };
      delete handles[edgeId];
      const tension = { ...s.tension };
      delete tension[edgeId];
      // Reset route means "forget what I did", so drop the shaped mark too:
      // persisting an empty route would claim the user shaped it to have no
      // bends, when what they asked for is the automatic one back (#1162).
      const shaped = { ...s.shaped };
      delete shaped[edgeId];
      return { waypoints: wp, shaped, handles, tension };
    }),
  clearEdge: (edgeId) =>
    set((s) => {
      const next = { ...s.overrides };
      delete next[edgeId];
      const wp = { ...s.waypoints };
      delete wp[edgeId];
      const handles = { ...s.handles };
      delete handles[edgeId];
      return { overrides: next, waypoints: wp, handles };
    }),
  clearAll: () => set({ overrides: {}, waypoints: {}, shaped: {}, handles: {}, tension: {} }),
  hydrate: ({ waypoints, overrides, shaped, handles, tension }) =>
    set({
      waypoints: waypoints || {},
      overrides: overrides || {},
      shaped: shaped || {},
      handles: handles || {},
      tension: tension || {},
    }),
}));
