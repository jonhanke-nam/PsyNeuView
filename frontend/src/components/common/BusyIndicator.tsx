/**
 * The spinning wheel of patience (#38): shown once anything the user asked
 * for has run past the threshold (busyStore). The toolbar copy also turns the
 * pointer to "progress" and announces "Working…" to screen readers; the
 * in-place copy sits over the canvas, where the result will appear. With
 * reduced motion every style stands still. Settings can also show how long
 * it has been spinning (#176), in either place or both, and choose what it
 * looks like (#169): the classic wheel, or a PsyNeuLink-style network among
 * others. Every style takes the same space, so nothing moves when it changes.
 */

import { useEffect, useState, type ReactNode } from "react";
import { formatBusyElapsed, oldestTask, useBusyStore, type BusyStyle } from "@/stores/busyStore";

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

/** The picture's frame: a 24-unit square drawn at `size`, in the text colour. */
function Frame({
  size,
  className,
  children,
}: {
  size: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Today's wheel: twelve fading spokes that step round. */
function Wheel({ size }: { size: number }) {
  return (
    <Frame size={size} className="pnv-busy-wheel pnv-busy-anim">
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
    </Frame>
  );
}

/** One arc going round a faint circle. */
function Ring({ size }: { size: number }) {
  return (
    <Frame size={size} className="pnv-busy-turn pnv-busy-anim">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </Frame>
  );
}

/** An oval node like the canvas's, lit up in turn by the pulse animation. */
function Node({ cx, cy, rx, ry, delay }: { cx: number; cy: number; rx: number; ry: number; delay: number }) {
  return (
    <ellipse
      className="pnv-busy-pulse pnv-busy-anim"
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill="currentColor"
      fillOpacity={NODE_REST}
      stroke="currentColor"
      strokeWidth="1.4"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

/** How bright a node is between pulses (the CSS keyframes come back to it). */
const NODE_REST = 0.15;
const NODE_RX = 4;
const NODE_RY = 2.6;
/** The network's three nodes, on a circle round the middle, clockwise. */
const NETWORK_NODES: [number, number][] = [
  [12, 4.5],
  [18.5, 15.75],
  [5.5, 15.75],
];

/** How far the oval's edge is from its centre, heading in direction (dx, dy). */
function ovalRadius(dx: number, dy: number): number {
  const len = Math.hypot(dx, dy);
  const cos = dx / len;
  const sin = dy / len;
  return (NODE_RX * NODE_RY) / Math.hypot(NODE_RY * cos, NODE_RX * sin);
}

/** A projection from one node's edge to the next's, with its arrowhead. */
function Projection({ from, to }: { from: [number, number]; to: [number, number] }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const gap = 0.8;
  const start = ovalRadius(dx, dy) + gap;
  const end = len - ovalRadius(-dx, -dy) - gap;
  const x1 = from[0] + ux * start;
  const y1 = from[1] + uy * start;
  const x2 = from[0] + ux * end;
  const y2 = from[1] + uy * end;
  const head = 2.4;
  const half = 1.4;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const r = (n: number) => Math.round(n * 100) / 100;
  const points = [
    [x2, y2],
    [bx - uy * half, by + ux * half],
    [bx + uy * half, by - ux * half],
  ]
    .map(([x, y]) => `${r(x)},${r(y)}`)
    .join(" ");
  return (
    <>
      <line x1={r(x1)} y1={r(y1)} x2={r(bx)} y2={r(by)} stroke="currentColor" strokeWidth="1.2" />
      <polygon points={points} fill="currentColor" />
    </>
  );
}

/** PsyNeuLink-style: three nodes in a triangle, joined by projections, turning slowly. */
function Network({ size }: { size: number }) {
  return (
    <Frame size={size} className="pnv-busy-turn-slow pnv-busy-anim">
      {NETWORK_NODES.map((from, i) => (
        <Projection key={i} from={from} to={NETWORK_NODES[(i + 1) % 3]} />
      ))}
      {NETWORK_NODES.map(([cx, cy], i) => (
        <Node key={i} cx={cx} cy={cy} rx={NODE_RX} ry={NODE_RY} delay={i * 0.4} />
      ))}
    </Frame>
  );
}

/** Three nodes in a row, input → hidden → output, lighting up left to right. */
function PulsingNodes({ size }: { size: number }) {
  return (
    <Frame size={size}>
      {[4, 12, 20].map((cx, i) => (
        <Node key={i} cx={cx} cy={12} rx={3.4} ry={2.4} delay={i * 0.4} />
      ))}
    </Frame>
  );
}

/** One node with a signal circling it, like a recurrent projection. */
function Orbit({ size }: { size: number }) {
  return (
    <Frame size={size} className="pnv-busy-turn-orbit pnv-busy-anim">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity={NODE_REST} stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="3.5" r="2.2" fill="currentColor" />
    </Frame>
  );
}

/** A thin bar with a segment sliding along it. */
function Bar({ size }: { size: number }) {
  return (
    <Frame size={size}>
      <rect x="0" y="10.5" width="24" height="3" rx="1.5" fill="currentColor" opacity="0.25" />
      <rect className="pnv-busy-slide pnv-busy-anim" x="0" y="10.5" width="8" height="3" rx="1.5" fill="currentColor" />
    </Frame>
  );
}

/**
 * The picture for a style, `size` pixels square (so every style takes the same
 * space): nothing at all for Text only, which keeps the space.
 */
export function BusyGraphic({ style, size }: { style: BusyStyle; size: number }) {
  switch (style) {
    case "network":
      return <Network size={size} />;
    case "ring":
      return <Ring size={size} />;
    case "nodes":
      return <PulsingNodes size={size} />;
    case "orbit":
      return <Orbit size={size} />;
    case "bar":
      return <Bar size={size} />;
    case "text":
      return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }} />;
    default:
      return <Wheel size={size} />;
  }
}

export function BusyIndicator({ placement }: { placement: "toolbar" | "canvas" }) {
  const visible = useBusyVisible();
  const isToolbar = placement === "toolbar";
  const timerPlace = useBusyStore((s) => s.timerPlace);
  const style = useBusyStore((s) => s.style);
  const showTimer = timerPlace === "both" || timerPlace === placement;
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
        data-style={style}
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
        <BusyGraphic style={style} size={20} />
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
      data-style={style}
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
      {style === "text" ? (
        <div style={{ lineHeight: "44px", padding: "0 6px", fontSize: "var(--pnv-fs-14)", fontWeight: 600 }}>Working…</div>
      ) : (
        <BusyGraphic style={style} size={44} />
      )}
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
