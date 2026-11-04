/**
 * How big a node's oval is for its name: Graphviz's rule, so a node is the
 * size show_graph() draws it and its text has show_graph's proportion (#210).
 *
 * Graphviz puts a margin round the label (0.11in = 8pt each side, 0.055in =
 * 4pt above and below), then enlarges that box by √2 in both directions so
 * it fits inside the ellipse; an oval is never narrower than 0.75in (54pt)
 * or shorter than 0.5in (36pt). PsyNeuView draws points as pixels, so the
 * same numbers hold. show_graph's labels are 12pt Arial; the canvas draws a
 * name at 14px, so its ovals come out a little larger than show_graph's for
 * the same name, and the "Like show_graph" layout enlarges show_graph's
 * picture only by the little that takes.
 */

/** Graphviz's least oval: 0.75in by 0.5in, in points. */
export const NODE_MIN_WIDTH = 54;
export const NODE_MIN_HEIGHT = 36;

const MARGIN_X = 8;
const MARGIN_Y = 4;

/** The name's font on the canvas: MechanismNode's name line. */
export const NODE_NAME_FONT_SIZE = 14;
export const NODE_NAME_FONT_WEIGHT = 600;
/** What the browser gives a 14px line in the app's font stack. */
export const NODE_NAME_LINE_HEIGHT = 17;

let canvas: CanvasRenderingContext2D | null | undefined;
let fontFamily: string | undefined;
const widths = new Map<string, number>();

function context(): CanvasRenderingContext2D | null {
  if (canvas !== undefined) return canvas;
  try {
    canvas = document.createElement("canvas").getContext("2d");
  } catch {
    canvas = null;
  }
  return canvas;
}

/**
 * The width of one line of a name as the canvas draws it, in pixels. Measured
 * with the app's font where there is a page to measure in; otherwise (tests
 * on node) an estimate of 0.62em a character, about right for a sans-serif.
 */
export function nameLineWidth(line: string): number {
  const key = line;
  const known = widths.get(key);
  if (known !== undefined) return known;
  let w: number;
  const ctx = context();
  if (ctx) {
    if (fontFamily === undefined) {
      try {
        fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
      } catch {
        fontFamily = "sans-serif";
      }
    }
    ctx.font = `${NODE_NAME_FONT_WEIGHT} ${NODE_NAME_FONT_SIZE}px ${fontFamily}`;
    w = ctx.measureText(line).width;
  } else {
    w = line.length * NODE_NAME_FONT_SIZE * 0.62;
  }
  widths.set(key, w);
  return w;
}

/** Clear space kept between a name's corners and the inside of a heavy outline. */
const OUTLINE_CLEARANCE = 1;

/** Space between the two lines of a double outline (NodeShapeOutline). */
export const DOUBLE_OUTLINE_GAP = 3;

/**
 * How much of a node's box its outline takes, on each side: the one line, or
 * for a double outline both lines and the gap between them.
 */
export function outlineThickness(double: boolean, strokeWidth: number): number {
  return double ? 2 * strokeWidth + DOUBLE_OUTLINE_GAP : strokeWidth;
}

/**
 * The least width and height of the oval that holds a name, by Graphviz's
 * rule. `outline` is outlineThickness: Graphviz draws its line along the oval
 * and adds further rings outside it, while PsyNeuView's outline lies inside
 * the box, so a heavy outline or a double one needs a bigger box to leave the
 * name's corners inside the innermost line. An ordinary thin outline fits in
 * Graphviz's margin and changes nothing.
 */
export function ovalBoxFor(name: string, outline = 0): { width: number; height: number } {
  const lines = (name || "").split("\n");
  const textW = Math.max(...lines.map(nameLineWidth), 0);
  const textH = lines.length * NODE_NAME_LINE_HEIGHT;
  const inside = (text: number) => Math.ceil((text + 2 * OUTLINE_CLEARANCE) * Math.SQRT2 + 2 * outline);
  return {
    width: Math.max(NODE_MIN_WIDTH, Math.ceil((textW + 2 * MARGIN_X) * Math.SQRT2), inside(textW)),
    height: Math.max(NODE_MIN_HEIGHT, Math.ceil((textH + 2 * MARGIN_Y) * Math.SQRT2), inside(textH)),
  };
}
