/**
 * The spinning wheel of patience (#38): shown once anything the user asked
 * for has run past the threshold (busyStore).
 *
 * One wheel at a time (#220): centred over the graph when the graph is
 * showing, otherwise over the workspace (only code, only the Inspector, or
 * nothing at all). Settings ▸ Appearance can show how long it has been
 * spinning (#176), below the wheel or in its centre, once a second has passed.
 * With reduced motion the wheel stands still.
 *
 * The wheel itself is hidden from screen readers. BusyStatus, mounted once and
 * for good, turns the pointer to "progress" and announces "Working…": a live
 * region has to be on the page before its text changes for that to be read.
 */

import { useEffect, useState } from "react";
import { formatBusyElapsed, oldestTask, useBusyStore } from "@/stores/busyStore";
import { useLayoutStore } from "@/stores/layoutStore";

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
  const [seconds, setSeconds] = useState(() =>
    active && since !== null ? Math.floor((Date.now() - since) / 1000) : 0,
  );
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

/** The wheel's size: fixed, so that nothing about it changes with the digits. */
const WHEEL_SIZE = "44px";
/**
 * With the time in its centre the wheel is bigger, with short spokes round the
 * rim: the clear space inside is about 4.4 times the text size, room for
 * `1:02:09`. In terms of the text size, so it still fits at Large.
 */
const WHEEL_SIZE_WITH_CENTRE = "calc(var(--pnv-fs-13) * 6.5)";
const CARD_PADDING = "14px";

const timerText = {
  fontSize: "var(--pnv-fs-13)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
} as const;

/** The spokes turn on their own; the box round them does not, so it can be measured. */
function Wheel({ rim }: { rim: boolean }) {
  const spoke = rim
    ? { x: 11.35, y: 0.8, width: 1.3, height: 3, rx: 0.65 }
    : { x: 11, y: 2, width: 2, height: 6, rx: 1 };
  return (
    <svg className="pnv-busy-wheel" width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          {...spoke}
          fill="currentColor"
          opacity={0.25 + (0.75 * i) / 11}
          transform={`rotate(${i * 30} 12 12)`}
        />
      ))}
    </svg>
  );
}

function WheelCard({ place }: { place: BusyPlace }) {
  const timerPlace = useBusyStore((s) => s.timerPlace);
  const seconds = useBusySeconds(timerPlace !== "off");
  const inCentre = timerPlace === "center";
  const size = inCentre ? WHEEL_SIZE_WITH_CENTRE : WHEEL_SIZE;
  const text = timerPlace === "off" ? "" : elapsedText(seconds);
  return (
    <div
      data-testid="busy-wheel"
      data-place={place}
      aria-hidden="true"
      style={{
        position: "absolute",
        // Hung from the top, so the wheel's own centre is the pane's centre and
        // the card can grow downwards when the time appears, leaving it put.
        top: `calc(50% - ${size} / 2 - ${CARD_PADDING})`,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: CARD_PADDING,
        borderRadius: 16,
        background: "color-mix(in srgb, var(--pnv-surface) 85%, transparent)",
        boxShadow: "var(--pnv-shadow-popover)",
        color: "var(--pnv-text-secondary)",
        pointerEvents: "none",
      }}
    >
      <div data-testid="busy-wheel-box" style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <Wheel rim={inCentre} />
        {inCentre && text && (
          <div
            data-testid="busy-elapsed"
            style={{ ...timerText, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
          >
            {text}
          </div>
        )}
      </div>
      {!inCentre && text && (
        <div data-testid="busy-elapsed" style={{ ...timerText, marginTop: 6, textAlign: "center" }}>
          {text}
        </div>
      )}
    </div>
  );
}

export type BusyPlace = "graph" | "workspace";

/**
 * Mounted in both places; only the one that applies draws anything. Layout is
 * read here so that one wheel at a time holds however the panels change.
 */
export function BusyIndicator({ place }: { place: BusyPlace }) {
  const visible = useBusyVisible();
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  if (!visible || graphVisible !== (place === "graph")) return null;
  return <WheelCard place={place} />;
}

/** The "progress" pointer and the announcement, whatever is on screen. */
export function BusyStatus() {
  const visible = useBusyVisible();
  useEffect(() => {
    document.documentElement.classList.toggle("pnv-busy", visible);
    return () => document.documentElement.classList.remove("pnv-busy");
  }, [visible]);
  return (
    <span
      data-testid="busy-indicator"
      data-visible={visible}
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
      }}
    >
      {visible ? "Working…" : ""}
    </span>
  );
}
