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
  GRAPH_CURSOR_VAR,
  GRAPH_GRABBING_CURSOR_VAR,
  GRAPH_POINT_CURSOR_VAR,
  GRAPH_POINT_PRESSED_CURSOR_VAR,
  GRAPH_POINTERS,
  GRAPH_PRESSED_CURSOR_VAR,
  centreHotspot,
  controlPointPointer,
  graphCursorVars,
  graphPointerClass,
  handSvg,
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

  describe("the hand at every size, and the closed hand for a drag (#40)", () => {
    it("is our own image at each size, with the hot spot on the palm at the centre", () => {
      for (const { id, px } of POINTER_SIZES) {
        const open = pointerCursorImage("hand", id);
        expect(open.px).toBe(px);
        expect(open.hotspot).toBe(px / 2);
        const svg = decodeURIComponent(open.url.slice("data:image/svg+xml,".length));
        expect(svg).toContain(`width="${px}" height="${px}"`);
        expect(svg).toBe(handSvg(px));
        expect(open.url).not.toContain("#");
        expect(pointerCursorValue("hand", id)).toBe(`url("${open.url}") ${px / 2} ${px / 2}, grab`);
      }
      // Distinct sizes give distinct hands: the setting changes something.
      expect(new Set(POINTER_SIZES.map((s) => pointerCursorValue("hand", s.id))).size).toBe(POINTER_SIZES.length);
    });

    it("closes while held, with the system grabbing hand as the fallback", () => {
      expect(handSvg(24, true)).not.toBe(handSvg(24));
      const closed = pointerCursorImage("hand", "large", true);
      expect(decodeURIComponent(closed.url.slice("data:image/svg+xml,".length))).toBe(handSvg(48, true));
      expect(pointerCursorValue("hand", "large", true)).toBe(`url("${closed.url}") 24 24, grabbing`);
      expect(pointerCursorValue("hand", "large", true)).not.toBe(pointerCursorValue("hand", "large"));
    });
  });

  describe("a control point shows the precise pointer, never the hand (#40)", () => {
    it("maps Hand to the arrow and leaves the others as they are", () => {
      expect(controlPointPointer("hand")).toBe("arrow");
      expect(controlPointPointer("arrow")).toBe("arrow");
      expect(controlPointPointer("crosshair")).toBe("crosshair");
      expect(controlPointPointer("circle")).toBe("circle");
    });

    it("sets every variable the rules read, for every pointer at every size", () => {
      for (const { id: pointer } of GRAPH_POINTERS) {
        for (const { id: size } of POINTER_SIZES) {
          const vars = graphCursorVars(pointer, size);
          expect(vars[GRAPH_CURSOR_VAR]).toBe(pointerCursorValue(pointer, size));
          expect(vars[GRAPH_PRESSED_CURSOR_VAR]).toBe(pointerCursorValue(pointer, size, true));
          // The drag's closed hand is the same under every pointer, at this size.
          expect(vars[GRAPH_GRABBING_CURSOR_VAR]).toBe(pointerCursorValue("hand", size, true));
          expect(vars[GRAPH_GRABBING_CURSOR_VAR].endsWith(", grabbing")).toBe(true);
          // Over a control point: the arrow for the arrow and the hand, else the pointer itself.
          const point = controlPointPointer(pointer);
          expect(vars[GRAPH_POINT_CURSOR_VAR]).toBe(pointerCursorValue(point, size));
          expect(vars[GRAPH_POINT_PRESSED_CURSOR_VAR]).toBe(pointerCursorValue(point, size, true));
          expect(vars[GRAPH_POINT_CURSOR_VAR].endsWith(", grab")).toBe(false);
        }
      }
      expect(graphCursorVars("hand", "medium")[GRAPH_POINT_CURSOR_VAR]).toBe(arrowCursorValue("medium"));
    });
  });
});
