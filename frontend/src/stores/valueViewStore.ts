/**
 * How each node's values are shown: as a list of numbers, or as a grid of
 * shaded cells of a chosen width (#1387).
 *
 * One choice per node, used in the Run panel's results, Run State and the
 * value pill on the canvas. Kept in the model's layout file (`valueViews` in
 * `.pnlview.json`, keyed by node name) like the other per-node view settings,
 * so it comes back when the model is reopened. Saving goes through
 * `utils/valueViewSave.ts`, which knows the open file.
 */

import { create } from "zustand";

export type ValueViewKind = "list" | "grid";
export type ValueView = { as: ValueViewKind; width?: number };

/** A node's key: its name without the session suffix ("hopfield-2" → "hopfield"). */
export function valueViewKey(name: string): string {
  return name.replace(/-\d+$/, "");
}

/** Only well-formed entries from a layout file; anything else is dropped. */
export function sanitizeValueViews(raw: unknown): Record<string, ValueView> {
  const out: Record<string, ValueView> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [node, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const as = (v as { as?: unknown }).as;
    if (as !== "list" && as !== "grid") continue;
    const width = (v as { width?: unknown }).width;
    out[node] =
      typeof width === "number" && Number.isInteger(width) && width >= 1 ? { as, width } : { as };
  }
  return out;
}

interface ValueViewState {
  views: Record<string, ValueView>;
  setView: (node: string, view: ValueView) => void;
  /** Replace every choice, from a loaded layout file. */
  hydrate: (raw: unknown) => void;
}

export const useValueViews = create<ValueViewState>((set) => ({
  views: {},
  setView: (node, view) =>
    set((s) => ({ views: { ...s.views, [valueViewKey(node)]: view } })),
  hydrate: (raw) => set({ views: sanitizeValueViews(raw) }),
}));

/** The choice for a node, by any of its names (label, varName, log name). */
export function valueViewFor(
  views: Record<string, ValueView>,
  ...names: (string | null | undefined)[]
): ValueView | undefined {
  for (const n of names) {
    if (!n) continue;
    const v = views[n] ?? views[valueViewKey(n)];
    if (v) return v;
  }
  return undefined;
}
