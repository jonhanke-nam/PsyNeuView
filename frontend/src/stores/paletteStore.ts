/**
 * Zustand store for the object palette sidebar state.
 * Manages favorites, recently-used, search, and UI collapse state.
 * Persists user preferences to localStorage.
 */

import { create } from "zustand";
import { PNL_TAXONOMY_TREE } from "../constants/pnlTypes";

const LS_FAVORITES = "psynewview_palette_favorites";
const LS_RECENTS = "psynewview_palette_recents";
const LS_OPEN = "psynewview_palette_open";
const LS_COMPACT = "psynewview_palette_compact";
// Which sections and sub-groups are open. A new key (#113): the old
// `psynewview_palette_expanded` mostly held the old all-collapsed default, so
// reading it would keep most people on the very look #113 replaces.
export const LS_EXPANDED = "psyneuview.components.expanded";
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

// The five top-level sections (Mechanisms, Projections, Compositions,
// Functions, Ports) start open, so the panel shows the names of the parts
// rather than a column of headings (#113). Their sub-groups stay closed, which
// keeps the opening list to about 30 short rows: each section shows its base
// component and the names of its sub-groups, not every variant.
//
// Someone who has collapsed a section keeps it collapsed: this is the fallback
// for when nothing is stored, not an override.
export const DEFAULT_EXPANDED: string[] = PNL_TAXONOMY_TREE.map((n) => n.id);

export function loadExpanded(): Set<string> {
  return new Set(loadJson<string[]>(LS_EXPANDED, DEFAULT_EXPANDED));
}

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
  isCompact: loadBool(LS_COMPACT, false),
  searchQuery: "",
  expandedNodes: loadExpanded(),
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
  setCompact: (compact) => {
    localStorage.setItem(LS_COMPACT, String(compact));
    set({ isCompact: compact });
  },
  toggleCompact: () => {
    const next = !get().isCompact;
    localStorage.setItem(LS_COMPACT, String(next));
    set({ isCompact: next });
  },
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
