/**
 * The drawn outline of a node whose shape a CSS border cannot make (#192):
 * show_graph's octagon (a feedback sender), double octagon (a controller) and
 * double circle (a node on a cycle). Fills the node's box, measured as it
 * changes, and draws the shape inside it with the same width and colour the
 * oval's border would have, plus the oval's selection ring and shadow.
 *
 * Sits behind the node's content (z-index -1 inside the React Flow node's
 * stacking context), so the name, tags and badges paint over it.
 */

import { useEffect, useRef, useState } from "react";
import { polygonPoints, type NodeShape } from "@/utils/nodeShape";

interface Props {
  shape: NodeShape;
  stroke: string;
  strokeWidth: number;
  fill: string;
  /** The ring round a selected or cursor-highlighted node, 2 px outside the outline. */
  ring?: string;
  /** A `drop-shadow(...)` filter, following the shape where a box-shadow would not. */
  shadow?: string;
}

/** Space between the two lines of a double outline. */
const DOUBLE_GAP = 3;

export function NodeShapeOutline({ shape, stroke, strokeWidth, fill, ring, shadow }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // The node may be zoomed; the SVG's own box is what its coordinates use.
      setSize({ w: el.clientWidth || r.width, h: el.clientHeight || r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const double = shape === "doubleoctagon" || shape === "doublecircle";
  const round = shape === "doublecircle";
  const outerInset = strokeWidth / 2;
  const innerInset = outerInset + strokeWidth + DOUBLE_GAP;

  const outline = (inset: number, extra: React.SVGProps<SVGElement>, key: string) =>
    round ? (
      <ellipse
        key={key}
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - inset)}
        ry={Math.max(0, h / 2 - inset)}
        {...(extra as React.SVGProps<SVGEllipseElement>)}
      />
    ) : (
      <polygon key={key} points={polygonPoints(shape, w, h, inset)} {...(extra as React.SVGProps<SVGPolygonElement>)} />
    );

  return (
    <svg
      ref={ref}
      data-testid="node-shape-outline"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: -1,
        filter: shadow,
      }}
    >
      {w > 0 && h > 0 && (
        <>
          {ring &&
            outline(outerInset, { "data-outline": "ring", style: { fill: "none", stroke: ring }, strokeWidth: strokeWidth + 4 } as any, "ring")}
          {outline(outerInset, { "data-outline": "outer", style: { fill, stroke }, strokeWidth } as any, "outer")}
          {double &&
            outline(innerInset, { "data-outline": "inner", style: { fill: "none", stroke }, strokeWidth } as any, "inner")}
        </>
      )}
    </svg>
  );
}
