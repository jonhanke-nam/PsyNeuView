/**
 * WebSocket hook that connects to the backend and listens for file change events.
 * When the .py file is modified externally, the model and code editor are refreshed.
 * Silently retries on connection failure (e.g., during server restarts).
 */

import { useCallback, useEffect, useRef } from "react";
import { useModelStore } from "@/stores/modelStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useSyncStore } from "@/stores/syncStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { record } from "@/utils/activityLog";

const RETRY_DELAYS = [1000, 2000, 4000, 8000]; // backoff in ms

export function useFileWatcher() {
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const wsRef = useRef<WebSocket | null>(null);
  // Read inside the socket callbacks, which are created once and would
  // otherwise close over the filePath from the first render.
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set only when an external change arrives on top of unsaved in-app edits.
  const pendingChange = useExternalChangeStore((s) => s.pending);
  const setPendingChange = useExternalChangeStore((s) => s.setPending);
  const clearPendingChange = useExternalChangeStore((s) => s.clearPending);

  const applyChange = useCallback(
    (source: string, model: unknown) => {
      // Order matters: loadModelFromServer snapshots the current source as
      // savedSource, so the buffer must already hold the new text or the
      // editor comes back marked dirty against the wrong baseline.
      setSource(source);
      loadModelFromServer(model);
    },
    [setSource, loadModelFromServer],
  );

  const acceptPendingChange = useCallback(() => {
    if (!pendingChange) return;
    applyChange(pendingChange.source, pendingChange.model);
    clearPendingChange();
  }, [pendingChange, applyChange, clearPendingChange]);

  const dismissPendingChange = useCallback(() => clearPendingChange(), [clearPendingChange]);

  useEffect(() => {
    let unmounted = false;

    async function connect() {
      if (unmounted) return;

      // Check if backend is reachable before attempting WebSocket
      // (avoids browser-level "WebSocket connection failed" warnings)
      try {
        const resp = await fetch("/health");
        if (!resp.ok) throw new Error();
      } catch {
        // Backend not ready — retry silently
        const delay = RETRY_DELAYS[Math.min(retryCount.current, RETRY_DELAYS.length - 1)];
        retryCount.current++;
        retryTimer.current = setTimeout(connect, delay);
        return;
      }

      if (unmounted) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        useSyncStore.getState().setConnected(true);
        retryCount.current = 0;
        // Re-arm the watch. The backend forgets what it was watching when the
        // socket drops (and a restarted backend never knew), and filePath has
        // not changed, so the effect below will not fire on its own.
        if (filePathRef.current) {
          ws.send(JSON.stringify({ type: "watch_file", filePath: filePathRef.current }));
        }
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        // Who else is connected (#1082) — pushed on this socket because every
        // tab already opens one, so presence needs no transport of its own.
        if (message.type === "presence") {
          usePresenceStore
            .getState()
            .setPresence(!!message.available, message.others ?? []);
          return;
        }

        // The backend confirms an armed watch; without this, the socket
        // being open would be mistaken for sync being on (#1028).
        if (message.type === "watching") {
          useSyncStore.getState().setWatchedPath(message.filePath ?? null);
          return;
        }
        if (message.type === "stopped_watching") {
          useSyncStore.getState().setWatchedPath(null);
          return;
        }
        // PsyNeuLink's own code changed in the local checkout (#1225). The
        // backend has restarted the model runner; show the model as the new
        // code reads it, unless that would discard unsaved edits here.
        if (message.type === "psyneulink_changed") {
          const files: string[] = message.changedFiles ?? [];
          const names = files.map((f) => f.split("/").pop()).slice(0, 3).join(", ");
          const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
          const { source, savedSource, filePath: open } = useModelStore.getState();
          const unsaved = source !== savedSource;
          const applied = !!(message.model && message.filePath === open && !unsaved);
          record("file", `PsyNeuLink code changed on disk: ${names}${more}`, { files: files.length, applied });
          if (applied) {
            applyChange(message.source, message.model);
          }
          // One notice however many times it changes: saving PsyNeuLink files
          // one after another replaces the notice rather than stacking them
          // (#1377; the backend already folds changes within a second).
          useNotificationStore
            .getState()
            .addNotification(
              "info",
              `PsyNeuLink code changed (${names}${more}). Reloaded with the new code` +
                (unsaved ? "; save or revert your edits to see it in the graph." : "."),
              { key: "psyneulink-changed" },
            );
          return;
        }
        if (message.type !== "file_changed") return;

        // Read live state: this handler is created once and would otherwise
        // see the source from the first render.
        const { source, savedSource } = useModelStore.getState();
        const hasUnsavedEdits = source !== savedSource;
        record("file", `Model changed on disk: ${message.filePath}`, {
          path: message.filePath,
          applied: !hasUnsavedEdits,
          ...(hasUnsavedEdits ? { askedFirst: true } : {}),
        });

        if (hasUnsavedEdits) {
          // Both sides changed. Applying now would silently discard the edits
          // in this window, so ask instead (#926). A newer change supersedes
          // an older unanswered one — the question is always about the file as
          // it stands on disk right now.
          setPendingChange({
            filePath: message.filePath,
            source: message.source,
            model: message.model,
          });
          return;
        }

        applyChange(message.source, message.model);
        useSyncStore.getState().noteApplied();
      };

      ws.onclose = () => {
        useSyncStore.getState().setConnected(false);
        // Stop claiming to know who is here — the answer becomes unknown, not
        // "nobody", the moment the socket drops.
        usePresenceStore.getState().reset();
        if (unmounted) return;
        // Silent retry with backoff
        const delay = RETRY_DELAYS[Math.min(retryCount.current, RETRY_DELAYS.length - 1)];
        retryCount.current++;
        retryTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // Suppress — onclose will handle retry
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [applyChange]);

  // When filePath changes, tell the backend to watch it
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !filePath) return;
    ws.send(JSON.stringify({ type: "watch_file", filePath }));
  }, [filePath]);

  return {
    /** Non-null while an external change is waiting on the user's decision. */
    pendingChange,
    /** Take the on-disk version, discarding the unsaved in-app edits. */
    acceptPendingChange,
    /** Keep the in-app edits and leave the file on disk alone. */
    dismissPendingChange,
  };
}
