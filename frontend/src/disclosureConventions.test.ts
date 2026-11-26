/**
 * One standard expand / collapse control (#418).
 *
 * docs/ui-interaction-conventions.md ("Expand and collapse") is the standard:
 * a panel edge is a PanelHandle (a resize line with an arrow tab), and a row
 * or section that folds shows the same arrow turned (DisclosureArrow, or
 * DisclosureDetails for a native <details>). This reads the frontend's source
 * and fails for:
 *
 *  - a control whose click opens or closes something (it flips an open,
 *    expanded, collapsed, folded or shown state, or calls a toggleNode /
 *    toggleSection / toggleGroup / toggleFile / toggleFolder / toggleCompact)
 *    that lacks `aria-expanded`, or that is a <div> or <span> rather than a
 *    button the keyboard can reach;
 *  - a fold drawn with a glyph outside the standard set: a ternary that picks
 *    between ▶ ▼ ▸ ▾ ◀ › ⌄ for open and closed, or a ▶ turned by a rotate;
 *  - a raw <details> / <summary> outside Disclosure.tsx (it would show the
 *    browser's own marker and no aria-expanded);
 *  - a panel splitter that is not ours (the Allotment sash, which could be
 *    neither focused nor given a collapse tab).
 *
 * A source check, not a render. e2e/expand-collapse-standard.spec.ts checks
 * the same controls in a browser, with the keyboard and the mouse.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** The source without comments, so a comment that names a glyph or a tag is not a hit. */
export function stripComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Each JSX opening tag: its name and its attribute text. The tag runs from
 * `<Name` to the `>` that closes it at brace depth zero, outside strings, and
 * not part of a `=>`.
 */
export function openingTags(source: string): { name: string; attrs: string }[] {
  const tags: { name: string; attrs: string }[] = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s>/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    tags.push({ name: m[1], attrs: source.slice(m.index + m[0].length, i) });
  }
  return tags;
}

/** An onClick that opens or closes something. */
const TOGGLE_CLICK =
  /onClick=\{[\s\S]*?(set\w*(Open|Expanded|Collapsed|Folded|Shown)\(\s*\(?\w+\)?\s*=>\s*!\w+|toggle(Node|Section|Group|File|Folder|Compact)\()/;

/** Glyphs that some folds used before #418; none may stand for open / closed now. */
const OLD_GLYPHS = "▶▼▸▾◀›⌄";
const OLD_GLYPH_ESCAPES = ["\\u25b6", "\\u25bc", "\\u25b8", "\\u25be", "\\u25c0", "\\u203a", "\\u2304"];
const glyphAlt = [...OLD_GLYPHS].join("|") + "|" + OLD_GLYPH_ESCAPES.map((e) => e.replace(/\\/g, "\\\\")).join("|");
/** `cond ? "▾" : "▸"`, with or without trailing text in the strings. */
const GLYPH_TERNARY = new RegExp(`\\?\\s*["'\`](${glyphAlt})[^"'\`]{0,3}["'\`]\\s*:\\s*["'\`](${glyphAlt})`, "i");
/** A ▶ turned to mean "open". */
const ROTATED_GLYPH = /\?\s*["']rotate\(90deg\)["']/;

const files = sourceFiles(SRC);
const rel = (f: string) => path.relative(SRC, f);

describe("expand / collapse controls (#418)", () => {
  it("finds the source", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every control that opens or closes something is a button with aria-expanded", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const tag of openingTags(src)) {
        if (!TOGGLE_CLICK.test(tag.attrs)) continue;
        const where = `${rel(f)} <${tag.name}>`;
        if (tag.name === "div" || tag.name === "span") problems.push(`${where}: a clickable ${tag.name}; make it a <button>`);
        if (!/aria-expanded=/.test(tag.attrs)) problems.push(`${where}: no aria-expanded`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("no fold picks an old glyph for open and closed", () => {
    const problems: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      src.split("\n").forEach((line, i) => {
        if (GLYPH_TERNARY.test(line) || ROTATED_GLYPH.test(line)) problems.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(problems, "use DisclosureArrow (rows) or PanelHandle (panel edges)").toEqual([]);
  });

  it("native <details> only through DisclosureDetails", () => {
    const problems = files
      .filter((f) => !f.endsWith(path.join("common", "Disclosure.tsx")))
      .filter((f) => /<(details|summary)[\s>]/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(problems).toEqual([]);
  });

  it("the panel splitters are PanelHandles, not Allotment sashes", () => {
    const users = files.filter((f) => /from\s+["']allotment["']/.test(readFileSync(f, "utf8"))).map(rel);
    expect(users).toEqual([]);
    const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
    expect(app).toMatch(/<SplitPane[\s\S]*<SplitPane/);
  });

  // The checks above have to be able to fail.
  it("catches the patterns it is for", () => {
    const div = openingTags(`<div onClick={() => setOpen((o) => !o)} style={{ a: 1 }}>x</div>`);
    expect(div[0].name).toBe("div");
    expect(TOGGLE_CLICK.test(div[0].attrs)).toBe(true);
    const btn = openingTags(`<button onClick={() => toggleFolder(f)} aria-expanded={x}>y</button>`);
    expect(TOGGLE_CLICK.test(btn[0].attrs) && /aria-expanded=/.test(btn[0].attrs)).toBe(true);
    expect(GLYPH_TERNARY.test(`{open ? "▾" : "▸"}`)).toBe(true);
    expect(GLYPH_TERNARY.test(`{folded ? "\\u25b6" : "\\u25bc"}`)).toBe(true);
    expect(GLYPH_TERNARY.test(`{shown ? "▼ " : "▶ "} Manage`)).toBe(true);
    expect(GLYPH_TERNARY.test(`Layout {"▾"}`)).toBe(false);
    expect(ROTATED_GLYPH.test(`transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)"`)).toBe(true);
    expect(stripComments(`{/* the <details> pattern */}<b/>`)).toBe("<b/>");
  });
});
