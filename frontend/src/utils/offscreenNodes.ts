/**
 * Which nodes have left the visible canvas (#1183).
 *
 * The canvas re-fits when a pane is shown or hidden, but not when a visible
 * pane merely changes *size* — running a model grows the results panel, which
 * shrinks the canvas and can push nodes out of view with nothing to say so.
 * Rather than re-framing the user's view for them (a deliberate zoom is worth
 * more than an automatic fit), we count what left and let them decide.
 *
 * Pulled out of the component because it is pure geometry, and geometry is far
 * easier to state as tests than to verify by dragging a splitter.
 */

export interface CanvasViewport {
  /** React Flow's transform: `[translateX, translateY, zoom]`. */
  transform: [number, number, number];
  /** Canvas container size, in screen pixels. */
  width: number;
  height: number;
}

export interface NodeBox {
  id: string;
  /** Absolute position in flow coordinates (not relative to a parent). */
  x: number;
  y: number;
  /** Measured size in flow coordinates; 0 before React Flow has measured. */
  width: number;
  height: number;
}

/**
 * The ids of nodes with **no** visible pixels, in the order given.
 *
 * A node that is partly on screen does not count: the user can see it, so
 * telling them it is missing would be wrong. Only a box that fails to
 * intersect the viewport at all is reported.
 *
 * Returns nothing when the container has no size yet. Before the first
 * measurement every node is technically outside a 0x0 viewport, and
 * announcing "7 nodes off-screen" during load would be noise, not signal.
 */
/** A node's box in screen pixels, relative to the canvas container. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a node sits on screen, given the canvas pan/zoom.
 *
 * The one piece of arithmetic that has to agree everywhere: the off-screen
 * check and anything that draws on top of a node (a tour highlight, say) must
 * place it identically, or the overlay drifts from what it points at.
 */
export function toScreenRect(node: NodeBox, viewport: CanvasViewport): ScreenRect {
  const [translateX, translateY, zoom] = viewport.transform;
  return {
    left: node.x * zoom + translateX,
    top: node.y * zoom + translateY,
    width: node.width * zoom,
    height: node.height * zoom,
  };
}

/** Whether any part of a node's box falls inside the canvas. */
export function isOnScreen(node: NodeBox, viewport: CanvasViewport): boolean {
  const { width, height } = viewport;
  if (width <= 0 || height <= 0) return false;
  if (viewport.transform[2] <= 0) return false;

  const rect = toScreenRect(node, viewport);
  // `<=` / `>=` so a box flush against an edge — zero visible pixels — counts
  // as gone rather than as a sliver the user can supposedly see.
  return !(
    rect.left + rect.width <= 0 ||
    rect.top + rect.height <= 0 ||
    rect.left >= width ||
    rect.top >= height
  );
}

export function offscreenNodeIds(nodes: NodeBox[], viewport: CanvasViewport): string[] {
  const { width, height } = viewport;
  if (width <= 0 || height <= 0) return [];
  if (viewport.transform[2] <= 0) return [];

  return nodes.filter((node) => !isOnScreen(node, viewport)).map((node) => node.id);
}
