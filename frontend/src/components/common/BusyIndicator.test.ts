/**
 * The busy indicator's styles (#169): every one takes the same space, and
 * everything that moves stands still under reduced motion.
 *
 * A render to markup, not a browser: the size is checked on what each style
 * draws, and the reduced-motion rule is checked at its source (index.css),
 * where one rule covers every element that carries the animation class.
 */
import { readFileSync } from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BUSY_STYLES } from "@/stores/busyStore";
import { BusyGraphic } from "./BusyIndicator";

// Node has no localStorage; the store reads it when it loads.
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });

const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

/** The classes index.css animates: `.pnv-busy-turn { animation: … }`. */
const animatedClasses = [...css.matchAll(/\.(pnv-busy-[a-z-]+)\s*\{[^}]*\banimation:\s*(?!none)/g)].map((m) => m[1]);

/** Every class attribute in the markup, split into classes. */
const classLists = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));

const render = (style: (typeof BUSY_STYLES)[number]["style"], size: number) =>
  renderToStaticMarkup(createElement(BusyGraphic, { style, size }));

describe("busy indicator styles (#169)", () => {
  it("every style draws at the size it is given, in the toolbar and over the graph", () => {
    for (const { style } of BUSY_STYLES) {
      for (const size of [20, 44]) {
        const markup = render(style, size);
        if (style === "text") {
          // Nothing to see, but the space is kept so the toolbar never moves.
          expect(markup, style).toMatch(new RegExp(`width:${size}px;height:${size}px`));
        } else {
          expect(markup, style).toMatch(new RegExp(`^<svg [^>]*width="${size}" height="${size}" viewBox="0 0 24 24"`));
        }
      }
    }
  });

  it("every style but Text only moves, and only through classes index.css animates", () => {
    expect(animatedClasses).toContain("pnv-busy-wheel");
    for (const { style } of BUSY_STYLES) {
      const moving = classLists(render(style, 20)).filter((c) => c.some((name) => animatedClasses.includes(name)));
      if (style === "text") expect(moving, style).toEqual([]);
      else expect(moving.length, style).toBeGreaterThan(0);
    }
  });

  it("everything that moves carries pnv-busy-anim, which reduced motion stops", () => {
    for (const { style } of BUSY_STYLES) {
      for (const classes of classLists(render(style, 20))) {
        if (classes.some((name) => animatedClasses.includes(name))) {
          expect(classes, `${style}: ${classes.join(" ")}`).toContain("pnv-busy-anim");
        }
      }
    }
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.pnv-busy-anim\s*\{\s*animation:\s*none;?\s*\}/);
    expect(reduced, "index.css: .pnv-busy-anim { animation: none } under reduced motion").not.toBeNull();
  });
});
