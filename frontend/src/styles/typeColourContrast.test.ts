/**
 * Every component type's colour can be seen. (#283, #109)
 *
 * A type colour (`--pnv-type-*` in palette.css) is drawn as an icon in the
 * Components panel and as a node's outline on the graph, so it is a
 * graphical object and needs a contrast of at least 3:1 (WCAG 2.1, 1.4.11)
 * against what it sits on: the panel (`--pnv-surface-muted`) and a node's
 * fill (`--pnv-surface`). Pale colours such as `#e3f2fd` used to vanish.
 *
 * Checked in every theme palette.css defines: the light `:root` block and,
 * once the app has one, the `prefers-color-scheme: dark` block, whose type
 * colours must clear 3:1 against its own surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Read from disk: a ?raw import of a stylesheet comes back empty under vitest.
const paletteCss = readFileSync(fileURLToPath(new URL("./palette.css", import.meta.url)), "utf8");

const MIN_CONTRAST = 3;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `--name: #hex` declarations in one block of CSS. */
function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--pnv-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out.set(m[1], m[2]);
  return out;
}

/** The body of the `@media (prefers-color-scheme: dark)` block, if there is one. */
function darkBlock(css: string): string | null {
  const start = css.search(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/);
  if (start < 0) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return css.slice(start);
}

const css = paletteCss.replace(/\/\*[\s\S]*?\*\//g, "");
const dark = darkBlock(css);
const light = tokens(dark ? css.replace(dark, "") : css);

const themes: { name: string; values: Map<string, string> }[] = [{ name: "light", values: light }];
if (dark) themes.push({ name: "dark", values: new Map([...light, ...tokens(dark)]) });

describe("component type colours", () => {
  it("palette.css defines the type colours as hex", () => {
    expect([...light.keys()].filter((k) => k.startsWith("--pnv-type-")).length).toBeGreaterThan(50);
  });

  for (const { name, values } of themes) {
    const backgrounds = {
      "the Components panel (--pnv-surface-muted)": values.get("--pnv-surface-muted")!,
      "a node's fill (--pnv-surface)": values.get("--pnv-surface")!,
    };
    it(`each clears ${MIN_CONTRAST}:1 against the panel and a node's fill (${name})`, () => {
      const faint: string[] = [];
      for (const [token, colour] of values) {
        if (!token.startsWith("--pnv-type-")) continue;
        for (const [where, bg] of Object.entries(backgrounds)) {
          expect(bg, `${name} theme has no ${where}`).toBeTruthy();
          const ratio = contrast(colour, bg);
          if (ratio < MIN_CONTRAST) faint.push(`${token} ${colour} is ${ratio.toFixed(2)}:1 on ${where} ${bg}`);
        }
      }
      expect(faint, "type colours too faint to see; darken them (keep the hue)").toEqual([]);
    });
  }
});
