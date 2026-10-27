/**
 * The pointer in the graph view. (#1301)
 *
 * Over the canvas, nodes and edges the pointer is the traditional arrow, whose
 * tip is the exact point that clicks; the grabbing hand appears only while a
 * drag is in progress. React Flow's own stylesheet puts a grab hand on the pane
 * and a pointer or grab hand on nodes and edges; `index.css` overrides those
 * under `.graph-pointer-image`, reading the image from the CSS variables this
 * module computes. "Hand" keeps React Flow's cursors as they were.
 *
 * #40: two more precise pointers for aiming at small things (ports, edges):
 * a **crosshair** and a **ring**, each with its hot spot exactly at its
 * centre and a dot there, so the point that clicks is drawn. While the button
 * is held over a node or edge, they show a pressed variant (heavier, filled
 * centre) as feedback for the click; the arrow keeps its one look.
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

export type GraphPointer = "arrow" | "hand" | "crosshair" | "circle";
export type PointerSize = "small" | "medium" | "large" | "xlarge";

export const GRAPH_POINTERS: readonly { id: GraphPointer; label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "hand", label: "Hand" },
  { id: "crosshair", label: "Crosshair" },
  { id: "circle", label: "Circle" },
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
/** The system pointer's look: black, edged in white. An image can't read a CSS variable. */
const INK = "#000";
const EDGE = "#fff";
const ARROW_PATH = "M1 1 L1 18.5 L5.6 14.4 L8.8 21.6 L12.2 20.1 L9 13 L15.5 13 Z";

/** The arrow as an SVG document, `px` on each side. */
export function arrowSvg(px: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}">` +
    `<path d="${ARROW_PATH}" fill="${INK}" stroke="${EDGE}" stroke-width="1.5" stroke-linejoin="round"/>` +
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

/**
 * The crosshair and the ring, drawn in the same 24-unit box with their centre
 * at (CENTRE, CENTRE): the hot spot. Black lines with a white edge, like the
 * arrow, so they show on light and dark canvases alike.
 */
export const CENTRE = 12;

/** The precise pointers: everything but the arrow and the system hand. */
export type PrecisePointer = "crosshair" | "circle";

export function isPrecisePointer(pointer: GraphPointer): pointer is PrecisePointer {
  return pointer === "crosshair" || pointer === "circle";
}

function preciseShapes(pointer: PrecisePointer, pressed: boolean): string {
  const c = CENTRE;
  const dot = `<circle cx="${c}" cy="${c}" r="${pressed ? 2.2 : 1.3}"/>`;
  if (pointer === "crosshair") {
    // Four arms with a gap round the centre, so the target under it stays visible.
    const gap = pressed ? 2.5 : 3.5;
    const arms =
      `M${c} 1 V${c - gap} M${c} ${c + gap} V23 ` + `M1 ${c} H${c - gap} M${c + gap} ${c} H23`;
    return `<path d="${arms}"/>` + dot;
  }
  return `<circle cx="${c}" cy="${c}" r="${pressed ? 6.5 : 8}" fill="none"/>` + dot;
}

/** The crosshair or the ring as an SVG document, `px` on each side. */
export function preciseSvg(pointer: PrecisePointer, px: number, pressed = false): string {
  const width = pressed ? 2.4 : 1.6;
  const shapes = preciseShapes(pointer, pressed);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}">` +
    // The white edge first, wider, then the black on top.
    `<g stroke="${EDGE}" fill="${EDGE}" stroke-width="${width + 2}" stroke-linecap="round">${shapes}</g>` +
    `<g stroke="${INK}" fill="${INK}" stroke-width="${width}" stroke-linecap="round">${shapes}</g>` +
    `</svg>`
  );
}

/** Where the centre lands in an image `px` wide: the hot spot, in whole CSS px. */
export function centreHotspot(px: number): number {
  return Math.min(px - 1, Math.round((CENTRE * px) / ARROW_VIEWBOX));
}

/** The image and hot spot for any image pointer (not the hand) at a size. */
export function pointerCursorImage(
  pointer: Exclude<GraphPointer, "hand">,
  size: PointerSize,
  pressed = false,
): { px: number; url: string; hotspot: number } {
  if (pointer === "arrow") return arrowCursorImage(size);
  const px = pointerSizePx(size);
  const url = `data:image/svg+xml,${encodeURIComponent(preciseSvg(pointer, px, pressed))}`;
  return { px, url, hotspot: centreHotspot(px) };
}

/**
 * The `cursor` value for an image pointer: the image with its hot spot, then
 * a system fallback (the arrow for the arrow, the crosshair otherwise).
 */
export function pointerCursorValue(
  pointer: Exclude<GraphPointer, "hand">,
  size: PointerSize,
  pressed = false,
): string {
  if (pointer === "arrow") return arrowCursorValue(size);
  const { url, hotspot } = pointerCursorImage(pointer, size, pressed);
  return `url("${url}") ${hotspot} ${hotspot}, crosshair`;
}

/** The class `index.css` keys its graph-view cursor rules on. */
export function graphPointerClass(pointer: GraphPointer): string {
  return pointer === "hand" ? "graph-pointer-hand" : "graph-pointer-image";
}

/** The CSS variable the image rules read, and the one for a held button. */
export const GRAPH_CURSOR_VAR = "--graph-pointer-cursor";
export const GRAPH_PRESSED_CURSOR_VAR = "--graph-pointer-pressed-cursor";
