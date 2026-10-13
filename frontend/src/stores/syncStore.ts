/**
 * Whether the app is actually watching the file on disk (#1028).
 *
 * Lives in a store rather than in `useFileWatcher` because the hook is mounted
 * once — a second call would open a second socket — while the indicator that
 * needs this renders somewhere else entirely.
 *
 * `connected` and `watchedPath` are deliberately separate. The socket being
 * open does not mean the backend is watching anything: that gap is exactly how
 * sync failed silently for the app's whole history (#1026), and collapsing the
 * two into one boolean would hide it again.
 */

import { create } from "zustand";

interface SyncState {
  /** Is the WebSocket open right now? */
  connected: boolean;
  /** The path the backend confirmed it is watching, if any. */
  watchedPath: string | null;
  /** When an external change was last applied to the canvas. */
  lastAppliedAt: number | null;
  setConnected: (connected: boolean) => void;
  setWatchedPath: (path: string | null) => void;
  noteApplied: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  connected: false,
  watchedPath: null,
  lastAppliedAt: null,
  setConnected: (connected) =>
    // A dropped socket cannot still be watching, so clear both together rather
    // than leaving a stale path behind to read as healthy.
    set(connected ? { connected } : { connected, watchedPath: null }),
  setWatchedPath: (watchedPath) => set({ watchedPath }),
  noteApplied: () => set({ lastAppliedAt: Date.now() }),
}));
