#!/usr/bin/env node
/**
 * Where the frontend writes colours and button styles by hand. (#1302)
 *
 *   node scripts/style-report.mjs            the report, per file
 *   node scripts/style-report.mjs --json     the same as JSON
 *   node scripts/style-report.mjs --check    fail (exit 1) on a hand-written
 *                                            colour, or a token palette.css
 *                                            does not define; CI runs this
 *
 * Two things are counted in every .ts, .tsx and .css file under src/, with
 * comments stripped first, and styles/palette.css left out (it is where the
 * colours are meant to be):
 *
 *   colours   a hex colour ("#1a73e8", "#ccc") or an rgb()/rgba()/hsl()
 *             call written in the file, rather than a palette token
 *             (var(--pnv-…)) from styles/palette.css;
 *   buttons   a <button> with a style= of its own, rather than the Button
 *             component (components/common/Button.tsx), whose kinds carry
 *             the sizes and colours. The × from DialogHeader is a button
 *             with a style too; it is the one icon button and is counted
 *             with its file, dialog/DialogHeader.tsx.
 *
 * Every file is swept: no file writes a colour of its own except the ones in
 * ALLOWED_COLOURS below, each with the reason. src/styleConventions.test.ts
 * imports `scan` and fails on any other colour, on a file whose count of
 * inline-styled buttons changes without being named there, and on a token a
 * file uses that palette.css does not define.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(HERE, "../src");
export const PALETTE = path.join(SRC, "styles/palette.css");
/** The Button component draws the one styled <button> the kinds come from. */
const BUTTON = path.join(SRC, "components/common/Button.tsx");

/**
 * The colours a file may still write by hand, exactly these and no more, and
 * why a palette token cannot do. docs/ui-style-conventions.md lists them too.
 */
export const ALLOWED_COLOURS = {
  "utils/graphCursor.ts": {
    literals: ["#000", "#fff"],
    why:
      "the graph pointer is an image: an SVG drawn into a data: URL for `cursor: url(…)`, which cannot read a CSS " +
      "variable, and its black arrow with a white edge is the system pointer's look, not a palette colour",
  },
};

/** Every source file under `dir`, excluding tests, the palette and Button itself. */
export function sourceFiles(dir = SRC) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && full !== PALETTE && full !== BUTTON) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** The file without its comments (//, /* *\/ and JSX {/* *\/}), strings kept. */
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? n : end;
      continue;
    }
    // An apostrophe straight after a letter or digit is a contraction in JSX
    // text ("PsyNeuLink's"), never the start of a string; read as one, it
    // would swallow everything up to the next apostrophe, comments included.
    if (c === "'" && i > 0 && /[A-Za-z0-9]/.test(source[i - 1])) {
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // Copy the string whole, so a // inside a URL is not a comment.
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") j++;
        if (c === "`" && source[j] === "$" && source[j + 1] === "{") {
          // A template's ${…}: skip to its closing brace, counting nesting.
          let depth = 0;
          while (j < n) {
            if (source[j] === "{") depth++;
            else if (source[j] === "}" && --depth === 0) break;
            j++;
          }
        }
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const HEX = /(^|["'`\s(,:])(#[0-9a-fA-F]{3,8})(?=["'`\s;,)]|$)/gm;
const FUNC = /\b(?:rgba?|hsla?)\([^)]*\)/g;

/** The colour literals in a file's (comment-stripped) source, in order. */
export function colourLiterals(source) {
  const found = [];
  for (const m of source.matchAll(HEX)) {
    const hex = m[2];
    // A 4-digit all-decimal "#1234" is an issue number in a string, not a colour;
    // so is a 3-digit one in brackets, "(#258)", as a tooltip cites it.
    if (/^#\d{4}$/.test(hex)) continue;
    if (/^#\d{3}$/.test(hex) && m[1] === "(" && source[m.index + m[0].length] === ")") continue;
    found.push(hex);
  }
  for (const m of source.matchAll(FUNC)) found.push(m[0].replace(/\s+/g, ""));
  return found;
}

/**
 * How many <button> tags carry a style= of their own. The tag runs from
 * `<button` to its closing `>` at brace depth zero, so a `=>` inside an
 * onClick does not end it early.
 */
export function inlineStyledButtons(source) {
  let count = 0;
  let from = 0;
  for (;;) {
    const start = source.indexOf("<button", from);
    if (start < 0) break;
    let i = start + 7;
    let depth = 0;
    let quote = null;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    const tag = source.slice(start, i);
    if (/\sstyle=/.test(tag)) count++;
    from = i;
  }
  return count;
}

/**
 * The palette tokens a file refers to: var(--pnv-…), or a token's name as a
 * string ("--pnv-projection-mapping"), as code that resolves a token through
 * paletteColor() names it.
 */
export function tokensUsed(source) {
  return [...source.matchAll(/(?:var\(|["'])--pnv-([a-z0-9-]+)(?=[)"'])/g)].map((m) => `--pnv-${m[1]}`);
}

/** Colours a row writes beyond what ALLOWED_COLOURS lets its file write. */
export function unallowedColours(row) {
  const allowed = [...(ALLOWED_COLOURS[row.file]?.literals ?? [])];
  const extra = [];
  for (const c of row.colours) {
    const i = allowed.indexOf(c);
    if (i >= 0) allowed.splice(i, 1);
    else extra.push(c);
  }
  return extra;
}

/** The tokens palette.css defines. */
export function paletteTokens() {
  const css = readFileSync(PALETTE, "utf8");
  return new Set([...css.matchAll(/^\s*(--pnv-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}

/** One row per file that has anything to report. */
export function scan(dir = SRC) {
  const rows = [];
  for (const file of sourceFiles(dir)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const colours = colourLiterals(source);
    const buttons = inlineStyledButtons(source);
    const tokens = tokensUsed(source);
    rows.push({ file: path.relative(SRC, file), colours, buttons, tokens });
  }
  return rows;
}

function report(rows) {
  const used = rows.filter((r) => r.colours.length || r.buttons);
  used.sort((a, b) => b.colours.length - a.colours.length || b.buttons - a.buttons || a.file.localeCompare(b.file));
  const width = Math.max(...used.map((r) => r.file.length), 4);
  const lines = [`${"file".padEnd(width)}  colours  buttons`];
  for (const r of used) lines.push(`${r.file.padEnd(width)}  ${String(r.colours.length).padStart(7)}  ${String(r.buttons).padStart(7)}`);
  const colours = used.reduce((n, r) => n + r.colours.length, 0);
  const buttons = used.reduce((n, r) => n + r.buttons, 0);
  const distinct = new Set(used.flatMap((r) => r.colours.map((c) => c.toLowerCase()))).size;
  lines.push("");
  lines.push(`${used.length} of ${rows.length} files write colours or button styles by hand: ${colours} colour literals (${distinct} distinct), ${buttons} inline-styled <button>s.`);
  lines.push("Every file is swept: the colours left are the allowed exceptions (ALLOWED_COLOURS), the buttons are");
  lines.push("controls that are not a Button kind, each named in src/styleConventions.test.ts.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = scan();
  if (process.argv.includes("--check")) {
    const defined = paletteTokens();
    const problems = [];
    for (const r of rows) {
      const extra = unallowedColours(r);
      if (extra.length) problems.push(`${r.file}: writes ${extra.join(", ")} by hand; use a palette token (styles/palette.css)`);
      for (const t of new Set(r.tokens)) if (!defined.has(t)) problems.push(`${r.file}: uses ${t}, which styles/palette.css does not define`);
    }
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error(`\n${problems.length} problem(s). docs/ui-style-conventions.md says which token is for what.`);
      process.exit(1);
    }
    console.log(`Style check: no hand-written colours outside the ${Object.keys(ALLOWED_COLOURS).length} allowed exception(s); every token is defined.`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows.map((r) => ({ file: r.file, colours: r.colours.length, buttons: r.buttons, literals: r.colours })), null, 2));
  } else {
    console.log(report(rows));
  }
}
