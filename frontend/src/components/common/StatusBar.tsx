/**
 * Status bar — shows a thin animated bar when async operations are in progress.
 * Appears below the notification bar with a pulsing message.
 */

import { useEffect, useState } from "react";

import { useStatusStore } from "@/stores/statusStore";

export function StatusBar() {
  const message = useStatusStore((s) => s.message);
  const startedAt = useStatusStore((s) => s.startedAt);

  // Live elapsed counter (#874): a slow load reads as *working*, not frozen.
  // Ticks ~4x/second so whole seconds update promptly; shown once the op has
  // run long enough to be worth reporting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!message || startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [message, startedAt]);

  if (!message) return null;

  const elapsedS = startedAt != null ? (now - startedAt) / 1000 : 0;

  return (
    <div
      data-testid="status-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 16px",
        background: "var(--pnv-primary-tint)",
        borderBottom: "1px solid var(--pnv-primary-tint-border)",
        fontSize: 12,
        color: "var(--pnv-primary)",
        animation: "statusPulse 1.5s ease-in-out infinite",
      }}
    >
      <span style={{ display: "inline-block", animation: "statusSpin 1s linear infinite" }}>
        &#9696;
      </span>
      <span>{message}</span>
      {elapsedS >= 0.8 && (
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>
          {elapsedS.toFixed(elapsedS < 10 ? 1 : 0)}s
        </span>
      )}
      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes statusSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
