/**
 * Zustand store for the object palette sidebar state.
 * Manages favorites, recently-used, search, and UI collapse state.
 * Persists user preferences to localStorage.
 *
 * Whether the panel is the word list or the icon strip is not remembered: it
 * starts as Settings ▸ Appearance ▸ Components panel says (#113), and the
 * panel's ◀/▶ button changes it for this session only, so nobody is left
 * stuck on the strip. The old remembered value (psynewview_palette_compact)
 * is no longer read.
 */

import { create } from "zustand";
import { loadComponentsStart } from "./componentsPanelStartStore";

const LS_FAVORITES = "psynewview_palette_favorites";
const LS_RECENTS = "psynewview_palette_recents";
const LS_OPEN = "psynewview_palette_open";
const LS_EXPANDED = "psynewview_palette_expanded";
const MAX_RECENTS = 8;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  // Storage can be blocked, or absent (the store is read under vitest, #1287).
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

// Nothing expanded to begin with, so the palette opens short and you expand
// the one category you want (#1135 did the same for the Open menu). Expanding
// all five put ~40 rows on screen before you had chosen anything.
//
// Someone who has used the palette before keeps whatever they left open: this
// is the fallback for when nothing is stored, not an override.
const DEFAULT_EXPANDED: string[] = [];

interface PaletteState {
  isOpen: boolean;
  isCompact: boolean;
  searchQuery: string;
  expandedNodes: Set<string>; // set of node IDs that are expanded
  favorites: string[];
  recentlyUsed: string[];
  compactFlyoutNodeId: string | null;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setCompact: (compact: boolean) => void;
  toggleCompact: () => void;
  setSearchQuery: (query: string) => void;
  toggleNode: (nodeId: string) => void;
  expandNode: (nodeId: string) => void;
  collapseNode: (nodeId: string) => void;
  toggleFavorite: (type: string) => void;
  addRecentlyUsed: (type: string) => void;
  openCompactFlyout: (nodeId: string) => void;
  closeCompactFlyout: () => void;

}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  isOpen: loadBool(LS_OPEN, true),
  isCompact: loadComponentsStart() === "strip",
  searchQuery: "",
  expandedNodes: new Set(loadJson<string[]>(LS_EXPANDED, DEFAULT_EXPANDED)),
  favorites: loadJson<string[]>(LS_FAVORITES, []),
  recentlyUsed: loadJson<string[]>(LS_RECENTS, []),
  compactFlyoutNodeId: null,

  setOpen: (open) => {
    localStorage.setItem(LS_OPEN, String(open));
    set({ isOpen: open });
  },
  toggleOpen: () => {
    const next = !get().isOpen;
    localStorage.setItem(LS_OPEN, String(next));
    set({ isOpen: next });
  },
  // For this session only: the setting decides how the panel starts (#113).
  setCompact: (compact) => set({ isCompact: compact }),
  toggleCompact: () => set({ isCompact: !get().isCompact }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleNode: (nodeId) => {
    const s = new Set(get().expandedNodes);
    if (s.has(nodeId)) s.delete(nodeId);
    else s.add(nodeId);
    localStorage.setItem(LS_EXPANDED, JSON.stringify([...s]));
    set({ expandedNodes: s });
  },
  expandNode: (nodeId) => {
    const s = new Set(get().expandedNodes);
    s.add(nodeId);
    localStorage.setItem(LS_EXPANDED, JSON.stringify([...s]));
    set({ expandedNodes: s });
  },
  collapseNode: (nodeId) => {
    const s = new Set(get().expandedNodes);
    s.delete(nodeId);
    localStorage.setItem(LS_EXPANDED, JSON.stringify([...s]));
    set({ expandedNodes: s });
  },
  toggleFavorite: (type) => {
    const favs = [...get().favorites];
    const idx = favs.indexOf(type);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(type);
    localStorage.setItem(LS_FAVORITES, JSON.stringify(favs));
    set({ favorites: favs });
  },
  addRecentlyUsed: (type) => {
    const recents = [type, ...get().recentlyUsed.filter((t) => t !== type)].slice(0, MAX_RECENTS);
    localStorage.setItem(LS_RECENTS, JSON.stringify(recents));
    set({ recentlyUsed: recents });
  },
  openCompactFlyout: (nodeId) => set({ compactFlyoutNodeId: nodeId }),
  closeCompactFlyout: () => set({ compactFlyoutNodeId: null }),
}));
