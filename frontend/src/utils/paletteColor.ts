/**
 * A palette token's colour, for code that cannot take `var(--pnv-…)`. (#1302)
 *
 * Plotly parses its colours itself and does not understand a CSS variable,
 * so a chart asks for the token's current value here instead of writing the
 * hex it stands for. Returns undefined when the palette is not loaded (a unit
 * test without the stylesheet); Plotly then falls back to its own colour.
 */
export function paletteColor(token: `--pnv-${string}`): string | undefined {
  if (typeof document === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || undefined;
}

/** The chart series colours, --pnv-chart-1 … --pnv-chart-8, in order. */
export const CHART_SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--pnv-chart-${i}` as const);

/**
 * A palette token as a six-digit hex, for an <input type="color">, which
 * takes nothing else (not "#555", not var()). Graph ▸ Style's role and edge
 * colour pickers start from the tokens through this. Undefined when the
 * palette is not loaded or the token is not a plain hex colour.
 */
export function paletteHex(token: `--pnv-${string}`): string | undefined {
  const value = paletteColor(token)?.toLowerCase();
  if (!value) return undefined;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return "#" + [...value.slice(1)].map((c) => c + c).join("");
  return undefined;
}
