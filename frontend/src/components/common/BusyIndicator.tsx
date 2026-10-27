/**
 * The spinning wheel of patience (#38): shown once anything the user asked
 * for has run past the threshold (busyStore). The toolbar copy also turns the
 * pointer to "progress" and announces "Working…" to screen readers; the
 * in-place copy sits over the canvas, where the result will appear. With
 * reduced motion the wheel stands still.
 */

import { useEffect, useState } from "react";
import { oldestTask, useBusyStore } from "@/stores/busyStore";

/** True once the oldest in-flight task has run for the threshold. */
export function useBusyVisible(): boolean {
  const tasks = useBusyStore((s) => s.tasks);
  const threshold = useBusyStore((s) => s.thresholdMs);
  const oldest = oldestTask(tasks);
  const [, tick] = useState(0);
  const start = oldest?.start;
  const elapsed = start === undefined ? 0 : Date.now() - start;
  const visible = start !== undefined && elapsed >= threshold;
  useEffect(() => {
    if (start === undefined || visible) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, threshold - elapsed));
    return () => window.clearTimeout(t);
  }, [start, visible, threshold, elapsed]);
  return visible;
}

function Wheel({ size }: { size: number }) {
  return (
    <svg className="pnv-busy-wheel" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x="11"
          y="2"
          width="2"
          height="6"
          rx="1"
          fill="currentColor"
          opacity={0.25 + (0.75 * i) / 11}
          transform={`rotate(${i * 30} 12 12)`}
        />
      ))}
    </svg>
  );
}

export function BusyIndicator({ placement }: { placement: "toolbar" | "canvas" }) {
  const visible = useBusyVisible();
  const isToolbar = placement === "toolbar";

  useEffect(() => {
    if (!isToolbar) return;
    document.documentElement.classList.toggle("pnv-busy", visible);
    return () => document.documentElement.classList.remove("pnv-busy");
  }, [isToolbar, visible]);

  if (isToolbar) {
    return (
      <span
        data-testid="busy-indicator"
        data-visible={visible}
        role="status"
        aria-live="polite"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          color: "var(--pnv-primary)",
          fontSize: 13,
          fontWeight: 600,
          visibility: visible ? "visible" : "hidden",
        }}
      >
        {/* Always laid out, so the toolbar never shifts when it shows; the
            text is only there while it shows, for screen readers. */}
        <Wheel size={20} />
        {visible ? "Working…" : <span aria-hidden="true">Working…</span>}
      </span>
    );
  }
  if (!visible) return null;
  return (
    <div
      data-testid="busy-indicator-canvas"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 50,
        padding: 14,
        borderRadius: 16,
        background: "color-mix(in srgb, var(--pnv-surface) 85%, transparent)",
        boxShadow: "var(--pnv-shadow-popover)",
        color: "var(--pnv-text-secondary)",
        pointerEvents: "none",
      }}
    >
      <Wheel size={44} />
    </div>
  );
}
