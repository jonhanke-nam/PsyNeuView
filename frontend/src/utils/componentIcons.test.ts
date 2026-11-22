/**
 * Every Components panel item has an icon (#283), and the icon files are
 * safe to put in the page as markup.
 *
 * The manifest (assets/component-icons/icons.yaml) maps each palette item and
 * each top-level category to an SVG and says where the drawing came from.
 */
import { describe, expect, it } from "vitest";
import { ALL_PNL_DEFS, PNL_TAXONOMY_TREE } from "@/constants/pnlTypes";
import { ICON_MANIFEST, ICON_SVGS, iconForCategory, iconForType } from "./componentIcons";
import { paletteTokens } from "../../scripts/style-report.mjs";

const entries = () => [
  ...Object.entries(ICON_MANIFEST.categories).map(([k, e]) => [`category ${k}`, e] as const),
  ...Object.entries(ICON_MANIFEST.items).map(([k, e]) => [k, e] as const),
];

describe("Components panel icons (#283)", () => {
  it("every palette item has an icon", () => {
    const missing = ALL_PNL_DEFS.filter((d) => !iconForType(d.type)).map((d) => d.type);
    expect(missing).toEqual([]);
  });

  it("every top-level category has an icon for the folded strip", () => {
    const missing = PNL_TAXONOMY_TREE.filter((n) => !iconForCategory(n.id)).map((n) => n.id);
    expect(missing).toEqual([]);
  });

  it("each palette item has its own drawing", () => {
    const byFile = new Map<string, string[]>();
    for (const [type, e] of Object.entries(ICON_MANIFEST.items)) {
      byFile.set(e.file, [...(byFile.get(e.file) ?? []), type]);
    }
    const shared = [...byFile.entries()].filter(([, types]) => types.length > 1);
    expect(shared).toEqual([]);
  });

  it("lists no type the palette doesn't have, and no file that isn't there", () => {
    const types = new Set(ALL_PNL_DEFS.map((d) => d.type));
    expect(Object.keys(ICON_MANIFEST.items).filter((t) => !types.has(t))).toEqual([]);
    const ids = new Set(PNL_TAXONOMY_TREE.map((n) => n.id));
    expect(Object.keys(ICON_MANIFEST.categories).filter((c) => !ids.has(c))).toEqual([]);
    expect(entries().filter(([, e]) => !ICON_SVGS[e.file]).map(([k]) => k)).toEqual([]);
  });

  it("every icon file is in the manifest", () => {
    const used = new Set(entries().map(([, e]) => e.file));
    expect(Object.keys(ICON_SVGS).filter((f) => !used.has(f))).toEqual([]);
  });

  it("says where each drawing came from", () => {
    for (const [key, e] of entries()) {
      expect(["metacell", "original"], key).toContain(e.source);
      if (e.source === "metacell") expect(e.metacell_path, key).toMatch(/^src\/client\/assets\/svg\/.+\.svg$/);
      expect(e.meaning, key).toBeTruthy();
    }
  });

  it("a tint is a palette token", () => {
    const defined = paletteTokens();
    for (const [key, e] of entries()) {
      if (!e.tint) continue;
      const token = e.tint.match(/^var\((--pnv-[a-z0-9-]+)\)$/)?.[1];
      expect(token, key).toBeTruthy();
      expect(defined.has(token!), `${key}: ${token}`).toBe(true);
    }
  });

  it("the input and output ports keep show_graph's green and red", () => {
    expect(iconForType("InputPort")?.tint).toBe("var(--pnv-role-input-text)");
    expect(iconForType("OutputPort")?.tint).toBe("var(--pnv-role-output-text)");
  });

  it("icon files are plain drawings in currentColor: no scripts, links, handlers or fixed colours", () => {
    for (const [file, svg] of Object.entries(ICON_SVGS)) {
      expect(svg, file).toMatch(/^<svg [^>]*viewBox="0 0 20 20"/);
      expect(svg, file).not.toMatch(/<script|<foreignObject|<image|<metadata|<style|href|url\(|\son[a-z]+\s*=/i);
      expect(svg, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|\b(white|black)\b/i);
      expect(svg, file).toContain("currentColor");
    }
  });
});
