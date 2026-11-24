/**
 * Putting a picked-up component on the graph from the keyboard (#411).
 *
 * With the mouse, a component picked up in the Components panel waits for a
 * click on the graph (#252), and a function for a click on a mechanism
 * (#348). Picked up from the keyboard (Enter on a row or a strip icon), it
 * comes here instead, and this takes keyboard focus:
 *
 *  - A component is shown, dashed, where it would go: the free spot nearest
 *    the selected node, or, with nothing selected, in empty space just beside
 *    the graph (right of it, else below, else left: whichever is showing),
 *    never in a gap inside it where arrows run. It covers nothing.
 *    The arrow keys move it (Shift for bigger steps), always to a spot that
 *    covers nothing; Enter puts it there; Option-Enter puts one there and
 *    keeps it picked up, as Option-click does.
 *  - A function rings one mechanism at a time. Tab and the arrow keys move
 *    the ring (Shift-Tab back), Enter gives it the function, and a mechanism
 *    that can't take it says why.
 *
 * Esc cancels, as it does for the mouse. Each step is said in the placing
 * hint, the status message added in #410. When it is over, focus goes back
 * to where the pick was made. Nothing here takes the pointer: the mouse
 * places exactly as before.
 */

import { ViewportPortal, useReactFlow, type Node } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isFunctionType } from "@/constants/pnlTypes";
import { useModelStore } from "@/stores/modelStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { generateDefaultVarName } from "@/utils/defaultNaming";
import { type Box, type Point, besideGraph, nearestFreeCentre } from "@/utils/freeSpot";
import { expectedNodeSize, functionRefusal } from "@/utils/nodeActions";

type Pick = NonNullable<ReturnType<typeof usePaletteStore.getState>["armed"]>;

/** Room kept clear around a node put down from the keyboard. */
const GAP = 24;
/** How far one arrow press moves it; Shift moves five times as far. */
const STEP = 20;

export function KeyboardPlacer({
  pick,
  nodes,
  place,
  giveFunction,
  announce,
}: {
  pick: Pick;
  /** The graph's nodes, so the free spot is worked out again as they change. */
  nodes: Node[];
  /** Put the component down, centred at `at`; `keep` holds it picked up. */
  place: (at: Point, keep: boolean) => void;
  /** Give the function to this mechanism; `keep` holds it picked up. */
  giveFunction: (node: Node, keep: boolean) => void;
  /** What the placing hint should say now. */
  announce: (text: string) => void;
}) {
  const { getInternalNode, setCenter, getZoom, screenToFlowPosition } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  const isFn = isFunctionType(pick.type);

  // Focus here at once; back where the pick was made when this goes, unless
  // the user has already moved focus somewhere else.
  useEffect(() => {
    const el = ref.current;
    el?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const back = pick.returnFocus;
      if (back?.isConnected && (!now || now === document.body || (el && el.contains(now)))) back.focus();
    };
    // Once per pick.
  }, []);

  /** A node's box as drawn, in graph coordinates. */
  const boxOf = (n: Node): Box | null => {
    const inode = getInternalNode(n.id);
    const w = inode?.measured?.width, h = inode?.measured?.height;
    if (!inode || !w || !h || n.hidden) return null;
    const { x, y } = inode.internals.positionAbsolute;
    return { x, y, w, h };
  };

  // --- A function: choose its mechanism -----------------------------------
  const targets = useMemo(() => {
    if (!isFn) return [];
    return nodes
      .filter((n) => n.type === "mechanismNode")
      .map((n) => ({ node: n, box: boxOf(n) }))
      .filter((t): t is { node: Node; box: Box } => t.box !== null)
      // Top to bottom, then left to right, as the eye reads the graph.
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }, [isFn, nodes]);
  const [targetId, setTargetId] = useState<string | null>(() => {
    if (!isFn) return null;
    const selected = useModelStore.getState().selectedNodeId;
    if (selected && targets.some((t) => t.node.id === selected)) return selected;
    // The first that can take it, or else the first.
    const able = targets.find((t) => functionRefusal(t.node.data as never, pick.type) === null);
    return (able ?? targets[0])?.node.id ?? null;
  });
  const target = targets.find((t) => t.node.id === targetId) ?? null;

  // --- A component: where it goes -----------------------------------------
  const size = useMemo(
    () => expectedNodeSize(generateDefaultVarName(pick.type, Object.keys(useModelStore.getState().lineMap))),
    // A new node changes the names taken, so the name, so the size.
    [pick.type, nodes],
  );
  // Put down with Option held, before the graph has redrawn with it.
  const [justPlaced, setJustPlaced] = useState<Box[]>([]);
  useEffect(() => setJustPlaced([]), [nodes]);
  const taken = useMemo(
    () => [...nodes.map(boxOf).filter((b): b is Box => b !== null), ...justPlaced],
    [nodes, justPlaced],
  );
  const [want, setWant] = useState<Point>(() => {
    const selected = useModelStore.getState().selectedNodeId;
    const sel = selected ? nodes.find((n) => n.id === selected) : undefined;
    const b = sel ? boxOf(sel) : null;
    if (b) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Nothing selected: beside the graph, in the part of it showing.
    const pane = document.querySelector('[data-testid="graph-canvas-viewport"] .react-flow__pane')?.getBoundingClientRect();
    const tl = pane ? screenToFlowPosition({ x: pane.left, y: pane.top }) : null;
    const br = pane ? screenToFlowPosition({ x: pane.right, y: pane.bottom }) : null;
    const visible = tl && br ? { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y } : null;
    return besideGraph(taken, size, visible, GAP);
  });
  const spot = useMemo(
    () => (isFn ? want : nearestFreeCentre(want, size, taken, { gap: GAP, step: STEP })),
    [isFn, want, size, taken],
  );

  // --- What the hint says -------------------------------------------------
  const refusal = target ? functionRefusal(target.node.data as never, pick.type) : null;
  const targetName = target ? String((target.node.data as { label?: string })?.label || target.node.id) : null;
  const note = isFn
    ? target
      ? refusal
        ? `${refusal} Tab or the arrow keys choose another mechanism, Esc cancels.`
        : `Giving ${pick.label} to ${targetName}. Tab or the arrow keys choose another mechanism, Enter gives it, Esc cancels.`
      : `There is no mechanism to give ${pick.label} to. Esc cancels.`
    : `Placing ${pick.label}: the arrow keys move it, Enter puts it down, Esc cancels.`;
  useEffect(() => announce(note), [note, announce]);

  // A ringed mechanism or the new node's outline out of view, or under the
  // placing hint, is brought into view.
  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest(".react-flow")?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!pane || !r || (isFn && !target)) return;
    const hint = document.getElementById("place-component-hint")?.getBoundingClientRect();
    const underHint = !!hint && r.left < hint.right && hint.left < r.right && r.top < hint.bottom && hint.top < r.bottom;
    if (underHint || r.left < pane.left || r.right > pane.right || r.top < pane.top || r.bottom > pane.bottom) {
      const c = target ? { x: target.box.x + target.box.w / 2, y: target.box.y + target.box.h / 2 } : spot;
      void setCenter(c.x, c.y, { zoom: getZoom(), duration: 200 });
    }
  }, [isFn, target, spot, setCenter, getZoom]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Left to bubble: Esc cancels a pick the same way for both.
      usePaletteStore.getState().setArmed(null);
      return;
    }
    if (isFn) {
      const forward = (e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown" || e.key === "ArrowRight";
      const back = (e.key === "Tab" && e.shiftKey) || e.key === "ArrowUp" || e.key === "ArrowLeft";
      if ((forward || back) && targets.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const at = targets.findIndex((t) => t.node.id === targetId);
        const next = forward ? (at + 1) % targets.length : (at <= 0 ? targets.length : at) - 1;
        setTargetId(targets[next].node.id);
      } else if (e.key === "Enter" && target) {
        e.preventDefault();
        e.stopPropagation();
        giveFunction(target.node, e.altKey);
      }
      return;
    }
    const by = e.shiftKey ? STEP * 5 : STEP;
    const d =
      e.key === "ArrowLeft" ? { x: -by, y: 0 }
      : e.key === "ArrowRight" ? { x: by, y: 0 }
      : e.key === "ArrowUp" ? { x: 0, y: -by }
      : e.key === "ArrowDown" ? { x: 0, y: by }
      : null;
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      // From where it shows, one step on, and on past anything in the way,
      // so every press moves it.
      let next = { x: spot.x + d.x, y: spot.y + d.y };
      for (let i = 0; i < 100; i++) {
        const free = nearestFreeCentre(next, size, taken, { gap: GAP, step: STEP });
        if (free.x !== spot.x || free.y !== spot.y) break;
        next = { x: next.x + d.x, y: next.y + d.y };
      }
      setWant(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) setJustPlaced((b) => [...b, { x: spot.x - size.width / 2, y: spot.y - size.height / 2, w: size.width, h: size.height }]);
      place(spot, e.altKey);
    }
  };

  // The ring around the mechanism, or the dashed outline of the new node.
  const ring = isFn
    ? target && { x: target.box.x - 6, y: target.box.y - 6, w: target.box.w + 12, h: target.box.h + 12 }
    : { x: spot.x - size.width / 2, y: spot.y - size.height / 2, w: size.width, h: size.height };

  return (
    <ViewportPortal>
      <div
        ref={ref}
        tabIndex={0}
        // The arrow keys belong to this, not to a screen reader's browsing.
        role="application"
        aria-label={isFn ? `Choose the mechanism for ${pick.label}` : `Where the new ${pick.label} goes`}
        aria-describedby="place-component-hint"
        data-testid="keyboard-placement"
        data-mode={isFn ? "function" : "component"}
        data-target={isFn ? targetId ?? "" : undefined}
        data-refused={isFn && refusal ? "true" : undefined}
        data-x={isFn ? undefined : Math.round(spot.x)}
        data-y={isFn ? undefined : Math.round(spot.y)}
        onKeyDown={onKeyDown}
        style={{
          position: "absolute",
          transform: ring ? `translate(${ring.x}px, ${ring.y}px)` : undefined,
          width: ring?.w ?? 0,
          height: ring?.h ?? 0,
          boxSizing: "border-box",
          border: `2px dashed var(${isFn && refusal ? "--pnv-danger" : "--pnv-selection-border"})`,
          background: isFn ? "transparent" : "var(--pnv-selection-fill)",
          borderRadius: isFn ? 10 : 8,
          // Shown, never in the way: clicks go to the graph under it.
          pointerEvents: "none",
          outline: "none",
          zIndex: 1000,
        }}
      />
    </ViewportPortal>
  );
}
