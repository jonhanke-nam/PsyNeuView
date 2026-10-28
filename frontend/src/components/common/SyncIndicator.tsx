/**
 * A permanent, quiet statement of whether the file on disk is being watched
 * (#1028), at the right end of the model's diagnostics bar (#103).
 *
 * Separate from StatusBar, which appears only while an operation runs. The
 * point here is the opposite: it is always present while a model is open, so
 * "nothing is happening" and "nothing is connected" stop looking identical.
 *
 * It used to sit in a row of its own above the graph and did nothing when
 * clicked (#103). Now it lives in the diagnostics bar, its tooltip says what
 * it means, and a click opens a small popover: the file being watched, when it
 * last changed outside PsyNeuView, and a switch to pause watching. Pausing is
 * the backend's existing "stop_watching"; resuming is a fresh "watch_file"
 * (useFileWatcher sends both).
 */

import { useEffect, useRef, useState } from "react";

import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useModelStore } from "@/stores/modelStore";
import { useSyncStore } from "@/stores/syncStore";
import { deriveSyncState, RELOADED_MS, type SyncKind } from "@/utils/syncState";

const COLORS: Record<SyncKind, { dot: string; text: string }> = {
  watching: { dot: "var(--pnv-success)", text: "var(--pnv-text-muted)" },
  reloaded: { dot: "var(--pnv-primary)", text: "var(--pnv-primary-deep)" },
  conflict: { dot: "var(--pnv-warning)", text: "var(--pnv-warning)" },
  paused: { dot: "var(--pnv-text-hint)", text: "var(--pnv-text-muted)" },
  off: { dot: "var(--pnv-border)", text: "var(--pnv-text-hint)" },
};

/** "10:42:07 (3 min ago)": the clock time, and how long ago that was. */
export function formatLastChange(at: number, now: number): string {
  const clock = new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const secs = Math.max(0, Math.round((now - at) / 1000));
  const ago =
    secs < 10 ? "just now" :
    secs < 60 ? `${secs} s ago` :
    secs < 3600 ? `${Math.round(secs / 60)} min ago` :
    `${Math.round(secs / 3600)} h ago`;
  return `${clock} (${ago})`;
}

export function SyncIndicator() {
  const connected = useSyncStore((s) => s.connected);
  const watchedPath = useSyncStore((s) => s.watchedPath);
  const lastAppliedAt = useSyncStore((s) => s.lastAppliedAt);
  const lastChange = useSyncStore((s) => s.lastChange);
  const paused = useSyncStore((s) => s.paused);
  const setPaused = useSyncStore((s) => s.setPaused);
  const filePath = useModelStore((s) => s.filePath);
  const hasConflict = useExternalChangeStore((s) => s.pending !== null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  // "Reloaded" expires on a timer rather than on the next event, so it has to
  // re-evaluate itself — nothing else will change while it sits there.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastAppliedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    const stop = setTimeout(() => clearInterval(id), RELOADED_MS + 600);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [lastAppliedAt]);
  // Keep "3 min ago" current while the popover is open.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [open]);

  useDismiss(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const state = deriveSyncState({
    connected, watchedPath, filePath, hasConflict, lastAppliedAt, paused, now,
  });
  const color = COLORS[state.kind];
  const shownPath = watchedPath ?? filePath;
  const changed = lastChange && lastChange.path === shownPath ? lastChange : null;

  return (
    <span
      ref={ref}
      className="sync-indicator-zone"
      // The diagnostics bar expands on a click anywhere in it; a click here is
      // for the indicator alone.
      onClick={(e) => e.stopPropagation()}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        type="button"
        data-testid="sync-indicator"
        data-sync-kind={state.kind}
        title={state.hint}
        aria-label={`File sync: ${state.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "0 6px", fontSize: 11, lineHeight: "inherit", color: color.text,
          whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
          background: "none", border: "none", borderRadius: 3, fontFamily: "inherit",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7, height: 7, borderRadius: "50%", background: color.dot,
            flex: "none",
          }}
        />
        {state.label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby="sync-popover-title"
          data-testid="sync-popover"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            zIndex: 1000,
            width: 340,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            cursor: "default",
          }}
        >
          <DialogHeader title={state.label} titleId="sync-popover-title" compact onClose={() => setOpen(false)} />
          <div style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
            <div style={{ color: "var(--pnv-text-muted)", lineHeight: 1.4 }}>{state.hint}</div>
            {shownPath && (
              <div>
                <div style={{ fontSize: 11, color: "var(--pnv-text-hint)", marginBottom: 2 }}>File</div>
                <div
                  data-testid="sync-popover-path"
                  style={{
                    fontFamily: "monospace", fontSize: 11, color: "var(--pnv-text-body)",
                    background: "var(--pnv-surface-sunken)", borderRadius: 4,
                    padding: "3px 6px", wordBreak: "break-all", userSelect: "text",
                  }}
                >
                  {shownPath}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: "var(--pnv-text-hint)", marginBottom: 2 }}>Last changed outside PsyNeuView</div>
              <div data-testid="sync-popover-last-change" style={{ color: "var(--pnv-text-body)" }}>
                {changed ? formatLastChange(changed.at, now) : "Not since you opened it"}
              </div>
            </div>
            <label
              style={{
                display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                color: "var(--pnv-text-body)", borderTop: "1px solid var(--pnv-border-faint)", paddingTop: 8,
              }}
              title="Pause to stop picking up edits made outside PsyNeuView; resume to pick them up again"
            >
              <input
                type="checkbox"
                role="switch"
                data-testid="sync-pause-toggle"
                checked={!paused}
                onChange={(e) => setPaused(!e.target.checked)}
                style={{ margin: 0 }}
              />
              Watch this file for outside edits
            </label>
          </div>
        </div>
      )}
    </span>
  );
}
