/**
 * Where the graph's visible middle is, in flow coordinates (#252), for code
 * outside the canvas: a node added with no point chosen goes there, so nothing
 * the user creates appears off-screen. GraphCanvas registers the answer.
 */
type Point = { x: number; y: number };

let provider: (() => Point | null) | null = null;

export function registerVisibleCentre(fn: (() => Point | null) | null): void {
  provider = fn;
}

/** The visible middle of the graph, or null when no graph is showing. */
export function visibleCentre(): Point | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}
