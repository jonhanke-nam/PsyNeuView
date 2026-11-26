/**
 * Role colours match PsyNeuLink's show_graph exactly (#306).
 *
 * show_graph is the gold standard for what colour a role is. This table is
 * show_graph's defaults (ShowGraph.__init__'s colour arguments) as Graphviz
 * draws them in show_graph's PDF and PNG, by their X11 values, and this test
 * holds styles/palette.css to it, so a frontend-only change cannot drift.
 *
 * Its partner, backend/tests/test_show_graph_palette.py, reads the defaults
 * from PsyNeuLink itself (CI installs it), so a change upstream fails too.
 * Change this table only when show_graph changes, and palette.css with it.
 *
 * The one exception is the role TEXT tokens (--pnv-role-*-text): show_graph
 * draws no text in a role's colour, and its green, orange and pink are
 * unreadable as text on white, so those stay darker in the same hue. The
 * last test here keeps them to that: never equal to the outline colour they
 * stand in for, and the same hue.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ROLE_TEXT_COLORS, ROLE_TOKENS } from "../constants/pnlTypes";

/** Palette token -> [ShowGraph.__init__ argument, its default name, that name's X11 value]. */
const SHOW_GRAPH: Record<string, [argument: string, name: string, x11: string]> = {
  "--pnv-role-input": ["input_color", "green", "#00ff00"],
  "--pnv-role-output": ["output_color", "red", "#ff0000"],
  "--pnv-role-control": ["control_color", "blue", "#0000ff"],
  "--pnv-role-controller": ["controller_color", "purple", "#a020f0"],
  "--pnv-role-learning": ["learning_color", "orange", "#ffa500"],
  "--pnv-role-probe": ["probe_color", "pink", "#ffc0cb"],
  "--pnv-role-singleton": ["input_and_output_color", "brown", "#a52a2a"],
  "--pnv-role-internal": ["default_node_color", "black", "#000000"],
  "--pnv-role-feedback-sender": ["default_node_color", "black", "#000000"],
  "--pnv-role-cycle": ["default_node_color", "black", "#000000"],
  "--pnv-projection-inactive": ["inactive_projection_color", "red", "#ff0000"],
  // #425: a projection in show_graph's colour: an ordinary one black, a
  // control, controller or learning one in its role's colour.
  "--pnv-projection-mapping": ["default_node_color", "black", "#000000"],
  "--pnv-projection-control": ["control_color", "blue", "#0000ff"],
  "--pnv-projection-controller": ["controller_color", "purple", "#a020f0"],
  "--pnv-projection-learning": ["learning_color", "orange", "#ffa500"],
};

/** Every --pnv-* token in palette.css with its value, six-digit hex where it is a hex. */
function paletteValues(): Map<string, string> {
  const css = readFileSync(path.resolve(__dirname, "palette.css"), "utf8");
  const out = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--pnv-[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    let v = m[2].trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
    out.set(m[1], v);
  }
  return out;
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("role colours match show_graph exactly (#306)", () => {
  const palette = paletteValues();

  it.each(Object.entries(SHOW_GRAPH))("%s is show_graph's %s", (token, [argument, name, x11]) => {
    expect(palette.get(token), `${token} should be show_graph's ${argument}=${name} (${x11}), exactly`).toBe(x11);
  });

  it("covers every role colour the canvas draws", () => {
    // A new role in ROLE_COLORS needs its show_graph colour in the table above.
    for (const token of Object.values(ROLE_TOKENS)) expect(Object.keys(SHOW_GRAPH), token).toContain(token);
  });

  it("text variants are the only exception: darker, same hue", () => {
    for (const [role, v] of Object.entries(ROLE_TEXT_COLORS)) {
      const textToken = v.slice(4, -1);
      const text = palette.get(textToken)!;
      const outline = palette.get(ROLE_TOKENS[role])!;
      expect(text, textToken).toMatch(/^#[0-9a-f]{6}$/);
      expect(text, `${textToken} exists to differ from ${ROLE_TOKENS[role]}`).not.toBe(outline);
      const dh = Math.abs(hue(text) - hue(outline));
      expect(Math.min(dh, 360 - dh), `${textToken} (${text}) should keep the hue of ${outline}`).toBeLessThanOrEqual(20);
    }
  });
});
