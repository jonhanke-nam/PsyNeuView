/**
 * The panel-edge handle (#418): its ARIA, its arrow, its keys, and how it
 * tells a click on the tab from a drag of the line. The behaviour in a real
 * browser is e2e/expand-collapse-standard.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DRAG_THRESHOLD_PX,
  KEY_STEP_LARGE_PX,
  KEY_STEP_PX,
  PanelHandle,
  PressTracker,
  arrowDirection,
  clearTabOffset,
  separatorKeyAction,
  type PanelHandleProps,
} from "./PanelHandle";
import { DisclosureArrow, DisclosureDetails } from "./Disclosure";

const resize = {
  valueNow: 25,
  valueMin: 14,
  valueMax: 79,
  onDragStart: () => {},
  onDragMove: () => {},
  onDragEnd: () => {},
  onStep: () => {},
};

function render(props: Partial<PanelHandleProps> = {}) {
  return renderToStaticMarkup(
    createElement(PanelHandle, {
      orientation: "vertical",
      foldToward: "left",
      expanded: true,
      onToggle: () => {},
      controls: "pane-code",
      collapseLabel: "Collapse the code editor",
      expandLabel: "Show the code editor",
      resizeLabel: "Resize the code editor",
      resize,
      ...props,
    }),
  );
}

describe("PanelHandle markup", () => {
  it("is a focusable separator with its value, and a separate tab button", () => {
    const html = render();
    expect(html).toMatch(/role="separator"/);
    expect(html).toMatch(/tabindex="0"/);
    expect(html).toMatch(/aria-orientation="vertical"/);
    expect(html).toMatch(/aria-valuenow="25"/);
    expect(html).toMatch(/aria-valuemin="14"/);
    expect(html).toMatch(/aria-valuemax="79"/);
    expect(html).toMatch(/aria-label="Resize the code editor"/);
    // The tab is a sibling of the separator, not inside it: a separator's
    // children are presentational and would hide the button.
    expect(html).toMatch(/<div role="separator"[^>]*><\/div><button/);
    expect(html).toMatch(/<button type="button" class="pnv-handle__tab"[^>]*aria-expanded="true"[^>]*aria-controls="pane-code"/);
    expect(html).toMatch(/aria-label="Collapse the code editor"/);
  });

  it("collapsed: the tab says so, names the other action, and its arrow points into the window", () => {
    const html = render({ expanded: false });
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/aria-label="Show the code editor"/);
    expect(html).toMatch(/data-direction="right"/);
  });

  it("collapsed, the separator stays focusable (Enter restores), its value 0, and the line inert", () => {
    const html = render({ expanded: false });
    expect(html).toMatch(/role="separator" tabindex="0"/);
    expect(html).toMatch(/aria-valuenow="0"/);
    expect(html).not.toMatch(/pnv-handle--resizable/);
  });

  it("open: the arrow points to the edge the pane folds into", () => {
    expect(render()).toMatch(/data-direction="left"/);
    expect(render({ orientation: "horizontal", foldToward: "down" })).toMatch(/data-direction="down"/);
  });

  it("without resize, the line is decorative and only the tab acts", () => {
    const html = render({ resize: undefined });
    expect(html).not.toMatch(/role="separator"/);
    expect(html).toMatch(/aria-hidden="true" class="pnv-handle__line"/);
    expect(html).toMatch(/aria-expanded="true"/);
  });

  it("puts the tab at the top of a vertical edge and the right end of a horizontal one", () => {
    expect(render()).toMatch(/pnv-handle--tab-start/);
    expect(render({ orientation: "horizontal", foldToward: "down" })).toMatch(/pnv-handle--tab-end/);
  });
});

describe("arrowDirection", () => {
  it("points the way the content will move", () => {
    expect(arrowDirection("left", true)).toBe("left");
    expect(arrowDirection("left", false)).toBe("right");
    expect(arrowDirection("down", true)).toBe("down");
    expect(arrowDirection("down", false)).toBe("up");
  });
});

describe("separatorKeyAction", () => {
  it("Enter collapses or restores", () => {
    expect(separatorKeyAction("Enter", false, "vertical")).toBe("toggle");
    expect(separatorKeyAction("Enter", false, "horizontal")).toBe("toggle");
  });
  it("arrow keys along the axis resize, Shift for a bigger step", () => {
    expect(separatorKeyAction("ArrowLeft", false, "vertical")).toBe(-KEY_STEP_PX);
    expect(separatorKeyAction("ArrowRight", true, "vertical")).toBe(KEY_STEP_LARGE_PX);
    expect(separatorKeyAction("ArrowUp", false, "horizontal")).toBe(-KEY_STEP_PX);
    expect(separatorKeyAction("ArrowDown", false, "horizontal")).toBe(KEY_STEP_PX);
  });
  it("arrow keys across the axis do nothing", () => {
    expect(separatorKeyAction("ArrowUp", false, "vertical")).toBeNull();
    expect(separatorKeyAction("ArrowLeft", false, "horizontal")).toBeNull();
    expect(separatorKeyAction("a", false, "vertical")).toBeNull();
  });
  it("Home and End go to the limits", () => {
    expect(separatorKeyAction("Home", false, "vertical")).toBeLessThan(-10000);
    expect(separatorKeyAction("End", false, "vertical")).toBeGreaterThan(10000);
  });
});

describe("PressTracker tells a click from a drag", () => {
  it("a press that barely moves is a click", () => {
    const t = new PressTracker(true);
    t.down(100, 100, 1);
    expect(t.move(100 + DRAG_THRESHOLD_PX - 1, 140, 1)).toBeNull(); // movement across the axis doesn't count
    expect(t.up(1)).toEqual({ wasDrag: false });
  });
  it("a press that moves the threshold along the axis is a drag, reported from where it began", () => {
    const t = new PressTracker(false);
    t.down(50, 200, 7);
    expect(t.move(50, 200 + DRAG_THRESHOLD_PX, 7)).toEqual({ delta: DRAG_THRESHOLD_PX, began: true });
    expect(t.move(50, 260, 7)).toEqual({ delta: 60, began: false });
    expect(t.up(7)).toEqual({ wasDrag: true });
  });
  it("ignores another pointer, and a move with no press", () => {
    const t = new PressTracker(true);
    expect(t.move(10, 10, 1)).toBeNull();
    t.down(0, 0, 1);
    expect(t.move(50, 0, 2)).toBeNull();
    expect(t.up(2)).toBeNull();
    expect(t.up(1)).toEqual({ wasDrag: false });
  });
});

describe("row arrows", () => {
  it("DisclosureArrow is one chevron, turned when open", () => {
    const closed = renderToStaticMarkup(createElement(DisclosureArrow, { open: false }));
    const open = renderToStaticMarkup(createElement(DisclosureArrow, { open: true }));
    expect(closed).toMatch(/data-open="false"/);
    expect(open).toMatch(/data-open="true"/);
    expect(closed).toMatch(/aria-hidden="true"/);
    expect(closed).toMatch(/data-direction="right"/);
  });
  it("DisclosureDetails puts aria-expanded on its summary", () => {
    const html = renderToStaticMarkup(
      createElement(DisclosureDetails, { summary: "Inherited (3)", defaultOpen: true, children: "x" }),
    );
    expect(html).toMatch(/<details open=""/);
    expect(html).toMatch(/<summary aria-expanded="true" class="pnv-disclosure-summary"/);
  });
});

describe("clearTabOffset moves a collapsed tab clear of the controls beside it", () => {
  // A toolbar button from y 4 to 30 and a strip icon from y 36 to 68, both reaching x 12.
  const controls = [
    { x0: 12, x1: 40, y0: 4, y1: 30 },
    { x0: 8, x1: 40, y0: 36, y1: 68 },
  ];
  const at = (x: number, y: number) => controls.some((c) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
  it("goes below them when its hit area would cover one", () => {
    const o = clearTabOffset(0, 600, -5, 19, 36, 8, at)!;
    expect(o).toBeGreaterThan(68);
    for (let y = o; y <= o + 36; y++) for (const x of [-4, 7, 18]) expect(at(x, y)).toBe(false);
  });
  it("stays where it is when nothing is there", () => {
    expect(clearTabOffset(0, 600, -5, 19, 36, 8, () => false)).toBe(8);
  });
  it("gives up when the whole edge is covered", () => {
    expect(clearTabOffset(0, 200, -5, 19, 36, 8, () => true)).toBeNull();
  });
});
