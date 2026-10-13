/**
 * A layer's values as a grid of shaded cells, its legend, and the
 * "as list / as grid" toggle (#1387). The shape and shading rules are in
 * `utils/valueGrid.ts`; the per-node choice in `stores/valueViewStore.ts`.
 *
 * Used by the Run panel's results, Run State and the value pill. Each place
 * passes its own test id prefix, so the same node's controls in two panels
 * (both stay mounted) never share an id.
 */

import { useMemo, type CSSProperties } from "react";

import { useValueViews, valueViewFor, type ValueView } from "@/stores/valueViewStore";
import { chooseValueView } from "@/utils/valueViewSave";
import {
  MIN_GRID_SIZE,
  cellColour,
  formatGridNumber,
  gridScale,
  inferGridShape,
  numericVector,
  scaleEnds,
  type GridScale,
  type GridShape,
} from "@/utils/valueGrid";

/** What a surface needs to draw a node's value as a grid, or null for a list. */
export type NodeGrid = {
  values: number[];
  shape: GridShape;
  scale: GridScale;
};

/**
 * The node's current choice, and — when it is "grid" and the value is a
 * vector big enough — the grid to draw. `scaleFrom` is every value the scale
 * should cover (all trials, all steps), so the shading means the same from
 * one card or step to the next; it defaults to this value alone.
 */
export function useNodeGrid(
  names: (string | null | undefined)[],
  value: unknown,
  declaredShape?: readonly number[] | null,
  scaleFrom?: readonly number[],
): { view: ValueView | undefined; grid: NodeGrid | null; size: number } {
  const views = useValueViews((s) => s.views);
  const view = valueViewFor(views, ...names);
  return useMemo(() => {
    const vec = numericVector(value);
    const size = vec?.values.length ?? 0;
    if (!vec || view?.as !== "grid" || size < MIN_GRID_SIZE) return { view, grid: null, size };
    const shape = inferGridShape(size, vec.shape ?? declaredShape, view.width);
    if (!shape) return { view, grid: null, size };
    return { view, grid: { values: vec.values, shape, scale: gridScale(scaleFrom ?? vec.values) }, size };
    // `names` is a fresh array each render; the view it resolves to is the dependency.
  }, [view, value, declaredShape, scaleFrom]);
}

/** Every number in a list of node values, for a shared scale. */
export function poolValues(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const vec = numericVector(v);
    if (vec) out.push(...vec.values);
  }
  return out;
}

export function ValueGrid({
  grid,
  cell,
  gap = 1,
  node,
  testId,
  inLine = false,
}: {
  grid: NodeGrid;
  /** Cell edge in px. */
  cell: number;
  gap?: number;
  node: string;
  testId?: string;
  /** Sit inside a line of text no taller than it (the value pill): aligned
      to the line's top and nudged down 1px, which leaves the line box alone. */
  inLine?: boolean;
}) {
  const { values, shape, scale } = grid;
  return (
    <div
      data-testid={testId}
      data-rows={shape.rows}
      data-cols={shape.cols}
      role="img"
      aria-label={`${node}: ${values.length} values as ${shape.rows} by ${shape.cols} grid`}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(${shape.cols}, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap,
        padding: gap,
        background: gap > 0 ? "var(--pnv-border-faint)" : undefined,
        verticalAlign: inLine ? "top" : "middle",
        position: inLine ? "relative" : undefined,
        top: inLine ? 1 : undefined,
        lineHeight: 0,
      }}
    >
      {values.map((v, i) => (
        <div
          key={i}
          className="value-grid-cell"
          data-value={formatGridNumber(v)}
          title={`${node}[${i}] (row ${Math.floor(i / shape.cols) + 1}, column ${(i % shape.cols) + 1}): ${formatGridNumber(v)}`}
          style={{ background: cellColour(v, scale) }}
        />
      ))}
    </div>
  );
}

/** A small strip from the low end to the high end, with its numbers. */
export function GridLegend({ scale, testId }: { scale: GridScale; testId?: string }) {
  const { low, mid, high } = scaleEnds(scale);
  const strip =
    scale.kind === "diverging"
      ? "linear-gradient(to right, var(--pnv-grid-neg), var(--pnv-grid-mid), var(--pnv-grid-high))"
      : "linear-gradient(to right, var(--pnv-grid-low), var(--pnv-grid-high))";
  const text: CSSProperties = { fontSize: 10, color: "var(--pnv-text-hint)", fontFamily: "monospace" };
  return (
    <span
      data-testid={testId}
      title={
        scale.kind === "diverging"
          ? `Shade: ${formatGridNumber(low)} lightest, ${formatGridNumber(high)} darkest, 0 between`
          : `Shade: ${formatGridNumber(low)} lightest, ${formatGridNumber(high)} darkest`
      }
      style={{ display: "inline-flex", alignItems: "center", gap: 3, verticalAlign: "middle" }}
    >
      <span style={text}>{formatGridNumber(low)}</span>
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: 40,
          height: 8,
          background: strip,
          border: "1px solid var(--pnv-border-light)",
          borderRadius: 2,
        }}
      >
        {mid !== null && (
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: -1,
              bottom: -1,
              width: 1,
              background: "var(--pnv-text-faint)",
            }}
          />
        )}
      </span>
      <span style={text}>{formatGridNumber(high)}</span>
    </span>
  );
}

/**
 * "list | grid" for one node, and the grid's width while it is a grid. Sized
 * to sit on a line of 11px text without making it taller.
 */
export function ValueViewToggle({
  node,
  size,
  view,
  shape,
  testId,
}: {
  node: string;
  size: number;
  view: ValueView | undefined;
  /** The shape drawn now (for the width box's starting value). */
  shape?: GridShape | null;
  testId: string;
}) {
  const asGrid = view?.as === "grid";
  const options: { key: "list" | "grid"; label: string; hint: string }[] = [
    { key: "list", label: "list", hint: `Show ${node}'s ${size} values as a list of numbers` },
    { key: "grid", label: "grid", hint: `Show ${node}'s ${size} values as a grid of shaded cells, dark for high and light for low` },
  ];
  const width = view?.width ?? shape?.cols ?? inferGridShape(size)?.cols ?? size;
  return (
    <span
      data-testid={testId}
      // A trial card jumps the trace when clicked; a press here is only this.
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, verticalAlign: "middle" }}
    >
      <span
        style={{
          display: "inline-flex",
          border: "1px solid var(--pnv-border-light)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        {options.map((o) => {
          const on = (o.key === "grid") === asGrid;
          return (
            <button
              key={o.key}
              data-testid={`${testId}-${o.key}`}
              aria-pressed={on}
              title={o.hint}
              onClick={() => {
                if (on) return;
                chooseValueView(node, o.key === "grid" ? { as: "grid", ...(view?.width ? { width: view.width } : {}) } : { as: "list", ...(view?.width ? { width: view.width } : {}) });
              }}
              style={{
                fontSize: 10,
                lineHeight: "12px",
                padding: "0 5px",
                border: "none",
                borderLeft: o.key === "grid" ? "1px solid var(--pnv-border-faint)" : "none",
                background: on ? "var(--pnv-primary-tint)" : "var(--pnv-surface)",
                color: on ? "var(--pnv-primary-text-on-tint)" : "var(--pnv-text-hint)",
                fontWeight: on ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </span>
      {asGrid && (
        <label
          title={`How many cells across. ${size} values${shape ? `, drawn ${shape.rows} by ${shape.cols}` : ""}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, color: "var(--pnv-text-hint)" }}
        >
          width
          <input
            data-testid={`${testId}-width`}
            type="number"
            min={1}
            max={size}
            value={width}
            onChange={(e) => {
              const w = Number(e.target.value);
              if (Number.isInteger(w) && w >= 1 && w <= size) chooseValueView(node, { as: "grid", width: w });
            }}
            style={{
              width: 34,
              height: 14,
              boxSizing: "border-box",
              fontSize: 10,
              padding: "0 2px",
              border: "1px solid var(--pnv-border-light)",
              borderRadius: 2,
              background: "var(--pnv-surface)",
              color: "var(--pnv-text)",
            }}
          />
        </label>
      )}
    </span>
  );
}
