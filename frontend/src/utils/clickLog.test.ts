/**
 * The one click listener (#177): which controls count, what label is
 * recorded, where the control is, and that typed text never is. The suite
 * runs on node, so the elements are small fakes with `closest`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { activityEntries, clearActivity } from "./activityLog";
import { clickLabel, describeClick, installClickLogging, recordClick } from "./clickLog";

interface FakeElement {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  parent: FakeElement | null;
  closest: (selector: string) => FakeElement | null;
  getAttribute: (name: string) => string | null;
  textContent: string;
}

/** `selector` is matched the way `clickLog` uses it: by tag, `[role='x']`, `a[href]` or `[data-x]`. */
function matches(el: FakeElement, selector: string): boolean {
  return selector.split(",").some((part) => {
    const s = part.trim();
    const m = s.match(/^([a-z]*)(?:\[([a-z-]+)(?:='([^']*)')?\])?$/);
    if (!m) return false;
    const [, tag, attr, value] = m;
    if (tag && el.tag !== tag) return false;
    if (attr && !(attr in el.attrs)) return false;
    if (value !== undefined && el.attrs[attr] !== value) return false;
    return true;
  });
}

function el(tag: string, attrs: Record<string, string> = {}, text = "", parent: FakeElement | null = null): FakeElement {
  const e: FakeElement = {
    tag,
    attrs,
    text,
    parent,
    textContent: text,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    closest: (selector) => {
      for (let cur: FakeElement | null = e; cur; cur = cur.parent) if (matches(cur, selector)) return cur;
      return null;
    },
  };
  return e;
}

beforeEach(() => clearActivity());

describe("what a click is", () => {
  it("is a menu item, named with its menu", () => {
    const list = el("div", { role: "menu", "data-pnv-menu": "Open" });
    const item = el("button", {}, "  Open from\n path…  ", list);
    const span = el("span", {}, "path…", item);
    expect(describeClick(span as unknown as Element)).toEqual({
      kind: "menu",
      text: "Open › Open from path…",
      where: "Open",
      label: "Open from path…",
    });
  });

  it("is a button in an area, or a button on its own", () => {
    const toolbar = el("div", { "data-pnv-where": "Toolbar" });
    expect(describeClick(el("button", { "data-testid": "toolbar-save" }, "Save", toolbar) as unknown as Element)).toEqual(
      expect.objectContaining({ kind: "click", text: "Toolbar › Save" }),
    );
    expect(describeClick(el("button", {}, "Run Model") as unknown as Element)).toEqual(
      expect.objectContaining({ kind: "click", text: "Run Model", where: null }),
    );
    expect(describeClick(el("button", { role: "tab" }, "Run") as unknown as Element)?.label).toBe("Run");
    expect(describeClick(el("a", { href: "#" }, "Docs") as unknown as Element)?.label).toBe("Docs");
  });

  it("isn't a click on a field, the canvas or text: typed text is never recorded", () => {
    expect(describeClick(el("input", { type: "text", value: "secret words" }))).toBeNull();
    expect(describeClick(el("textarea", {}, "def model(): …"))).toBeNull();
    expect(describeClick(el("div", {}, "a paragraph of the model's code"))).toBeNull();
    expect(describeClick(null)).toBeNull();
  });

  it("names a symbol-only button by its tooltip, and prefers an aria-label", () => {
    expect(clickLabel(el("button", { title: "Undo: Moved node a (⌘Z)" }, "↩") as unknown as Element)).toBe("Undo: Moved node a (⌘Z)");
    expect(clickLabel(el("button", { "aria-label": "Settings", title: "Settings (⌘,)" }, "⚙") as unknown as Element)).toBe("Settings");
    expect(clickLabel(el("button", {}, "×") as unknown as Element)).toBe("×");
    expect(clickLabel(el("button", {}, "x".repeat(200)) as unknown as Element)).toHaveLength(80);
  });

  it("the nearest mark wins: a menu inside the toolbar is the menu", () => {
    const toolbar = el("div", { "data-pnv-where": "Toolbar" });
    const list = el("div", { "data-pnv-menu": "Layout" }, "", toolbar);
    expect(describeClick(el("button", {}, "Fit", list) as unknown as Element)?.text).toBe("Layout › Fit");
  });
});

describe("recording", () => {
  it("records a control's click and ignores the rest", () => {
    const tabs = el("div", { "data-pnv-where": "Bottom tabs" });
    recordClick({ target: el("button", {}, "Run", tabs) as unknown as Element });
    recordClick({ target: el("div", {}, "nothing") as unknown as Element });
    expect(activityEntries().map((e) => [e.kind, e.text, e.data])).toEqual([["click", "Bottom tabs › Run", { where: "Bottom tabs" }]]);
  });

  it("installs one capture-phase listener and uninstalls it", () => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const root = {
      addEventListener: (type: string, fn: unknown, capture: boolean) => added.push([type, fn, capture]),
      removeEventListener: (type: string, fn: unknown, capture: boolean) => removed.push([type, fn, capture]),
    };
    const uninstall = installClickLogging(root as unknown as Document);
    expect(added).toEqual([["click", expect.any(Function), true]]);
    (added[0] as [string, (e: unknown) => void, boolean])[1]({ target: el("button", {}, "Save") });
    expect(activityEntries().map((e) => e.text)).toEqual(["Save"]);
    uninstall();
    expect(removed).toEqual(added);
  });
});
