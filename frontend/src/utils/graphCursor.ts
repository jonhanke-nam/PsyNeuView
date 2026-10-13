/**
 * The pointer in the graph view. (#1301)
 *
 * Over the canvas, nodes and edges the pointer is the traditional arrow, whose
 * tip is the exact point that clicks; the grabbing hand appears only while a
 * drag is in progress. React Flow's own stylesheet puts a grab hand on the pane
 * and a pointer or grab hand on nodes and edges; `index.css` overrides those
 * under `.graph-pointer-arrow`, reading the arrow from the CSS variable this
 * module computes. "Hand" keeps React Flow's cursors as they were.
 *
 * The arrow is our own SVG, so the size is real and the same in a browser and
 * in the Mac app: a system arrow can't be resized from CSS, and window zoom
 * (⌘+ / ⌘−) doesn't scale cursors. Browsers cap a custom cursor image —
 * Chromium at 128 px on either side — so the largest size stays under that.
 * Every value ends in `, default`: if the image can't be used, the normal
 * system arrow shows.
 *
 * Pure: no DOM, so it is unit-tested in node (vitest.config.ts). What is
 * remembered per browser lives in stores/graphPointerStore.ts.
 */

export type GraphPointer = "arrow" | "hand";
export type PointerSize = "small" | "medium" | "large" | "xlarge";

export const GRAPH_POINTERS: readonly { id: GraphPointer; label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "hand", label: "Hand" },
];

/** The largest custom cursor Chromium will show, in CSS px on either side. */
export const MAX_CURSOR_PX = 128;

/**
 * Each size's image, in CSS px, square. Medium is close to the system arrow's
 * own height, so the default looks familiar; the others step away from it.
 */
export const POINTER_SIZES: readonly { id: PointerSize; label: string; px: number }[] = [
  { id: "small", label: "Small", px: 16 },
  { id: "medium", label: "Medium", px: 24 },
  { id: "large", label: "Large", px: 48 },
  { id: "xlarge", label: "Extra large", px: 96 },
];

export const DEFAULT_GRAPH_POINTER: GraphPointer = "arrow";
export const DEFAULT_POINTER_SIZE: PointerSize = "medium";

export function isGraphPointer(value: unknown): value is GraphPointer {
  return GRAPH_POINTERS.some((p) => p.id === value);
}

export function isPointerSize(value: unknown): value is PointerSize {
  return POINTER_SIZES.some((s) => s.id === value);
}

export function pointerSizePx(size: PointerSize): number {
  return POINTER_SIZES.find((s) => s.id === size)!.px;
}

/**
 * The arrow, drawn in a 24-unit box with its tip at (ARROW_TIP, ARROW_TIP).
 * The tip sits a little inside the box so the white outline isn't clipped;
 * the hot spot is placed on it, not at the box's corner.
 */
export const ARROW_VIEWBOX = 24;
export const ARROW_TIP = 1;
const ARROW_PATH = "M1 1 L1 18.5 L5.6 14.4 L8.8 21.6 L12.2 20.1 L9 13 L15.5 13 Z";

/** The arrow as an SVG document, `px` on each side. */
export function arrowSvg(px: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}">` +
    `<path d="${ARROW_PATH}" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** The arrow as a `data:` URL, usable in `cursor: url(…)` and as an `<img>` source. */
export function arrowDataUrl(px: number): string {
  return `data:image/svg+xml,${encodeURIComponent(arrowSvg(px))}`;
}

/** Where the tip lands in an image `px` wide: the hot spot, in whole CSS px inside the image. */
export function arrowHotspot(px: number): number {
  const at = Math.round((ARROW_TIP * px) / ARROW_VIEWBOX);
  return Math.min(px - 1, Math.max(0, at));
}

/** The image and hot spot for a size: what `cursor:` is built from. */
export function arrowCursorImage(size: PointerSize): { px: number; url: string; hotspot: number } {
  const px = pointerSizePx(size);
  return { px, url: arrowDataUrl(px), hotspot: arrowHotspot(px) };
}

/**
 * The `cursor` value for the arrow at `size`: our image with the hot spot on
 * its tip, then the system arrow should the image not load.
 */
export function arrowCursorValue(size: PointerSize): string {
  const { url, hotspot } = arrowCursorImage(size);
  return `url("${url}") ${hotspot} ${hotspot}, default`;
}

/** The class `index.css` keys its graph-view cursor rules on. */
export function graphPointerClass(pointer: GraphPointer): string {
  return pointer === "arrow" ? "graph-pointer-arrow" : "graph-pointer-hand";
}

/** The CSS variable the arrow rules read. */
export const ARROW_CURSOR_VAR = "--graph-arrow-cursor";
