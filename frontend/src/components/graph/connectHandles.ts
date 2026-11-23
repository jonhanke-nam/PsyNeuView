/** The two handles every node has for drag-to-connect (#253). */
export const CONNECT_HANDLE = "__connect__";
export const NODE_TARGET_HANDLE = "__node__";

/**
 * How a connection starts: only by dragging, never by clicking (#317).
 *
 * React Flow's own default, `connectOnClick`, makes a click on any handle
 * start a connection and the next click on another handle finish it. Every
 * port dot and every node's connector is a handle, and the connector is there
 * (transparent) even when it isn't shown, so two ordinary clicks near nodes'
 * rims could add a projection to the model. A click selects; only a drag
 * connects.
 *
 * And the drag must be a real one: past a few pixels, as a drag on an arrow or
 * a connection dot must be (#250), so a click that wobbles is still a click.
 */
export const CONNECT_GESTURE = {
  connectOnClick: false,
  connectionDragThreshold: 4,
} as const;
