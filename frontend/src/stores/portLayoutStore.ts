/**
 * Per-node, per-port position overrides (#282).
 *
 * By default ports are auto-distributed along their role's arc of the node
 * oval. This store lets the user place a specific port anywhere on the oval by
 * dragging it; the override is an **ellipse-parameter angle** in radians
 * (0 = right, π/2 = bottom, π = left, −π/2 = top). Session-scoped for now —
 * persistence to the layout sidecar is a follow-up (mirrors node positions).
 */

import { create } from "zustand";

interface PortLayoutState {
  /** nodeId → portKey ("input:Name" / "output:Name" / "param:Name") → angle (rad). */
  overrides: Record<string, Record<string, number>>;
  setOverride: (nodeId: string, portKey: string, angle: number) => void;
  clearNode: (nodeId: string) => void;
  clearAll: () => void;
  /** Replace the whole map — used to hydrate from a loaded sidecar (#282). */
  hydrate: (overrides: Record<string, Record<string, number>>) => void;
}

export const usePortLayout = create<PortLayoutState>((set) => ({
  overrides: {},
  setOverride: (nodeId, portKey, angle) =>
    set((s) => ({
      overrides: {
        ...s.overrides,
        [nodeId]: { ...(s.overrides[nodeId] || {}), [portKey]: angle },
      },
    })),
  clearNode: (nodeId) =>
    set((s) => {
      if (!s.overrides[nodeId]) return s;
      const next = { ...s.overrides };
      delete next[nodeId];
      return { overrides: next };
    }),
  clearAll: () => set({ overrides: {} }),
  hydrate: (overrides) => set({ overrides: overrides || {} }),
}));
