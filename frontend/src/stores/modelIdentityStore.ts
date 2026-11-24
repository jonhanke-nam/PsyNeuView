/**
 * Which model is open, as the server names it (#422).
 *
 * Every open route returns `identity` (menu label, file, source); the open
 * handlers hand it here with `note`. A model opened some other way — a Recent
 * entry, a saved copy, a drop — has none yet, so `ensure` asks
 * `/api/model/identity` for it. Keyed by path: the identity shown is always
 * the one for the file that is open, never a guess from the file name.
 */

import { create } from "zustand";
import type { ModelIdentity } from "@/utils/modelTitle";

interface ModelIdentityState {
  byPath: Record<string, ModelIdentity>;
  note: (identity: ModelIdentity | null | undefined) => void;
  ensure: (path: string | null | undefined) => Promise<void>;
}

const pending = new Set<string>();

export const useModelIdentityStore = create<ModelIdentityState>((set, get) => ({
  byPath: {},
  note: (identity) => {
    if (!identity?.path) return;
    set((s) => ({ byPath: { ...s.byPath, [identity.path]: identity } }));
  },
  ensure: async (path) => {
    if (!path || get().byPath[path] || pending.has(path)) return;
    pending.add(path);
    try {
      const resp = await fetch(`/api/model/identity?file_path=${encodeURIComponent(path)}`);
      if (resp.ok) get().note((await resp.json()) as ModelIdentity);
    } catch {
      // The title falls back to the file name until the next open.
    } finally {
      pending.delete(path);
    }
  },
}));

/** The identity of the file at `path`, once known. */
export function useModelIdentity(path: string | null | undefined): ModelIdentity | null {
  return useModelIdentityStore((s) => (path ? s.byPath[path] ?? null : null));
}
