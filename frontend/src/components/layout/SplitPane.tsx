/**
 * Two panes and the handle between them (#418). Replaces the Allotment
 * splitters, whose sash could be neither focused nor given a collapse tab.
 *
 * Sizes work as Allotment's did, so a stored layout keeps its shape: the
 * stored pair is a proportion (pixels from a drag, or the defaults' 25/75),
 * each pane grows in that proportion, and a window resize scales both. Each
 * pane has a minimum. A hidden pane stays mounted at zero size (its state is
 * kept); the other fills the split.
 *
 * One pane is the collapsible one, and the handle on its edge (PanelHandle)
 * collapses and restores it. The handle stays on the edge while that pane is
 * collapsed, so it always comes back from where it went.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PanelHandle, type Direction } from "@/components/common/PanelHandle";

export interface SplitPaneProps {
  /** "row": side by side, a vertical line between. "column": stacked, a horizontal line. */
  direction: "row" | "column";
  /** The stored proportion [first, second]. */
  sizes: number[];
  /** A drag or a key press ended: the pixel sizes [first, second], to persist. */
  onSizesChange: (sizes: number[]) => void;
  first: ReactNode;
  second: ReactNode;
  firstVisible: boolean;
  secondVisible: boolean;
  firstMin: number;
  secondMin: number;
  /** Which pane the handle collapses. */
  collapsible: "first" | "second";
  /** The collapsible pane's element id (aria-controls). */
  paneId: string;
  /** Show or hide the collapsible pane. */
  onToggle: () => void;
  /** e.g. "the code editor": the tab says "Collapse the code editor" / "Show the code editor". */
  paneName: string;
  /** Collapsed, the tab moves down clear of the controls beside it (PanelHandle). */
  collapsedAvoidsControls?: boolean;
  /** What, when it changes, may have moved those controls. */
  recheckKey?: string;
  testId?: string;
  handleTestId?: string;
  tabTestId?: string;
}

export function SplitPane({
  direction,
  sizes,
  onSizesChange,
  first,
  second,
  firstVisible,
  secondVisible,
  firstMin,
  secondMin,
  collapsible,
  paneId,
  onToggle,
  paneName,
  collapsedAvoidsControls,
  recheckKey,
  testId,
  handleTestId,
  tabTestId,
}: SplitPaneProps) {
  const row = direction === "row";
  const containerRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  // The proportion on screen: the stored one until a drag changes it.
  const [live, setLive] = useState<number[]>(() => normalise(sizes));
  useLayoutEffect(() => setLive(normalise(sizes)), [sizes]);
  // The total and the first pane's size when a drag began.
  const dragStart = useRef<{ total: number; first: number } | null>(null);
  // Re-render on container resize, so the separator's aria-value stays true.
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = useCallback(() => {
    const c = containerRef.current?.getBoundingClientRect();
    const f = firstRef.current?.getBoundingClientRect();
    const total = c ? (row ? c.width : c.height) : 0;
    const firstPx = f ? (row ? f.width : f.height) : 0;
    return { total, first: firstPx };
  }, [row]);

  const clampFirst = (px: number, total: number) =>
    Math.max(firstMin, Math.min(total - secondMin, px));

  const both = firstVisible && secondVisible;
  const expanded = collapsible === "first" ? firstVisible : secondVisible;

  const { total, first: firstNow } = measure();
  const collapsibleNow = collapsible === "first" ? firstNow : total - firstNow;
  const pct = (px: number) => (total > 0 ? (100 * px) / total : 0);
  const collapsibleMin = collapsible === "first" ? firstMin : secondMin;
  const otherMin = collapsible === "first" ? secondMin : firstMin;

  const commit = (firstPx: number, totalPx: number) => {
    const next = [Math.round(firstPx), Math.round(totalPx - firstPx)];
    setLive(next);
    onSizesChange(next);
  };

  const resize = {
    disabled: !both,
    valueNow: pct(collapsibleNow),
    valueMin: pct(collapsibleMin),
    valueMax: Math.max(pct(collapsibleMin), 100 - pct(otherMin)),
    onDragStart: () => {
      dragStart.current = measure();
    },
    onDragMove: (delta: number) => {
      const s = dragStart.current;
      if (!s) return;
      const f = clampFirst(s.first + delta, s.total);
      setLive([f, s.total - f]);
    },
    onDragEnd: () => {
      const s = dragStart.current;
      dragStart.current = null;
      if (!s) return;
      const m = measure();
      commit(m.first, m.total);
    },
    onStep: (delta: number) => {
      const m = measure();
      commit(clampFirst(m.first + delta, m.total), m.total);
    },
  };

  const foldToward: Direction =
    collapsible === "first" ? (row ? "left" : "up") : row ? "right" : "down";

  // A hidden pane stays laid out at zero size and invisible, as Allotment
  // kept it, so what is inside it keeps its state and measures itself. With
  // both hidden (a blank screen, #215), the first keeps the space, still
  // invisible: the graph inside it must have a size to start a walkthrough
  // opened by its link.
  const paneStyle = (grow: number, min: number, visible: boolean, isFirst: boolean): React.CSSProperties => {
    const keepsSpace = visible || (isFirst && !firstVisible && !secondVisible);
    return {
      flex: !keepsSpace ? "0 0 0px" : both ? `${grow} 1 0px` : "1 1 0px",
      visibility: visible ? undefined : "hidden",
      [row ? "minWidth" : "minHeight"]: visible && both ? min : 0,
      [row ? "minHeight" : "minWidth"]: 0,
      position: "relative",
      overflow: "hidden",
    };
  };

  const label = paneName;
  return (
    <div
      ref={containerRef}
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div ref={firstRef} id={collapsible === "first" ? paneId : undefined} style={paneStyle(live[0], firstMin, firstVisible, true)}>
        {first}
      </div>
      {/* A zero-size slot on the edge: the handle sits across it and takes no space. */}
      <div style={{ flex: "0 0 0px", position: "relative", zIndex: 35 }}>
        <PanelHandle
          orientation={row ? "vertical" : "horizontal"}
          foldToward={foldToward}
          expanded={expanded}
          onToggle={onToggle}
          controls={paneId}
          collapseLabel={`Collapse ${label}`}
          expandLabel={`Show ${label}`}
          resizeLabel={`Resize ${label}`}
          resize={resize}
          testId={handleTestId}
          tabTestId={tabTestId}
          collapsedAvoidsControls={collapsedAvoidsControls}
          recheckKey={recheckKey}
          at={edgeAt(firstVisible, secondVisible)}
        />
      </div>
      <div id={collapsible === "second" ? paneId : undefined} style={paneStyle(live[1], secondMin, secondVisible, false)}>
        {second}
      </div>
    </div>
  );
}

/** A proportion with two positive parts. */
function normalise(sizes: number[]): number[] {
  const a = sizes[0] > 0 ? sizes[0] : 1;
  const b = sizes[1] > 0 ? sizes[1] : 1;
  return [a, b];
}

/**
 * Where the handle's slot is when a pane is hidden: at the split's start or
 * end edge. There the band moves inside the window and the tab sits wholly
 * on screen (index.css, `.pnv-handle[data-at]`).
 */
function edgeAt(firstVisible: boolean, secondVisible: boolean): "start" | "end" | undefined {
  if (!firstVisible) return "start";
  if (!secondVisible) return "end";
  return undefined;
}
