// Types for style-report.mjs, for src/styleConventions.test.ts (#1302).

export interface StyleRow {
  /** Relative to src/. */
  file: string;
  /** The colour literals written in the file, in order. */
  colours: string[];
  /** How many <button>s carry a style= of their own. */
  buttons: number;
  /** The palette tokens the file uses, as `--pnv-…`. */
  tokens: string[];
}

export const SRC: string;
export const PALETTE: string;
export function sourceFiles(dir?: string): string[];
export function stripComments(source: string): string;
export function colourLiterals(source: string): string[];
export function inlineStyledButtons(source: string): number;
export function tokensUsed(source: string): string[];
export function paletteTokens(): Set<string>;
export function scan(dir?: string): StyleRow[];
/** The colours a file may still write by hand, and why (see the .mjs). */
export const ALLOWED_COLOURS: Record<string, { literals: string[]; why: string }>;
/** The colours a row writes beyond what ALLOWED_COLOURS lets its file write. */
export function unallowedColours(row: StyleRow): string[];
