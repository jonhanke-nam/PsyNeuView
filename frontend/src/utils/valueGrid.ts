/**
 * A layer's values as a grid of shaded cells (#1387).
 *
 * The Hopfield walkthrough stores 5×5 letters in a 25-unit layer, and a list
 * of 25 numbers hides the letter. These helpers turn a node's value into a
 * grid: which shape to draw it in, and how dark each cell is. The drawing
 * itself is `components/common/ValueGrid.tsx`.
 *
 * Shape, in order: the width the user chose; the node's declared shape when
 * it is 2-D (or the value itself is a 2-D array); the square root when the
 * size is a perfect square; otherwise the smallest square that holds it, with
 * a short last row.
 *
 * Shade: dark for high and light for low. Values that are all 0 or more run
 * from 0 (light) to the largest (dark). Values that go negative are centred
 * on 0, from -m to +m where m is the largest magnitude: a Hopfield layer's
 * +1 is dark and its -1 light, with 0 between.
 */

/** Fewest elements for which a grid is offered: below this a list reads fine. */
export const MIN_GRID_SIZE = 4;

export type GridShape = {
  rows: number;
  cols: number;
  /** Where the shape came from, for the legend's hover text. */
  from: "width" | "declared" | "square" | "fallback";
};

export type GridScale =
  | { kind: "sequential"; min: number; max: number }
  | { kind: "diverging"; max: number };

export type NumericVector = {
  values: number[];
  /** [rows, cols] when the value itself is a 2-D array of rows. */
  shape?: [number, number];
};

/** Numbers in a numpy repr such as "[[ 1. -1.  0.5]]". */
function numbersInRepr(s: string): number[] | null {
  const m = s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|nan|inf/gi);
  if (!m) return null;
  return m.map((t) => {
    const l = t.toLowerCase();
    if (l === "nan") return NaN;
    if (l.endsWith("inf")) return l.startsWith("-") ? -Infinity : Infinity;
    return Number(t);
  });
}

/**
 * A node's value as a flat list of numbers, or null when it isn't one (a
 * label, a dict, ragged ports). Wrapping single-element arrays are peeled off:
 * PsyNeuLink gives a one-port layer's value as [[...]].
 */
export function numericVector(v: unknown): NumericVector | null {
  let cur: unknown = v;
  while (Array.isArray(cur) && cur.length === 1 && (Array.isArray(cur[0]) || typeof cur[0] === "string")) {
    cur = cur[0];
  }
  if (typeof cur === "string") {
    const nums = numbersInRepr(cur);
    return nums && nums.length > 0 ? { values: nums } : null;
  }
  if (!Array.isArray(cur) || cur.length === 0) return null;
  if (cur.every((x) => typeof x === "number")) return { values: cur as number[] };
  if (cur.every((r) => Array.isArray(r) && r.length > 0 && r.every((x) => typeof x === "number"))) {
    const rows = cur as number[][];
    if (rows.every((r) => r.length === rows[0].length)) {
      return { values: rows.flat(), shape: [rows.length, rows[0].length] };
    }
  }
  return null;
}

/** A shape with its leading 1s dropped: PsyNeuLink often says [1, 25] for 25. */
function squeeze(shape: readonly number[] | null | undefined): number[] {
  const s = (shape ?? []).filter((d) => Number.isFinite(d));
  let i = 0;
  while (i < s.length - 1 && s[i] === 1) i++;
  return s.slice(i);
}

/**
 * The grid to draw `size` values in. `declared` is the node's own shape (an
 * output port's, or the value's when it is 2-D); `width` is the user's
 * choice and wins when it fits. Null when the value is too small for a grid.
 */
export function inferGridShape(
  size: number,
  declared?: readonly number[] | null,
  width?: number | null,
): GridShape | null {
  if (!Number.isInteger(size) || size < 1) return null;
  if (width !== undefined && width !== null && Number.isInteger(width) && width >= 1 && width <= size) {
    return { rows: Math.ceil(size / width), cols: width, from: "width" };
  }
  const d = squeeze(declared);
  if (d.length === 2 && d[0] * d[1] === size && d[0] > 1) {
    return { rows: d[0], cols: d[1], from: "declared" };
  }
  const root = Math.round(Math.sqrt(size));
  if (root * root === size) return { rows: root, cols: root, from: "square" };
  const cols = Math.ceil(Math.sqrt(size));
  return { rows: Math.ceil(size / cols), cols, from: "fallback" };
}

/**
 * The scale for a set of values (one value's, or every trial's for a node,
 * so the shading means the same in each card). Non-finite values are ignored.
 */
export function gridScale(values: readonly number[]): GridScale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { kind: "sequential", min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min < 0) {
    const m = Math.max(Math.abs(min), Math.abs(max));
    return { kind: "diverging", max: m || 1 };
  }
  return { kind: "sequential", min: 0, max: max > 0 ? max : 1 };
}

/**
 * Where a value sits on its scale: 0…1 on a sequential scale (0 lightest),
 * -1…+1 on a diverging one (0 the middle). Clamped; NaN for a non-number.
 */
export function shadeOf(v: number, scale: GridScale): number {
  if (!Number.isFinite(v)) return NaN;
  if (scale.kind === "diverging") return Math.max(-1, Math.min(1, v / scale.max));
  const span = scale.max - scale.min || 1;
  return Math.max(0, Math.min(1, (v - scale.min) / span));
}

function mix(towards: string, pct: number, from: string): string {
  if (pct <= 0) return `var(${from})`;
  if (pct >= 100) return `var(${towards})`;
  return `color-mix(in srgb, var(${towards}) ${pct}%, var(${from}))`;
}

/** The CSS colour of a cell, from the palette's grid tokens. */
export function cellColour(v: number, scale: GridScale): string {
  const t = shadeOf(v, scale);
  if (Number.isNaN(t)) return "var(--pnv-surface)";
  if (scale.kind === "sequential") return mix("--pnv-grid-high", Math.round(t * 100), "--pnv-grid-low");
  if (t >= 0) return mix("--pnv-grid-high", Math.round(t * 100), "--pnv-grid-mid");
  return mix("--pnv-grid-neg", Math.round(-t * 100), "--pnv-grid-mid");
}

/** The legend's ends (and middle, when diverging), as numbers. */
export function scaleEnds(scale: GridScale): { low: number; mid: number | null; high: number } {
  if (scale.kind === "diverging") return { low: -scale.max, mid: 0, high: scale.max };
  return { low: scale.min, mid: null, high: scale.max };
}

/** A number for a legend or a cell's hover: short, and no "-0". */
export function formatGridNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
}
