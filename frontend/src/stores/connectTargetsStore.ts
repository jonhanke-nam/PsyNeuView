/**
 * Which nodes a connection being dragged could be dropped on (#253).
 *
 * Filled from PsyNeuLink's answer (`/api/model/connection-targets`) when a
 * drag starts from a node's connector, and cleared when it ends. Keyed by the
 * model's variable name: `null` means the drop connects, a string is the
 * plain reason it wouldn't. Nodes the answer doesn't mention stay as they are.
 */
import { create } from "zustand";

export type ConnectTargets = Record<string, string | null>;

interface ConnectTargetsState {
  /** The drag this answer belongs to; a late answer for an older drag is dropped. */
  sender: string | null;
  targets: ConnectTargets | null;
  start: (sender: string) => void;
  answer: (sender: string, targets: ConnectTargets) => void;
  clear: () => void;
}

export const useConnectTargets = create<ConnectTargetsState>((set, get) => ({
  sender: null,
  targets: null,
  start: (sender) => set({ sender, targets: null }),
  answer: (sender, targets) => {
    if (get().sender === sender) set({ targets });
  },
  clear: () => set({ sender: null, targets: null }),
}));

/** "valid", "invalid" or null (no answer for this node, or no drag). */
export function targetStatus(targets: ConnectTargets | null, varName: string | undefined): "valid" | "invalid" | null {
  if (!targets || !varName || !(varName in targets)) return null;
  return targets[varName] == null ? "valid" : "invalid";
}
