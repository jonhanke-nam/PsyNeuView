import { describe, expect, it } from "vitest";
import {
  ARROW_TIP,
  ARROW_VIEWBOX,
  DEFAULT_GRAPH_POINTER,
  DEFAULT_POINTER_SIZE,
  MAX_CURSOR_PX,
  POINTER_SIZES,
  arrowCursorImage,
  arrowCursorValue,
  arrowHotspot,
  arrowSvg,
  CENTRE,
  GRAPH_POINTERS,
  centreHotspot,
  graphPointerClass,
  isPrecisePointer,
  pointerCursorImage,
  pointerCursorValue,
  preciseSvg,
  isGraphPointer,
  isPointerSize,
} from "./graphCursor";

describe("graph-view pointer (#1301)", () => {
  it("defaults to the arrow at Medium", () => {
    expect(DEFAULT_GRAPH_POINTER).toBe("arrow");
    expect(DEFAULT_POINTER_SIZE).toBe("medium");
    expect(isGraphPointer("arrow") && isGraphPointer("hand")).toBe(true);
    expect(isGraphPointer("pointer")).toBe(false);
    expect(isPointerSize("xlarge")).toBe(true);
    expect(isPointerSize("huge")).toBe(false);
  });

  it("offers four sizes, each strictly larger, all within the browser's cap", () => {
    expect(POINTER_SIZES.map((s) => s.id)).toEqual(["small", "medium", "large", "xlarge"]);
    expect(POINTER_SIZES.map((s) => s.label)).toEqual(["Small", "Medium", "Large", "Extra large"]);
    const px = POINTER_SIZES.map((s) => s.px);
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeGreaterThan(px[i - 1]);
    for (const p of px) expect(p).toBeLessThanOrEqual(MAX_CURSOR_PX);
  });

  it("maps each size to an image of that size with the hot spot on the arrow's tip", () => {
    for (const { id, px } of POINTER_SIZES) {
      const image = arrowCursorImage(id);
      expect(image.px).toBe(px);
      expect(image.url.startsWith("data:image/svg+xml,")).toBe(true);
      const svg = decodeURIComponent(image.url.slice("data:image/svg+xml,".length));
      expect(svg).toContain(`width="${px}" height="${px}"`);
      // The tip is at (ARROW_TIP, ARROW_TIP) in the view box; the hot spot is
      // that point scaled to the image, never outside it.
      const expected = Math.round((ARROW_TIP * px) / ARROW_VIEWBOX);
      expect(image.hotspot).toBe(Math.min(px - 1, Math.max(0, expected)));
      expect(image.hotspot).toBeGreaterThanOrEqual(0);
      expect(image.hotspot).toBeLessThan(px);
    }
    expect(arrowHotspot(16)).toBe(1);
    expect(arrowHotspot(24)).toBe(1);
    expect(arrowHotspot(48)).toBe(2);
    expect(arrowHotspot(96)).toBe(4);
  });

  it("builds a cursor value that names the image, its hot spot, and the system arrow as the fallback", () => {
    const value = arrowCursorValue("large");
    const { url, hotspot } = arrowCursorImage("large");
    expect(value).toBe(`url("${url}") ${hotspot} ${hotspot}, default`);
    // Distinct sizes give distinct cursors: the setting changes something.
    expect(new Set(POINTER_SIZES.map((s) => arrowCursorValue(s.id))).size).toBe(POINTER_SIZES.length);
  });

  it("draws the arrow with its tip where the hot spot says", () => {
    const svg = arrowSvg(24);
    expect(svg).toContain(`viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}"`);
    expect(svg).toContain(`d="M${ARROW_TIP} ${ARROW_TIP} `);
    // A `data:` URL can't carry a raw `#`; the fill and stroke are encoded.
    expect(arrowCursorImage("medium").url).not.toContain("#");
  });

  it("names the class index.css keys on", () => {
    expect(graphPointerClass("arrow")).toBe("graph-pointer-image");
    expect(graphPointerClass("crosshair")).toBe("graph-pointer-image");
    expect(graphPointerClass("circle")).toBe("graph-pointer-image");
    expect(graphPointerClass("hand")).toBe("graph-pointer-hand");
  });

  describe("the crosshair and the circle (#40)", () => {
    it("are offered after the arrow and the hand, which stay as they were", () => {
      expect(GRAPH_POINTERS.map((p) => p.id)).toEqual(["arrow", "hand", "crosshair", "circle"]);
      expect(isGraphPointer("crosshair") && isGraphPointer("circle")).toBe(true);
      expect(isPrecisePointer("crosshair") && isPrecisePointer("circle")).toBe(true);
      expect(isPrecisePointer("arrow") || isPrecisePointer("hand")).toBe(false);
      expect(pointerCursorValue("arrow", "large")).toBe(arrowCursorValue("large"));
      expect(pointerCursorValue("arrow", "large", true)).toBe(arrowCursorValue("large"));
    });

    it("put the hot spot exactly on the centre at every size", () => {
      expect(CENTRE * 2).toBe(ARROW_VIEWBOX);
      expect([16, 24, 48, 96].map(centreHotspot)).toEqual([8, 12, 24, 48]);
      for (const pointer of ["crosshair", "circle"] as const) {
        for (const { id, px } of POINTER_SIZES) {
          const image = pointerCursorImage(pointer, id);
          expect(image.px).toBe(px);
          expect(image.hotspot).toBe(px / 2);
          expect(pointerCursorValue(pointer, id)).toBe(`url("${image.url}") ${px / 2} ${px / 2}, crosshair`);
          expect(decodeURIComponent(image.url.slice("data:image/svg+xml,".length))).toContain(`width="${px}" height="${px}"`);
          expect(image.url).not.toContain("#");
        }
      }
    });

    it("draw a dot at the centre, and a distinct pressed look", () => {
      for (const pointer of ["crosshair", "circle"] as const) {
        const svg = preciseSvg(pointer, 24);
        expect(svg).toContain(`<circle cx="${CENTRE}" cy="${CENTRE}"`);
        expect(preciseSvg(pointer, 24, true)).not.toBe(svg);
        expect(pointerCursorValue(pointer, "medium", true)).not.toBe(pointerCursorValue(pointer, "medium"));
      }
      expect(preciseSvg("crosshair", 24)).not.toBe(preciseSvg("circle", 24));
    });
  });
});
