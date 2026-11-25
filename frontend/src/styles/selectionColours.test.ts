/**
 * The selection blue never looks like a role colour. (#335)
 *
 * `--pnv-selection-fill`, `-border` and `-text` mark whatever is selected or
 * current: a selected node or edge, the current trial in Per-trial values.
 * The current trial used to be green, which read as an input node's green.
 * Each selection token must be at least MIN_DISTANCE from every
 * `--pnv-role-*` colour (straight-line distance in 0-255 RGB), in the light
 * theme and in the dark set.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Read from disk: a ?raw import of a stylesheet comes back empty under vitest.
const paletteCss = readFileSync(fileURLToPath(new URL("./palette.css", import.meta.url)), "utf8");

const MIN_DISTANCE = 60;
const SELECTION = ["--pnv-selection-fill", "--pnv-selection-border", "--pnv-selection-text"];

function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function distance(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--pnv-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out.set(m[1], m[2]);
  return out;
}

const css = paletteCss.replace(/\/\*[\s\S]*?\*\//g, "");
const darkStart = css.search(/@media[^{]*prefers-color-scheme:\s*dark/);
const light = tokens(darkStart >= 0 ? css.slice(0, darkStart) : css);
const dark = darkStart >= 0 ? new Map([...light, ...tokens(css.slice(darkStart))]) : null;

// The role colours themselves (not their -text, -tint or -border variants).
const roles = [...light].filter(([k]) => /^--pnv-role-[a-z-]+$/.test(k) && !/-(text|tint|border)$/.test(k));

describe("selection colours", () => {
  it("palette.css defines the selection set and the role colours", () => {
    for (const t of SELECTION) expect(light.get(t), t).toMatch(/^#/);
    expect(roles.length).toBeGreaterThanOrEqual(8);
  });

  it("the dark set defines all three", () => {
    expect(dark, "no dark block in palette.css").not.toBeNull();
    for (const t of SELECTION) expect(dark!.get(t), t).not.toBe(light.get(t));
  });

  it("the deeper active shade (#387) is built from the selection fill and border, so it follows them in both sets", () => {
    const m = css.match(/--pnv-selection-fill-strong:\s*([^;]+);/);
    expect(m, "--pnv-selection-fill-strong is not defined").not.toBeNull();
    expect(m![1]).toMatch(/var\(--pnv-selection-border\)/);
    expect(m![1]).toMatch(/var\(--pnv-selection-fill\)/);
  });

  for (const [name, values] of [["light", light], ["dark", dark]] as const) {
    it(`each is at least ${MIN_DISTANCE} from every role colour (${name})`, () => {
      const close: string[] = [];
      for (const t of SELECTION) {
        const c = values!.get(t)!;
        for (const [role, rc] of roles) {
          const d = distance(c, rc);
          if (d < MIN_DISTANCE) close.push(`${t} ${c} is ${d.toFixed(0)} from ${role} ${rc}`);
        }
      }
      expect(close).toEqual([]);
    });
  }
});
