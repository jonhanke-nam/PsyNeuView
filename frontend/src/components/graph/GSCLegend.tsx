/**
 * Draggable, toggleable legend for GraphStructureCondition edge types.
 *
 * - Toggle visibility with the button in the corner
 * - Drag to reposition anywhere on the canvas
 * - Position persists across sessions via localStorage
 *
 * Default placement (before any user drag) auto-picks the viewport
 * corner with the most space outside the node bounding box — refs #275.
 * Once the user drags the legend, `custom` flips true and the saved
 * absolute position takes over.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useSchedulingArrowsStore } from "@/stores/schedulingArrowsStore";
import { useGraphLegendStore } from "@/stores/graphLegendStore";
import { useReactFlow, useStore } from "@xyflow/react";
import { useModelStore } from "@/stores/modelStore";
import { DialogCloseButton } from "@/components/common/dialog/DialogHeader";

const STORAGE_KEY = "psynewview-gsc-legend";
const LEGEND_MARGIN = 12;

type Corner = "tl" | "tr" | "bl" | "br";

interface LegendPosition {
  x: number;
  y: number;
  visible: boolean;
  // When false, the legend renders in the auto-selected corner (computed
  // from the post-fitView node bounding box). Flips true on first drag.
  custom: boolean;
}

const DEFAULT_POS: LegendPosition = { x: 20, y: 20, visible: true, custom: false };

const LEGEND_ITEMS = [
  { color: "var(--pnv-gsc-before)", label: "before", dash: "6 3", description: "BeforeNode — must execute before target" },
  { color: "var(--pnv-gsc-after)", label: "after", dash: "6 3", description: "AfterNode — must execute after target" },
  { color: "var(--pnv-gsc-add-edge)", label: "+edge", dash: "6 3", description: "AddEdgeTo — adds dependency edge" },
  { color: "var(--pnv-gsc-remove-edge)", label: "−edge", dash: "4 4", description: "RemoveEdgeFrom — removes dependency edge" },
  { color: "var(--pnv-gsc-with)", label: "with", dash: "6 3", description: "WithNode — co-scheduled (same dependencies)" },
];

const PROJECTION_ITEM = {
  color: "var(--pnv-edge-legend)",
  label: "projection",
  dash: "",
  description: "Data projection — actual data flow between nodes",
};

/**
 * The corner with the most room outside the nodes, never the bottom-left.
 *
 * React Flow's zoom and fit-view controls sit in the bottom-left corner. A
 * legend placed there covers them: the buttons stay visible but every click
 * lands on the legend (the EGO walkthrough's CI failure, #55). When the
 * bottom-left is the roomiest, the legend takes whichever of its neighbours
 * (bottom-right or top-left) has more room instead.
 */
export function pickLegendCorner(gaps: { left: number; right: number; top: number; bottom: number }): Corner {
  const horiz: "l" | "r" = gaps.right >= gaps.left ? "r" : "l";
  const vert: "t" | "b" = gaps.bottom >= gaps.top ? "b" : "t";
  if (vert === "b" && horiz === "l") return gaps.right >= gaps.top ? "br" : "tl";
  return `${vert}${horiz}` as Corner;
}

// Only where the legend sits is remembered here. Whether it opens folded is
// the Appearance setting (#7); an older stored `visible` is ignored.
function loadPosition(): LegendPosition {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { visible: _ignored, ...where } = JSON.parse(stored);
      return { ...DEFAULT_POS, ...where };
    }
  } catch {}
  return DEFAULT_POS;
}

function savePosition(pos: LegendPosition) {
  try {
    const { visible: _notStored, ...where } = pos;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(where));
  } catch {}
}

export function GSCLegend() {
  const gscConditions = useModelStore((s) => s.gscConditions);
  const schedulingArrows = useSchedulingArrowsStore((s) => s.arrows);
  const hasModel = useModelStore((s) => s.filePath) !== null;
  const filePath = useModelStore((s) => s.filePath);
  const legendStart = useGraphLegendStore((s) => s.start);
  const [pos, setPos] = useState<LegendPosition>(() => ({ ...loadPosition(), visible: legendStart === "expanded" }));
  // How it opens is the setting (#7): on every model opened, and right away
  // when the setting changes. Show/Hide only folds it for this view.
  useEffect(() => {
    setPos((p) => ({ ...p, visible: legendStart === "expanded" }));
  }, [filePath, legendStart]);
  const [autoCorner, setAutoCorner] = useState<Corner>("br");
  const legendRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const { getNodes } = useReactFlow();
  // React Flow's internal transform updates after fitView; subscribing
  // here lets us recompute the corner whenever the view zooms/pans.
  const transform = useStore((s) => s.transform);
  const nodeCount = useModelStore((s) => s.nodes.length);

  // Pick the viewport corner with the most empty space outside the
  // current screen-space node bounding box. Skip when the user has
  // already moved the legend (custom === true) — their choice wins.
  useEffect(() => {
    if (pos.custom) return;
    const container = legendRef.current?.offsetParent as HTMLElement | null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nodes = getNodes();
    if (nodes.length === 0) return;

    const [tx, ty, tz] = transform;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.measured?.width ?? n.width ?? 180;
      const h = n.measured?.height ?? n.height ?? 60;
      const sx = n.position.x * tz + tx;
      const sy = n.position.y * tz + ty;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx + w * tz);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy + h * tz);
    }
    if (!Number.isFinite(minX)) return;

    setAutoCorner(
      pickLegendCorner({
        left: minX,
        right: rect.width - maxX,
        top: minY,
        bottom: rect.height - maxY,
      }),
    );
  }, [transform, nodeCount, pos.custom, getNodes]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header area
    if ((e.target as HTMLElement).closest("[data-legend-body]")) return;
    e.preventDefault();
    dragging.current = true;
    // On first drag, snapshot the legend's current screen rect so we
    // can convert from "auto corner" to absolute x/y without the legend
    // jumping under the cursor.
    const startRect = legendRef.current?.getBoundingClientRect();
    const parentRect = (legendRef.current?.offsetParent as HTMLElement | null)
      ?.getBoundingClientRect();
    const startX = startRect && parentRect ? startRect.left - parentRect.left : pos.x;
    const startY = startRect && parentRect ? startRect.top - parentRect.top : pos.y;
    offset.current = { x: e.clientX - startX, y: e.clientY - startY };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setPos((p) => ({
        ...p,
        custom: true,
        x: Math.max(0, ev.clientX - offset.current.x),
        y: Math.max(0, ev.clientY - offset.current.y),
      }));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Save on drop
      setPos((p) => {
        savePosition(p);
        return p;
      });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [pos.x, pos.y]);

  const toggleVisible = useCallback(() => {
    setPos((p) => ({ ...p, visible: !p.visible }));
  }, []);

  // Don't render if no model is loaded, no GSC conditions exist, or their
  // arrows are hidden (#53): the legend explains only those arrows.
  if (!hasModel || gscConditions.length === 0 || schedulingArrows === "hidden") return null;

  // Toggle button (always visible)
  if (!pos.visible) {
    return (
      <button
        onClick={toggleVisible}
        title="Show legend"
        data-testid="gsc-legend-show"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          background: "var(--pnv-surface)",
          border: "1px solid var(--pnv-border-light)",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: "var(--pnv-fs-11)",
          fontWeight: 600,
          color: "var(--pnv-text-secondary)",
          cursor: "pointer",
          boxShadow: "var(--pnv-shadow-chip)",
        }}
      >
        Legend
      </button>
    );
  }

  // Determine which GSC types are active in the current model
  const activeTypes = new Set(gscConditions.map((g) => g.type));
  const hasProjections = useModelStore.getState().edges.some(
    (e) => !(e.data as any)?.gscType
  );

  const anchorStyle: React.CSSProperties = pos.custom
    ? { left: pos.x, top: pos.y }
    : {
        left: autoCorner.endsWith("l") ? LEGEND_MARGIN : undefined,
        right: autoCorner.endsWith("r") ? LEGEND_MARGIN : undefined,
        top: autoCorner.startsWith("t") ? LEGEND_MARGIN : undefined,
        bottom: autoCorner.startsWith("b") ? LEGEND_MARGIN : undefined,
      };

  return (
    <div
      ref={legendRef}
      data-testid="gsc-legend"
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        ...anchorStyle,
        zIndex: 10,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border-light)",
        borderRadius: 8,
        boxShadow: "var(--pnv-shadow-node-raised)",
        minWidth: 180,
        userSelect: "none",
        cursor: "grab",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 10px 4px",
        borderBottom: "1px solid var(--pnv-border-faint)",
      }}>
        <span style={{ fontSize: "var(--pnv-fs-11)", fontWeight: 700, color: "var(--pnv-node-text-strong)", letterSpacing: 0.5 }}>
          LEGEND
        </span>
        <DialogCloseButton onClick={toggleVisible} label="Hide legend" title="Hide legend" color="var(--pnv-text-faint)" inline testId="gsc-legend-hide" />
      </div>

      {/* Body */}
      <div data-legend-body style={{ padding: "6px 10px 8px", cursor: "default" }}>
        {/* Projection line */}
        {hasProjections && (
          <LegendRow
            color={PROJECTION_ITEM.color}
            dash=""
            label={PROJECTION_ITEM.label}
            description={PROJECTION_ITEM.description}
            active={true}
          />
        )}

        {/* GSC lines */}
        {LEGEND_ITEMS.map((item) => {
          // Map label to types
          const typeMap: Record<string, string[]> = {
            before: ["BeforeNode", "BeforeNodes"],
            after: ["AfterNode", "AfterNodes"],
            "+edge": ["AddEdgeTo"],
            "−edge": ["RemoveEdgeFrom"],
            with: ["WithNode"],
          };
          const types = typeMap[item.label] || [];
          const active = types.some((t) => activeTypes.has(t));

          return (
            <LegendRow
              key={item.label}
              color={item.color}
              dash={item.dash}
              label={item.label}
              description={item.description}
              active={active}
            />
          );
        })}
      </div>
    </div>
  );
}

function LegendRow({
  color,
  dash,
  label,
  description,
  active,
}: {
  color: string;
  dash: string;
  label: string;
  description: string;
  active: boolean;
}) {
  return (
    <div
      title={description}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "3px 0",
        opacity: active ? 1 : 0.35,
      }}
    >
      {/* Line sample */}
      <svg width={28} height={10} style={{ flexShrink: 0 }}>
        <line
          x1={0} y1={5} x2={28} y2={5}
          style={{ stroke: color }}
          strokeWidth={2}
          strokeDasharray={dash}
        />
      </svg>
      {/* Label badge */}
      <span style={{
        fontSize: "var(--pnv-fs-10)", fontWeight: 600, fontFamily: "monospace",
        color: "var(--pnv-on-primary)", background: color,
        padding: "0 5px", borderRadius: 6, lineHeight: "15px",
        whiteSpace: "nowrap",
      }}>
        {label}
      </span>
      {/* Type name */}
      <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-node-text-detail)", whiteSpace: "nowrap" }}>
        {description.split(" — ")[0]}
      </span>
    </div>
  );
}
