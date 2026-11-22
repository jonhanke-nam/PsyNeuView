/**
 * Every component type's colour can be seen. (#283, #109)
 *
 * A type colour (`--pnv-type-*` in palette.css) is drawn as an icon in the
 * Components panel and as a node's outline on the graph, so it is a
 * graphical object and needs a contrast of at least 3:1 (WCAG 2.1, 1.4.11)
 * against what it sits on: the panel (`--pnv-surface-muted`) and a node's
 * fill (`--pnv-surface`). Pale colours such as `#e3f2fd` used to vanish.
 *
 * Members of one family (the shades of one hue, listed together in the
 * panel) must also be told apart: any two differ by at least 0.06 in OKLCH
 * lightness or by a colour difference (CIEDE2000) of at least 8. So must
 * the few pairs from different families that used to share a colour.
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

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLCH lightness, 0 (black) to 1 (white). */
function oklchLightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference. */
function deltaE2000(x: string, y: string): number {
  const rad = Math.PI / 180;
  const [L1, a1, b1] = lab(x);
  const [L2, a2, b2] = lab(y);
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => ((Math.atan2(b, a) / rad) + 360) % 360;
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  let dh = C1 * C2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = C2 - C1;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cb = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2 !== 0) hb = Math.abs(h1 - h2) <= 180 ? hb / 2 : hb < 360 ? (hb + 360) / 2 : (hb - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
    + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cb, Sh = 1 + 0.015 * Cb * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const MIN_LIGHTNESS_STEP = 0.06;
const MIN_DELTA_E = 8;

/** Why two colours can't be told apart, or null if they can. */
function tooAlike(x: string, y: string): string | null {
  const dL = Math.abs(oklchLightness(x) - oklchLightness(y));
  const dE = deltaE2000(x, y);
  return dL >= MIN_LIGHTNESS_STEP || dE >= MIN_DELTA_E ? null : `lightness differs by ${dL.toFixed(3)}, ΔE2000 ${dE.toFixed(1)}`;
}

/**
 * The families: shades of one hue that sit together in the panel. A type
 * added to one of these categories belongs in its list.
 */
const FAMILIES: Record<string, string[]> = {
  "Learning mechanisms": ["learning-mechanism", "auto-associative-learning-mechanism", "kohonen-learning-mechanism", "em-storage-mechanism"],
  Compositions: ["composition", "autodiff-composition", "gru-composition", "em-composition", "parameter-estimation-composition", "composition-function-approximator", "regression-cfa"],
  "Transfer functions": ["identity", "linear", "exponential", "logistic", "tanh", "relu", "gaussian", "gaussian-distort", "binomial-distort", "softmax", "transfer-with-costs", "angle", "hyperspherical-to-cartesian", "dropout", "user-defined-function"],
  "Timer functions": ["linear-timer", "accelerating-timer", "decelerating-timer", "asymptotic-timer"],
  "Integrator functions": ["simple-integrator", "accumulator-integrator", "adaptive-integrator", "dual-adaptive-integrator", "drift-diffusion-integrator", "drift-on-a-sphere-integrator", "ornstein-uhlenbeck-integrator", "leaky-competing-integrator", "fitz-hugh-nagumo-integrator", "interactive-activation-integrator"],
  "Distribution functions": ["normal-dist", "uniform-dist", "exponential-dist", "gamma-dist", "wald-dist", "uniform-to-normal-dist", "drift-diffusion-analytical"],
  "Transform functions": ["linear-combination", "matrix-transform", "reduce", "concatenate", "rearrange", "combine-means", "prediction-error-delta-function"],
  "Objective functions": ["stability", "energy", "entropy", "distance"],
  "Optimization functions": ["gradient-optimization", "grid-search", "gaussian-process", "pec-optimization-function"],
  "Learning functions": ["hebbian", "contrastive-hebbian", "kohonen", "reinforcement", "td-learning", "back-propagation", "bayes-glm", "em-storage"],
  "Memory functions": ["buffer", "content-addressable-memory", "dictionary-memory"],
};

/** Pairs from different families that used to be the very same colour. */
const ONCE_IDENTICAL: [string, string][] = [
  ["lca-mechanism", "matrix-transform"],
  ["kohonen-learning-mechanism", "contrastive-hebbian"],
  ["em-storage-mechanism", "kohonen"],
];

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
    it(`members of a family can be told apart (${name})`, () => {
      const alike: string[] = [];
      const pairs: [string, string, string][] = ONCE_IDENTICAL.map(([a, b]) => [a, b, "once identical"]);
      for (const [family, members] of Object.entries(FAMILIES)) {
        members.forEach((a, i) => members.slice(i + 1).forEach((b) => pairs.push([a, b, family])));
      }
      for (const [a, b, why] of pairs) {
        const x = values.get(`--pnv-type-${a}`), y = values.get(`--pnv-type-${b}`);
        expect(x, `palette.css does not define --pnv-type-${a}`).toBeTruthy();
        expect(y, `palette.css does not define --pnv-type-${b}`).toBeTruthy();
        const reason = tooAlike(x!, y!);
        if (reason) alike.push(`${why}: ${a} ${x} and ${b} ${y}: ${reason}`);
      }
      expect(alike, "spread the family's shades further apart in lightness (keep the hue)").toEqual([]);
    });
  }
});
