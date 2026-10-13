/**
 * A permanent, quiet statement of whether the file on disk is being watched
 * (#1028).
 *
 * Separate from StatusBar, which appears only while an operation runs. The
 * point here is the opposite: it is always present, so "nothing is happening"
 * and "nothing is connected" stop looking identical.
 */

import { useEffect, useState } from "react";

import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useModelStore } from "@/stores/modelStore";
import { useSyncStore } from "@/stores/syncStore";
import { deriveSyncState, RELOADED_MS, type SyncKind } from "@/utils/syncState";

const COLORS: Record<SyncKind, { dot: string; text: string }> = {
  watching: { dot: "var(--pnv-success)", text: "var(--pnv-text-muted)" },
  reloaded: { dot: "var(--pnv-primary)", text: "var(--pnv-primary-deep)" },
  conflict: { dot: "var(--pnv-warning)", text: "var(--pnv-warning)" },
  off: { dot: "var(--pnv-border)", text: "var(--pnv-text-hint)" },
};

export function SyncIndicator() {
  const connected = useSyncStore((s) => s.connected);
  const watchedPath = useSyncStore((s) => s.watchedPath);
  const lastAppliedAt = useSyncStore((s) => s.lastAppliedAt);
  const filePath = useModelStore((s) => s.filePath);
  const hasConflict = useExternalChangeStore((s) => s.pending !== null);

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

  const state = deriveSyncState({
    connected, watchedPath, filePath, hasConflict, lastAppliedAt, now,
  });
  const color = COLORS[state.kind];

  return (
    <div
      title={state.hint}
      aria-label={`File sync: ${state.label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "2px 8px", fontSize: 11.5, color: color.text,
        whiteSpace: "nowrap", cursor: "help", userSelect: "none",
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
    </div>
  );
}
