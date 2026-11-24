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

// show_graph's node text, as Graphviz sizes it: 12pt Arial (showgraph.py's
// node defaults), lines 1.2em apart. Arial has Helvetica's widths, which are
// what Graphviz's own estimate uses.
const SG_FONT_SIZE = 12;
const SG_LINE_HEIGHT = SG_FONT_SIZE * 1.2;
const SG_FONT = `${SG_FONT_SIZE}px Arial, Helvetica, "Liberation Sans", sans-serif`;
// Graphviz's space between the two lines of a double outline, in points.
const SG_PERIPHERY_GAP = 4;
const sgWidths = new Map<string, number>();

/** A line of a name's width in show_graph's font, in points. */
export function showGraphLineWidth(line: string): number {
  const known = sgWidths.get(line);
  if (known !== undefined) return known;
  const ctx = context();
  let w: number;
  if (ctx) {
    ctx.font = SG_FONT;
    w = ctx.measureText(line).width;
  } else {
    w = line.length * SG_FONT_SIZE * 0.6;
  }
  sgWidths.set(line, w);
  return w;
}

const isCircleShape = (shape: string) => shape === "circle" || shape === "doublecircle";
const isOctagonShape = (shape: string) => shape === "octagon" || shape === "doubleoctagon";

/**
 * A node's proportions, width over height, as show_graph draws it (#385):
 * Graphviz's own sizing (shapes.c, poly_init) for the name in show_graph's
 * font. The label's box, with Graphviz's margin, grows to the ellipse through
 * its corners (by √2, or where the least height has room to spare, by only
 * as much as that ellipse needs); an octagon is that, over cos 22.5°; a box
 * is just the label's box. Each is never less than 0.75in by 0.5in, a circle
 * is as wide as it is tall, and a second outline adds 4pt on every side.
 */
export function showGraphAspect(name: string, shape: string): number {
  if (isCircleShape(shape)) return 1;
  const lines = (name || "").split("\n");
  let bx = Math.max(...lines.map(showGraphLineWidth), 0) + 2 * MARGIN_X;
  let by = lines.length * SG_LINE_HEIGHT + 2 * MARGIN_Y;
  if (shape !== "rectangle") {
    if (NODE_MIN_HEIGHT > by * Math.SQRT2) {
      bx *= Math.sqrt(1 / (1 - (by / NODE_MIN_HEIGHT) ** 2));
    } else {
      bx *= Math.SQRT2;
      by *= Math.SQRT2;
    }
    if (isOctagonShape(shape)) {
      const c = Math.cos(Math.PI / 8);
      bx /= c;
      by /= c;
    }
  }
  let w = Math.max(NODE_MIN_WIDTH, bx);
  let h = Math.max(NODE_MIN_HEIGHT, by);
  if (shape === "doubleoctagon") {
    w += 2 * SG_PERIPHERY_GAP;
    h += 2 * SG_PERIPHERY_GAP;
  }
  return w / h;
}

/**
 * Whether a box of text, `tx` by `ty` round its centre, lies inside the shape
 * drawn in an `a` by `b` half-box (the outline's inside edge).
 */
function holds(shape: string, a: number, b: number, tx: number, ty: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const x = tx / a, y = ty / b;
  if (shape === "rectangle") return x <= 1 && y <= 1;
  if (isOctagonShape(shape)) return x <= 1 && y <= 1 && x + y <= 1 + Math.tan(Math.PI / 8);
  return x * x + y * y <= 1;
}

/**
 * The box for a node showing its name, in the shape show_graph gives it, with
 * show_graph's proportions (#385). The scale is PsyNeuView's: the name in the
 * canvas's own font (and `extraWidth`, room for a button) lies inside the
 * shape with Graphviz's margin round it, and inside the outline (#333's
 * rule), and the box
 * keeps show_graph's width-to-height ratio (showGraphAspect) exactly. For a
 * circle that is a diameter covering the text's diagonal, with its margin or
 * plus the outline, whichever is more.
 * `outline` is outlineThickness: PsyNeuView's outline lies inside the box.
 * Never shorter than Graphviz's least node, 0.5in.
 */
export function shapedBoxFor(
  name: string,
  shape: string,
  outline = 0,
  extraWidth = 0,
): { width: number; height: number } {
  const lines = (name || "").split("\n");
  const textW = Math.max(...lines.map(nameLineWidth), 0) + extraWidth;
  const textH = lines.length * NODE_NAME_LINE_HEIGHT;
  const aspect = showGraphAspect(name, shape);
  // The least half-height whose box, at show_graph's proportions, holds the
  // name with Graphviz's margin round it inside the shape, and the name's own
  // corners inside the outline (as ovalBoxFor): found by halving the interval.
  const fits = (b: number) =>
    holds(shape, aspect * b, b, textW / 2 + MARGIN_X, textH / 2 + MARGIN_Y) &&
    holds(shape, aspect * b - outline, b - outline, textW / 2 + OUTLINE_CLEARANCE, textH / 2 + OUTLINE_CLEARANCE);
  let lo = 0;
  let hi = Math.max(textW, textH) * 4 + outline + MARGIN_X + 1;
  while (!fits(hi)) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const height = Math.max(NODE_MIN_HEIGHT, Math.ceil(2 * hi));
  return { width: Math.ceil(aspect * height), height };
}

/**
 * The diameter of the circle round a box of text (#385): the box's diagonal,
 * plus the outline on each side, never less than Graphviz's least circle.
 */
export function circleSide(content: { width: number; height: number }, outline: number): number {
  return Math.max(NODE_MIN_HEIGHT, Math.ceil(Math.hypot(content.width, content.height) + 2 * outline));
}

/** Clear space kept round an expanded node's text, inside its outline (#333). */
export const EXPANDED_CLEARANCE = 4;

/**
 * The least box that holds an expanded node's text inside its shape (#333).
 *
 * An expanded node shows its ports, function and roles under its name: a
 * rectangle of text, `content` wide and high. A box that merely wraps that
 * rectangle puts its corners on, or past, an oval's or an octagon's outline,
 * since the shape is inscribed in the box. Graphviz's rule (ovalBoxFor)
 * answers: enlarge the text's box by √2 each way. The rectangle's corners then
 * lie on the ellipse, (1/√2)² + (1/√2)² = 1, and on an octagon's cut corner
 * too, 1/√2 + 1/√2 = √2 = 1 + tan 22.5°. A rectangle needs no enlarging; a
 * circle (#385) is as wide as it is tall, its diameter the text's diagonal. The
 * outline, at its heaviest (`outline` is outlineThickness), lies inside the
 * box, so it is added outside the enlarged box, and EXPANDED_CLEARANCE keeps
 * the text off it.
 */
export function expandedBoxFor(
  content: { width: number; height: number },
  shape: string,
  outline: number,
): { width: number; height: number } {
  if (shape === "circle" || shape === "doublecircle") {
    // #385: a circle stays a circle; its diameter covers the text's diagonal.
    const d = circleSide(
      { width: content.width + 2 * EXPANDED_CLEARANCE, height: content.height + 2 * EXPANDED_CLEARANCE },
      outline,
    );
    return { width: d, height: d };
  }
  const grow = shape === "rectangle" ? 1 : Math.SQRT2;
  const side = (text: number) => Math.ceil((text + 2 * EXPANDED_CLEARANCE) * grow + 2 * outline);
  return { width: side(content.width), height: side(content.height) };
}
