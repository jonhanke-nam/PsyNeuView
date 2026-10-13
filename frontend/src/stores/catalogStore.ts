/**
 * The user's own Open-menu catalogs and their project folder (#1229).
 *
 * Kept on the backend, in preferences: the folders are on the machine running
 * it. The Open menu lists each catalog as a section; Settings adds, renames and
 * removes them, and moves the project folder. Both read this store, so a change
 * in one shows in the other at once.
 */

import { create } from "zustand";
import { record } from "@/utils/activityLog";

export interface CatalogModel {
  name: string;
  label: string;
  path: string;
  relative: string;
  folder: string | null;
}

export interface Catalog {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  models: CatalogModel[];
}

export interface ProjectFolder {
  path: string;
  exists: boolean;
  /** Set by an environment variable, so it can't be changed from Settings. */
  fixed: boolean;
  /** The variable that set it (`fixedBy` is absent on an older backend). */
  fixedBy?: string | null;
  /** The one-time offer to move out of a hidden legacy folder (#1295); null when there is none. */
  moveOffer?: { from: string; to: string } | null;
  /** The last move's outcome, recorded for Report a Problem. */
  lastMove?: MoveRecord | null;
}

export interface MoveRecord {
  from: string;
  to: string;
  at: number;
  ok: boolean;
  files: number;
  error?: string | null;
  warning?: string | null;
}

interface CatalogState {
  projectFolder: ProjectFolder | null;
  catalogs: Catalog[];
  /** False on the shared hosted deployment. */
  canEdit: boolean;
  refresh: () => Promise<void>;
  /** Each returns an error to show, or null on success. */
  add: (path: string, name?: string) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  setProjectFolder: (path: string) => Promise<string | null>;
  /** Move the folder and everything in it (#1295): the record on success, or the error to show. */
  moveProjectFolder: (path: string) => Promise<{ record: MoveRecord } | { error: string }>;
  dismissMoveOffer: () => Promise<void>;
}

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (resp.ok) return null;
    const data = await resp.json().catch(() => ({}));
    return typeof data.detail === "string" ? data.detail : "That didn't work.";
  } catch {
    return "Couldn't reach PsyNeuView.";
  }
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  projectFolder: null,
  catalogs: [],
  canEdit: false,

  refresh: async () => {
    try {
      const resp = await fetch("/api/catalogs");
      if (!resp.ok) return;
      const data = await resp.json();
      set({
        projectFolder: data.projectFolder ?? null,
        catalogs: data.catalogs ?? [],
        canEdit: !!data.canEdit,
      });
    } catch {
      // Leave what was there; the menu still works without catalogs.
    }
  },

  add: async (path, name) => {
    const err = await call("/api/catalogs", "POST", { path, name: name || null });
    if (!err) {
      record("setting", `Catalog added: ${path}`, { key: "catalogs", action: "add", path, name: name || null });
      await get().refresh();
    }
    return err;
  },

  rename: async (id, name) => {
    const err = await call(`/api/catalogs/${encodeURIComponent(id)}`, "PATCH", { name });
    if (!err) {
      record("setting", `Catalog renamed: ${name}`, { key: "catalogs", action: "rename", id, name });
      await get().refresh();
    }
    return err;
  },

  remove: async (id) => {
    const err = await call(`/api/catalogs/${encodeURIComponent(id)}`, "DELETE");
    if (!err) {
      record("setting", `Catalog removed: ${id}`, { key: "catalogs", action: "remove", id });
      await get().refresh();
    }
    return err;
  },

  setProjectFolder: async (path) => {
    const err = await call("/api/catalogs/project-folder", "POST", { path });
    if (!err) {
      record("setting", `My Project Folder changed: ${path}`, { key: "project-folder", value: path });
      await get().refresh();
    }
    return err;
  },

  moveProjectFolder: async (path) => {
    try {
      const resp = await fetch("/api/catalogs/project-folder/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { error: typeof data.detail === "string" ? data.detail : "The move didn't work." };
      }
      await get().refresh();
      return { record: data as MoveRecord };
    } catch {
      return { error: "Couldn't reach PsyNeuView." };
    }
  },

  dismissMoveOffer: async () => {
    await call("/api/catalogs/project-folder/move-offer/dismiss", "POST");
    await get().refresh();
  },
}));
