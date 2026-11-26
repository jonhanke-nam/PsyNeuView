/**
 * The faintest text tokens still read at WCAG AA. (#412)
 *
 * `--pnv-text-hint` and `--pnv-text-faint` are the lightest greys in the
 * palette, used for labels, counts and hints (the Run panel's "Trial 1",
 * "· loaded in", the model name). Text needs 4.5:1 (WCAG 2.1, 1.4.3) against
 * what it sits on. Each token is checked against the surfaces it is drawn on,
 * found by scanning the Run panel, the trial card, the Components list and
 * Settings: the panel, a card or toolbar, the canvas or a dialog, and the
 * warning and trace tints. Hint also sits on a selected row and a menu's
 * heading band.
 *
 * Rows of the current trial card not reached yet at the trace step take
 * `--pnv-step-pending-text`, checked on the card's selection fill in every
 * theme palette.css defines (the dark block defines a selection set).
 *
 * The values are also the lightest that pass, so they stay as secondary as
 * AA allows: one shade lighter fails somewhere.
 *
 * Coloured text (#421): `--pnv-primary-text` (an input's name in a trial
 * card, the chosen half of the run/trial switch, the open inspector tab) and
 * `--pnv-warning-text` (amber notes and Δ lines in the Run panel) read at AA
 * on every surface they are drawn on, including the current trial card's
 * selection fill and the active step's deeper row. White reads at AA on
 * `--pnv-warning-badge` (the warning count). Each is the lightest shade of
 * its hue that passes, and the colours they stand in for (the primary blue,
 * the amber, the selection fill) are unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Read from disk: a ?raw import of a stylesheet comes back empty under vitest.
const paletteCss = readFileSync(fileURLToPath(new URL("./palette.css", import.meta.url)), "utf8");

const AA = 4.5;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** One step lighter (or, on a dark surface, darker) in every channel. */
function oneShadeFainter(hex: string, darkSurface: boolean): string {
  return "#" + hexToRgb(hex).map((v) => (darkSurface ? v - 1 : v + 1).toString(16).padStart(2, "0")).join("");
}

function tokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--pnv-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) out.set(m[1], m[2]);
  return out;
}

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
const darkValues = dark ? new Map([...light, ...tokens(dark)]) : null;

/** `color-mix(in srgb, var(--a) P%, var(--b))`, resolved per channel as the browser does. */
function resolveMix(values: Map<string, string>, token: string): string {
  const m = css.match(new RegExp(`${token}:\\s*color-mix\\(in srgb,\\s*var\\((--[a-z0-9-]+)\\)\\s*(\\d+)%,\\s*var\\((--[a-z0-9-]+)\\)\\)`));
  if (!m) throw new Error(`${token} is not a two-colour color-mix`);
  const [a, b, t] = [hexToRgb(values.get(m[1])!), hexToRgb(values.get(m[3])!), Number(m[2]) / 100];
  return "#" + a.map((v, i) => Math.round(v * t + b[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}
// The active step's row in the current trial card (--pnv-step-active-row is
// the selection fill one shade deeper).
light.set("--pnv-selection-fill-strong", resolveMix(light, "--pnv-selection-fill-strong"));

const FAINT_ON = ["--pnv-surface", "--pnv-surface-muted", "--pnv-surface-sunken", "--pnv-warning-tint", "--pnv-trace-tint"];
const HINT_ON = [...FAINT_ON, "--pnv-selection-fill", "--pnv-surface-band"];

function check(values: Map<string, string>, token: string, surfaces: string[]) {
  const colour = values.get(token)!;
  expect(colour, `${token} is a hex colour`).toBeTruthy();
  const ratios = surfaces.map((s) => {
    const bg = values.get(s)!;
    expect(bg, `${s} is a hex colour`).toBeTruthy();
    return { s, bg, ratio: contrast(colour, bg) };
  });
  const low = ratios.filter((r) => r.ratio < AA).map((r) => `${token} ${colour} is ${r.ratio.toFixed(2)}:1 on ${r.s} ${r.bg}`);
  expect(low, "below WCAG AA").toEqual([]);
  return ratios;
}

describe("text contrast (#412)", () => {
  it("--pnv-text-faint reads at AA on every surface it is drawn on", () => {
    check(light, "--pnv-text-faint", FAINT_ON);
  });

  it("--pnv-text-hint reads at AA on every surface it is drawn on", () => {
    check(light, "--pnv-text-hint", HINT_ON);
  });

  it("hint is no lighter than faint, so the order of the greys holds", () => {
    const l = (t: string) => luminance(hexToRgb(light.get(t)!));
    expect(l("--pnv-text-hint")).toBeLessThanOrEqual(l("--pnv-text-faint"));
    expect(l("--pnv-text-muted")).toBeLessThanOrEqual(l("--pnv-text-hint"));
  });

  it("faint and hint are as light as AA allows (one shade fainter fails)", () => {
    for (const [token, surfaces] of [["--pnv-text-faint", FAINT_ON], ["--pnv-text-hint", HINT_ON]] as const) {
      const fainter = oneShadeFainter(light.get(token)!, false);
      const worst = Math.min(...surfaces.map((s) => contrast(fainter, light.get(s)!)));
      expect(worst, `${token}: ${fainter} would still pass, so it could be lighter`).toBeLessThan(AA);
    }
  });

  it("not-yet-reached rows read at AA on the current trial card (light)", () => {
    check(light, "--pnv-step-pending-text", ["--pnv-selection-fill"]);
  });

  it.runIf(darkValues)("not-yet-reached rows read at AA on the current trial card (dark)", () => {
    check(darkValues!, "--pnv-step-pending-text", ["--pnv-selection-fill"]);
    const fainter = oneShadeFainter(darkValues!.get("--pnv-step-pending-text")!, true);
    expect(contrast(fainter, darkValues!.get("--pnv-selection-fill")!)).toBeLessThan(AA);
  });

  it("not-yet-reached rows use a colour, not an opacity", () => {
    expect(paletteCss).not.toMatch(/--pnv-step-pending-opacity/);
  });
});

// Where each coloured text is drawn (#421).
const CARD_SURFACES = ["--pnv-surface-muted", "--pnv-surface-sunken", "--pnv-selection-fill", "--pnv-selection-fill-strong"];
const PRIMARY_TEXT_ON = CARD_SURFACES;
const WARNING_TEXT_ON = ["--pnv-warning-tint", "--pnv-surface", ...CARD_SURFACES];

describe("coloured text contrast (#421)", () => {
  it("the primary blue as text reads at AA on the panel, a card, the selection fill and the active row", () => {
    check(light, "--pnv-primary-text", PRIMARY_TEXT_ON);
  });

  it("amber text reads at AA on its tint and on every surface in the Run panel", () => {
    check(light, "--pnv-warning-text", WARNING_TEXT_ON);
  });

  it("white reads at AA on the amber badge", () => {
    check(light, "--pnv-on-primary", ["--pnv-warning-badge"]);
  });

  it("each is the lightest that passes (one shade lighter fails)", () => {
    for (const [token, surfaces] of [["--pnv-primary-text", PRIMARY_TEXT_ON], ["--pnv-warning-text", WARNING_TEXT_ON]] as const) {
      const lighter = oneShadeFainter(light.get(token)!, false);
      const worst = Math.min(...surfaces.map((s) => contrast(lighter, light.get(s)!)));
      expect(worst, `${token}: ${lighter} would still pass, so it could be lighter`).toBeLessThan(AA);
    }
    const lighterBadge = oneShadeFainter(light.get("--pnv-warning-badge")!, false);
    expect(contrast(light.get("--pnv-on-primary")!, lighterBadge), "--pnv-warning-badge could be lighter").toBeLessThan(AA);
  });

  it("the colours they stand in for are unchanged: the primary blue, the amber, the selection fill", () => {
    expect(light.get("--pnv-primary")).toBe("#1a73e8");
    expect(light.get("--pnv-selection-border")).toBe("#1a73e8");
    expect(light.get("--pnv-selection-fill")).toBe("#e8f0fe");
    expect(light.get("--pnv-warning")).toBe("#b26a00");
  });

  it("the text shades keep their colour's hue", () => {
    const hue = (hex: string) => {
      const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    expect(Math.abs(hue(light.get("--pnv-primary-text")!) - hue(light.get("--pnv-primary")!))).toBeLessThan(2);
    expect(Math.abs(hue(light.get("--pnv-warning-text")!) - hue(light.get("--pnv-warning")!))).toBeLessThan(2);
    expect(Math.abs(hue(light.get("--pnv-warning-badge")!) - hue(light.get("--pnv-warning")!))).toBeLessThan(2);
  });
});
