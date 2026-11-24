/**
 * show_graph's SVG with its colours as Graphviz's PDF draws them (#424).
 *
 * Graphviz keeps a colour name in an SVG ("green"), and a browser then reads
 * it from the CSS table (#008000) where show_graph's PDF and PNG draw the X11
 * value (#00ff00). The backend rewrites the SVG it serves
 * (backend/app/services/show_graph_picture.py); this is the same rewrite, from
 * the same table, for an SVG laid out in the browser with Graphviz (the e2e
 * comparison sheets). The app itself only lays out show_graph's description
 * as JSON, so nothing here ships in its bundle.
 */
import table from "../../../backend/app/services/graphviz_x11_colours.json";

/** Colour name (lower case) -> the hex value Graphviz's PDF draws it with. */
export const GRAPHVIZ_COLOURS: Readonly<Record<string, string>> = table.colours;

const PROPERTIES = "(?:stop-color|fill|stroke|color)";
// Not preceded by a letter or a dash, so stop-color's "color" and
// fill-opacity are not mistaken for a colour attribute.
const COLOUR_ATTR = new RegExp(`(?<![\\w-])(${PROPERTIES})(\\s*=\\s*)(["'])([A-Za-z][A-Za-z0-9]*)\\3`, "g");
const STYLE_ATTR = /(?<![\w-])(style\s*=\s*)(["'])([\s\S]*?)\2/g;
const STYLE_DECL = new RegExp(`(?<![\\w-])(${PROPERTIES})(\\s*:\\s*)([A-Za-z][A-Za-z0-9]*)(?=\\s*(?:;|!|$))`, "g");

/** The hex value Graphviz draws `name` with, or undefined if it is not one of its colour names. */
export function x11Hex(name: string): string | undefined {
  return GRAPHVIZ_COLOURS[name.toLowerCase()];
}

/**
 * `svg` with every colour name in a fill, stroke, color or stop-color
 * attribute, or in an inline style, replaced by its X11 hex value. Hex values,
 * none, transparent, gradients and text are left as they are.
 */
export function asGraphvizDrawsIt(svg: string): string {
  const out = svg.replace(COLOUR_ATTR, (whole, prop, eq, q, name) => {
    const hex = x11Hex(name);
    return hex ? `${prop}${eq}${q}${hex}${q}` : whole;
  });
  if (!out.includes("style")) return out;
  return out.replace(
    STYLE_ATTR,
    (_whole, head, q, body: string) =>
      `${head}${q}${body.replace(STYLE_DECL, (decl, prop, colon, name) => {
        const hex = x11Hex(name);
        return hex ? `${prop}${colon}${hex}` : decl;
      })}${q}`,
  );
}
