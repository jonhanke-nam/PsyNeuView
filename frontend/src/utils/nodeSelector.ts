/**
 * A CSS selector for a node's canvas element, whatever its name (#1236).
 *
 * Node ids are PsyNeuLink names, and a name can contain a newline, quotes or a
 * backslash. Put into a selector unescaped, those make it invalid and
 * `querySelector` throws. Always build node selectors here.
 */

/** `CSS.escape`, with a fallback for environments that lack it (older jsdom). */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[\0-\x1f\x7f"\\]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

export function nodeSelector(id: string): string {
  return `.react-flow__node[data-id="${cssEscape(id)}"]`;
}
