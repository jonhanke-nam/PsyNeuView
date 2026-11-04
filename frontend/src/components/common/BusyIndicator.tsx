/**
 * The spinning wheel of patience (#38): shown once anything the user asked
 * for has run past the threshold (busyStore). The toolbar copy also turns the
 * pointer to "progress" and announces "Working…" to screen readers; the
 * in-place copy sits over the canvas, where the result will appear. With
 * reduced motion the wheel stands still. Settings can also show how long it
 * has been spinning (#176), in either place or both.
 */

import { useEffect, useState } from "react";
import { formatBusyElapsed, oldestTask, useBusyStore } from "@/stores/busyStore";

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

/** Whole seconds this stretch of busyness has lasted, while `active`. */
function useBusySeconds(active: boolean): number {
  const since = useBusyStore((s) => s.busySince);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active || since === null) {
      setSeconds(0);
      return;
    }
    const update = () => setSeconds(Math.floor((Date.now() - since) / 1000));
    update();
    // Polled often so it changes close to the second; it renders only then.
    const t = window.setInterval(update, 250);
    return () => window.clearInterval(t);
  }, [active, since]);
  return seconds;
}

/** Nothing for the first second, when a time would only be a distraction. */
const elapsedText = (seconds: number) => (seconds >= 1 ? formatBusyElapsed(seconds) : "");

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
  const timerPlace = useBusyStore((s) => s.timerPlace);
  const showTimer = timerPlace !== "off";
  const seconds = useBusySeconds(visible && showTimer);

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
          fontSize: "var(--pnv-fs-13)",
          fontWeight: 600,
          visibility: visible ? "visible" : "hidden",
        }}
      >
        {/* Always laid out, so the toolbar never shifts when it shows; the
            text is only there while it shows, for screen readers. */}
        <Wheel size={20} />
        {visible ? "Working…" : <span aria-hidden="true">Working…</span>}
        {/* Width reserved so the toolbar doesn't move; hidden from screen
            readers, which would otherwise read it out every second. */}
        {showTimer && (
          <span
            data-testid="busy-elapsed"
            aria-hidden="true"
            style={{ display: "inline-block", minWidth: "5ch", fontVariantNumeric: "tabular-nums" }}
          >
            {elapsedText(seconds)}
          </span>
        )}
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
      {showTimer && (
        <div
          data-testid="busy-elapsed-canvas"
          style={{
            minHeight: "1.3em",
            textAlign: "center",
            fontSize: "var(--pnv-fs-13)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {elapsedText(seconds)}
        </div>
      )}
    </div>
  );
}
