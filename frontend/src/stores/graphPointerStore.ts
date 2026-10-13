/**
 * Which pointer the graph view shows, and how big: Settings ▸ Appearance. (#1301)
 *
 * Remembered per browser, like the Open menu's order (#1135) and the keyboard
 * overrides (#1112): the hosted PsyNeuView is one backend shared by several
 * people, and a pointer is a personal preference. Storage can be blocked (a
 * private window, a locked-down browser), so every access is wrapped and the
 * defaults stand in.
 */

import { create } from "zustand";
import { recordSettingChanged } from "@/utils/activityLog";
import {
  DEFAULT_GRAPH_POINTER,
  DEFAULT_POINTER_SIZE,
  isGraphPointer,
  isPointerSize,
  type GraphPointer,
  type PointerSize,
} from "@/utils/graphCursor";

export const GRAPH_POINTER_KEY = "psyneuview.graph.pointer";
export const POINTER_SIZE_KEY = "psyneuview.graph.pointerSize";

function loadPointer(): GraphPointer {
  try {
    const stored = localStorage.getItem(GRAPH_POINTER_KEY);
    return isGraphPointer(stored) ? stored : DEFAULT_GRAPH_POINTER;
  } catch {
    return DEFAULT_GRAPH_POINTER;
  }
}

function loadSize(): PointerSize {
  try {
    const stored = localStorage.getItem(POINTER_SIZE_KEY);
    return isPointerSize(stored) ? stored : DEFAULT_POINTER_SIZE;
  } catch {
    return DEFAULT_POINTER_SIZE;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice holds for this page, and the default
    // returns next time. Nothing else to do.
  }
}

interface GraphPointerState {
  pointer: GraphPointer;
  size: PointerSize;
  setPointer: (pointer: GraphPointer) => void;
  setSize: (size: PointerSize) => void;
}

export const useGraphPointerStore = create<GraphPointerState>((set) => ({
  pointer: loadPointer(),
  size: loadSize(),
  setPointer: (pointer) => {
    remember(GRAPH_POINTER_KEY, pointer);
    recordSettingChanged("graph-pointer", pointer);
    set({ pointer });
  },
  setSize: (size) => {
    remember(POINTER_SIZE_KEY, size);
    recordSettingChanged("graph-pointer-size", size);
    set({ size });
  },
}));
