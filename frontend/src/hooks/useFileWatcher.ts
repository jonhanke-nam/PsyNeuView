/**
 * WebSocket hook that connects to the backend and listens for file change events.
 * When the .py file is modified externally, the model and code editor are refreshed.
 * Silently retries on connection failure (e.g., during server restarts).
 */

import { useCallback, useEffect, useRef } from "react";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useSyncStore } from "@/stores/syncStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { record } from "@/utils/activityLog";

const RETRY_DELAYS = [1000, 2000, 4000, 8000]; // backoff in ms

/**
 * The model's file as it is on disk now, with its graph: what "Load from disk"
 * takes (#1). Null when it can't be read, so the caller can fall back.
 */
export async function readDiskVersion(
  filePath: string,
  doFetch: typeof fetch = fetch,
): Promise<{ source: string; model: unknown } | null> {
  try {
    const { flat, pytorch } = useGraphSettings.getState();
    const resp = await doFetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, flat, pytorch }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data?.source === "string" ? { source: data.source, model: data.model } : null;
  } catch {
    return null;
  }
}

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

  const acceptPendingChange = useCallback(async () => {
    if (!pendingChange) return;
    // Read the file now (#1): the prompt holds the text from when the change
    // was seen, and the other editor may have saved again since. The snapshot
    // is used only if the file can't be read.
    const fresh = await readDiskVersion(pendingChange.filePath);
    applyChange(fresh?.source ?? pendingChange.source, fresh ? fresh.model : pendingChange.model);
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
        if (filePathRef.current && !useSyncStore.getState().paused) {
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

        useSyncStore.getState().noteChange(message.filePath);

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

  // When filePath changes, or watching is paused or resumed from the
  // indicator (#103), tell the backend what to watch. The backend already
  // knows "stop_watching"; pausing is that, and resuming is a fresh watch.
  const paused = useSyncStore((s) => s.paused);
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (paused) {
      ws.send(JSON.stringify({ type: "stop_watching" }));
      return;
    }
    if (!filePath) return;
    ws.send(JSON.stringify({ type: "watch_file", filePath }));
  }, [filePath, paused]);

  // Resuming catches up (#103): a fresh watch takes the file as it is now as
  // its baseline, so an edit made while paused would otherwise never arrive.
  // Treat it as the change it is: take it if nothing here is unsaved, ask if
  // something is.
  const wasPaused = useRef(paused);
  useEffect(() => {
    const resumed = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (!resumed || !filePath) return;
    let cancelled = false;
    void readDiskVersion(filePath).then((disk) => {
      if (cancelled || !disk) return;
      const { source, savedSource, filePath: open } = useModelStore.getState();
      if (open !== filePath || disk.source === savedSource) return;
      useSyncStore.getState().noteChange(filePath);
      record("file", `Model changed on disk while watching was paused: ${filePath}`, {
        path: filePath,
        applied: source === savedSource,
      });
      if (source !== savedSource) {
        setPendingChange({ filePath, source: disk.source, model: disk.model });
        return;
      }
      applyChange(disk.source, disk.model);
      useSyncStore.getState().noteApplied();
    });
    return () => {
      cancelled = true;
    };
  }, [paused, filePath, applyChange, setPendingChange]);

  return {
    /** Non-null while an external change is waiting on the user's decision. */
    pendingChange,
    /** Take the on-disk version, discarding the unsaved in-app edits. */
    acceptPendingChange,
    /** Keep the in-app edits and leave the file on disk alone. */
    dismissPendingChange,
  };
}
