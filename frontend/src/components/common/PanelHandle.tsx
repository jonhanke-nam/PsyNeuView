/**
 * The one control on a panel's edge (#418, design A): a thin resize line
 * with a small tab holding an arrow.
 *
 *  - Drag the line (or the tab) to resize. A press that moves less than
 *    DRAG_THRESHOLD_PX is a click, so a click on the tab never resizes and
 *    a drag never collapses.
 *  - Click the tab, or press Enter on the focused line, to collapse or
 *    restore the pane. A collapsed pane keeps its handle on the edge, so it
 *    always comes back from where it went.
 *  - The arrow points the way the content will move: an open pane's arrow
 *    points to the edge it folds into, a collapsed pane's into the window.
 *
 * Keyboard and ARIA follow the WAI-ARIA "window splitter" pattern: the line
 * is `role="separator"`, focusable, with `aria-valuenow` (the controlled
 * pane's share of the split, in percent); the arrow keys along its axis
 * resize it, Home and End take it to its limits, and Enter collapses and
 * restores. The tab is a real <button> with `aria-expanded` and
 * `aria-controls`. It is the line's sibling, not its child, because a
 * separator's children are presentational and would hide the button.
 *
 * Tab placement (the owner's accepted defaults): the top of a vertical
 * edge and the right end of a horizontal one. The visible tab is 14×36 or
 * 40×14; its hit area is padded to at least 24×24, wide rather than tall.
 * Styling is in index.css (`.pnv-handle…`), all colour tokens.
 *
 * docs/ui-interaction-conventions.md ("Expand and collapse") is the standard.
 */

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

/** A press that moves this far is a drag, not a click. */
export const DRAG_THRESHOLD_PX = 3;
/** One arrow-key press moves the line this far; with Shift, KEY_STEP_LARGE_PX. */
export const KEY_STEP_PX = 10;
export const KEY_STEP_LARGE_PX = 50;

export type Direction = "left" | "right" | "up" | "down";

const OPPOSITE: Record<Direction, Direction> = { left: "right", right: "left", up: "down", down: "up" };
const ROTATION: Record<Direction, number> = { right: 0, down: 90, left: 180, up: 270 };

/** The direction a handle's arrow points: where the content will move when pressed. */
export function arrowDirection(foldToward: Direction, expanded: boolean): Direction {
  return expanded ? foldToward : OPPOSITE[foldToward];
}

/**
 * What a key on the focused separator does: "toggle" (Enter), a resize step
 * in pixels along the line's axis (+ = right / down), or nothing. Arrow keys
 * across the axis do nothing, so they stay free for the page.
 */
export function separatorKeyAction(
  key: string,
  shift: boolean,
  orientation: "vertical" | "horizontal",
): "toggle" | number | null {
  if (key === "Enter") return "toggle";
  const step = shift ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
  const vertical = orientation === "vertical";
  if (key === (vertical ? "ArrowLeft" : "ArrowUp")) return -step;
  if (key === (vertical ? "ArrowRight" : "ArrowDown")) return step;
  if (key === "Home") return -1e6;
  if (key === "End") return 1e6;
  return null;
}

/**
 * Tells a click from a drag. A press becomes a drag once it has moved
 * DRAG_THRESHOLD_PX along the line's axis; until then a release is a click.
 */
export class PressTracker {
  private start: { x: number; y: number; id: number } | null = null;
  dragging = false;
  constructor(private readonly vertical: boolean) {}
  down(x: number, y: number, id: number) {
    this.start = { x, y, id };
    this.dragging = false;
  }
  /** The move's distance along the axis, and whether this move began the drag; null when no press is under way. */
  move(x: number, y: number, id: number): { delta: number; began: boolean } | null {
    const s = this.start;
    if (!s || id !== s.id) return null;
    const delta = this.vertical ? x - s.x : y - s.y;
    if (!this.dragging) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return null;
      this.dragging = true;
      return { delta, began: true };
    }
    return { delta, began: false };
  }
  /** The press ended: was it a drag? Null when it was not this press. */
  up(id: number): { wasDrag: boolean } | null {
    const s = this.start;
    if (!s || id !== s.id) return null;
    this.start = null;
    const wasDrag = this.dragging;
    this.dragging = false;
    return { wasDrag };
  }
}

/** The standard chevron, pointing `direction`. Shared by panel edges; rows use DisclosureArrow. */
export function Chevron({ direction, size = 10 }: { direction: Direction; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden="true"
      data-direction={direction}
      style={{ display: "block", transform: `rotate(${ROTATION[direction]}deg)` }}
    >
      <polyline
        points="3.5,1.5 7,5 3.5,8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface PanelHandleResize {
  /** The controlled pane's share of the split now, 0–100 (0 when collapsed). */
  valueNow: number;
  valueMin: number;
  valueMax: number;
  /** A drag begins (after the threshold). */
  onDragStart: () => void;
  /** The line has moved this many pixels from where the drag began (+ = right / down). */
  onDragMove: (deltaPx: number) => void;
  /** The drag ended: the place to persist the new sizes. */
  onDragEnd: () => void;
  /** A keyboard step of this many pixels (+ = right / down); persists at once. */
  onStep: (deltaPx: number) => void;
  /**
   * Nothing to resize just now (the pane on the other side is hidden). The
   * separator stays focusable, so Enter still collapses and restores; it is
   * the same when the pane is collapsed.
   */
  disabled?: boolean;
}

export interface PanelHandleProps {
  /** The line's own orientation: "vertical" sits between columns, "horizontal" between rows. */
  orientation: "vertical" | "horizontal";
  /** Where the pane goes when it collapses; the open pane's arrow points this way. */
  foldToward: Direction;
  expanded: boolean;
  onToggle: () => void;
  /** The id of the pane this handle collapses (for aria-controls). */
  controls: string;
  /** What the tab says, open and collapsed: "Collapse the code editor", "Show the code editor". */
  collapseLabel: string;
  expandLabel: string;
  /** The separator's name, e.g. "Resize the code editor". Omit with no `resize`. */
  resizeLabel?: string;
  /** Present when the line resizes. Without it the line is drawn but only the tab acts. */
  resize?: PanelHandleResize;
  /** Where the tab sits on the line. Default: "start" (the top) on a vertical line, "end" (the right) on a horizontal one. */
  tabAt?: "start" | "end";
  /** Offset of the tab from that end, in px. */
  tabOffset?: number;
  /** The handle is on the split's start or end edge (a pane hidden): it is drawn inside the window. */
  at?: "start" | "end";
  testId?: string;
  tabTestId?: string;
  className?: string;
  style?: CSSProperties;
}

export function PanelHandle({
  orientation,
  foldToward,
  expanded,
  onToggle,
  controls,
  collapseLabel,
  expandLabel,
  resizeLabel,
  resize,
  tabAt,
  tabOffset = 8,
  at,
  testId,
  tabTestId,
  className,
  style,
}: PanelHandleProps) {
  const vertical = orientation === "vertical";
  // A press in progress: where it began, and whether it has become a drag.
  const press = useRef<PressTracker>(new PressTracker(vertical));
  // Set when a press turned into a drag, so the click that may follow is not a toggle.
  const suppressClick = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canResize = !!resize && expanded && !resize.disabled;

  // The latest resize callbacks, for the window listeners a press installs.
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  // A press listens on the window, not on the handle: the pointer leaves the
  // 8px band at once, and capturing it up front would turn a click on the
  // tab into a click on the band. Until the press moves DRAG_THRESHOLD_PX it
  // is a click, and the tab's own click handler toggles.
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    if (!canResize) return;
    const tracker = press.current;
    tracker.down(e.clientX, e.clientY, e.pointerId);
    const body = document.body;
    const onMove = (ev: globalThis.PointerEvent) => {
      const m = tracker.move(ev.clientX, ev.clientY, ev.pointerId);
      if (!m) return;
      if (m.began) {
        suppressClick.current = true;
        rootRef.current?.classList.add("pnv-handle--dragging");
        body.classList.add(vertical ? "pnv-resizing-col" : "pnv-resizing-row");
        resizeRef.current?.onDragStart();
      }
      ev.preventDefault();
      resizeRef.current?.onDragMove(m.delta);
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      const ended = tracker.up(ev.pointerId);
      if (!ended) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (ended.wasDrag) {
        rootRef.current?.classList.remove("pnv-handle--dragging");
        body.classList.remove("pnv-resizing-col", "pnv-resizing-row");
        resizeRef.current?.onDragEnd();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onSeparatorKeyDown = (e: KeyboardEvent) => {
    const action = separatorKeyAction(e.key, e.shiftKey, orientation);
    if (action === null) return;
    if (action === "toggle") {
      e.preventDefault();
      onToggle();
      return;
    }
    if (!canResize || !resize) return;
    e.preventDefault();
    resize.onStep(action);
  };

  const placement = tabAt ?? (vertical ? "start" : "end");
  // The tab's place is set in CSS from a class and a custom property, so the
  // button carries no style of its own.
  const rootStyle = { ...style, ["--handle-tab-offset" as string]: `${tabOffset}px` } as CSSProperties;
  const label = expanded ? collapseLabel : expandLabel;

  return (
    <div
      ref={rootRef}
      data-testid={testId}
      data-pnv-panel-handle={orientation}
      data-expanded={expanded ? "true" : "false"}
      data-at={at}
      className={`pnv-handle pnv-handle--${vertical ? "v" : "h"} pnv-handle--tab-${placement}${canResize ? " pnv-handle--resizable" : ""}${className ? ` ${className}` : ""}`}
      style={rootStyle}
      onPointerDown={onPointerDown}
    >
      {resize ? (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation={orientation}
          aria-label={resizeLabel}
          aria-controls={controls}
          aria-valuenow={Math.round(expanded ? resize.valueNow : 0)}
          aria-valuemin={Math.round(resize.valueMin)}
          aria-valuemax={Math.round(resize.valueMax)}
          className="pnv-handle__line"
          onKeyDown={onSeparatorKeyDown}
        />
      ) : (
        <div aria-hidden="true" className="pnv-handle__line" />
      )}
      <button
        type="button"
        className="pnv-handle__tab"
        data-testid={tabTestId}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={label}
        title={label}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onToggle();
        }}
      >
        <Chevron direction={arrowDirection(foldToward, expanded)} />
      </button>
    </div>
  );
}
