/**
 * Where CIMs go. The layout leaves them out, so the graph stays connected the
 * way the model draws it, and they are placed on top of it afterwards,
 * relative to a composition frame: Input CIMs above it, Output CIMs below it,
 * and Parameter CIMs to its right, side by side in the order they come.
 *
 * The graph build places them, and so does a layout run again over the drawn
 * graph (useLayeredLayoutFit, #72), so both use this.
 */

import type { Node } from "@xyflow/react";

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The frame CIMs are placed against: the first composition frame on the
 * canvas (for a top-level composition, its first nested one), or a default box
 * at the origin when there is none.
 */
export function cimAnchor(nodes: Node[]): FrameBox {
  const frame = nodes.find((n) => n.type === "compositionNode");
  return {
    x: frame?.position.x ?? 0,
    y: frame?.position.y ?? 0,
    w: (frame?.style?.width as number) ?? 300,
    h: (frame?.style?.height as number) ?? 200,
  };
}

/** The `index`th connected CIM of its composition, of type `cimType`. */
export function cimPosition(
  frame: FrameBox,
  cimType: string,
  index: number,
): { x: number; y: number } {
  if (cimType === "INPUT_CIM")
    return { x: frame.x + frame.w / 2 - 50 + index * 140, y: frame.y - 60 };
  if (cimType === "OUTPUT_CIM")
    return {
      x: frame.x + frame.w / 2 - 50 + index * 140,
      y: frame.y + frame.h + 20,
    };
  return { x: frame.x + frame.w + 40, y: frame.y + index * 60 };
}

/**
 * Put each CIM on the canvas back in its place against the frame as it is now,
 * after a layout has moved or resized it. CIMs without a recorded `cimIndex`
 * (one placed from a saved layout) are left where they are.
 */
export function placeCims(nodes: Node[]): Node[] {
  const frame = cimAnchor(nodes);
  return nodes.map((n) => {
    const data = n.data as { cimType?: string; cimIndex?: number } | undefined;
    if (n.type !== "cimNode" || data?.cimIndex === undefined) return n;
    return {
      ...n,
      position: cimPosition(frame, data.cimType ?? "INPUT_CIM", data.cimIndex),
    };
  });
}
