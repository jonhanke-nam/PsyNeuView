/**
 * Notification store for displaying errors, warnings, and info messages.
 */

import { create } from "zustand";
import { record } from "@/utils/activityLog";

export type NotificationType = "error" | "warning" | "info" | "success";

/** A button on a notice, beside its text: Redo on an undo notice (#1377). */
export interface NotificationAction {
  label: string;
  onClick: () => void;
  title?: string;
  testId?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  /** Notices with the same key are one notice: a new one replaces it in place. */
  key?: string;
  action?: NotificationAction;
}

export interface NotificationOptions {
  /** Overrides the auto-dismiss dwell of an info/success notice. */
  durationMs?: number;
  /**
   * A notice with this key replaces the one showing with the same key, in
   * its place and with its dwell started again, instead of adding another
   * below it (#1377). A burst of the same message is one notice.
   */
  key?: string;
  action?: NotificationAction;
}

interface NotificationState {
  notifications: Notification[];
  /**
   * Add a notification. info/success auto-dismiss; warning/error persist until
   * dismissed. The last argument is the auto-dismiss dwell in ms (#879), or
   * options: the dwell, a `key` that makes a new notice replace the old one
   * with the same key, and an `action` button (#1377).
   */
  addNotification: (
    type: NotificationType,
    message: string,
    durationOrOptions?: number | NotificationOptions,
  ) => void;
  dismissNotification: (id: string) => void;
  /** Dismiss the notice with this key, if one is showing. */
  dismissKey: (key: string) => void;
  clearAll: () => void;
}

let nextId = 0;
/** Each notice's auto-dismiss timer, so a replaced notice's dwell restarts. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function stopTimer(id: string) {
  const t = timers.get(id);
  if (t !== undefined) clearTimeout(t);
  timers.delete(id);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: (type, message, durationOrOptions) => {
    const opts: NotificationOptions =
      typeof durationOrOptions === "number" ? { durationMs: durationOrOptions } : durationOrOptions ?? {};
    // Every message shown to the user goes in the activity log (#1287).
    record("notification", message, { type });

    const existing = opts.key ? get().notifications.find((n) => n.key === opts.key) : undefined;
    const id = existing?.id ?? `notif-${nextId++}`;
    const notif: Notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
      ...(opts.key ? { key: opts.key } : {}),
      ...(opts.action ? { action: opts.action } : {}),
    };
    stopTimer(id);
    set((state) => ({
      notifications: existing
        ? state.notifications.map((n) => (n.id === id ? notif : n))
        : [...state.notifications, notif],
    }));

    // Auto-dismiss info/success. The old flat 2s was too fast to read a
    // real message (#879); dwell now scales with message length (~4s floor,
    // 8s cap) and callers can override.
    if (type === "info" || type === "success") {
      const ms = opts.durationMs ?? Math.min(8000, Math.max(4000, message.length * 55));
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          }));
        }, ms),
      );
    }
  },

  dismissNotification: (id) => {
    stopTimer(id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  dismissKey: (key) => {
    const n = get().notifications.find((x) => x.key === key);
    if (n) get().dismissNotification(n.id);
  },

  clearAll: () => {
    for (const id of [...timers.keys()]) stopTimer(id);
    set({ notifications: [] });
  },
}));
