/**
 * Dialog focus (#415): in on open, round and round inside a modal dialog on
 * Tab, and back to the opener on close. Driven on a small stand-in for the
 * DOM, as useDismiss.test.ts drives the Escape stack; the real thing is
 * checked in a browser by e2e/dialog-focus.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFocusHistory,
  handleTab,
  openDialogCount,
  openDialogFocus,
  recordFocus,
  type FocusDoc,
  type FocusEl,
  type TabKeyEvent,
} from "./dialogFocus";

/** A stand-in element: a tag, attributes, children, and a shared document. */
class El implements FocusEl {
  children: El[] = [];
  parent: El | null = null;
  attrs: Record<string, string>;
  hidden = false;
  constructor(
    public doc: Doc,
    public tag: string,
    attrs: Record<string, string> = {},
  ) {
    this.attrs = { ...attrs };
  }
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    if (this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
  }
  get isConnected(): boolean {
    let n: El | null = this;
    while (n.parent) n = n.parent;
    return n === this.doc.body;
  }
  focus(): void {
    if (this.isConnected && this.focusable()) this.doc.activeElement = this;
  }
  focusable(): boolean {
    return ["button", "input", "textarea", "a"].includes(this.tag) || "tabindex" in this.attrs;
  }
  contains(other: FocusEl | null): boolean {
    for (let n = other as El | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  /** Just the selectors dialogFocus uses, read loosely. */
  matches(selector: string): boolean {
    if (selector === "[inert], [inert] *") return false;
    if (selector === "[data-autofocus]") return "data-autofocus" in this.attrs;
    if (this.attrs.tabindex === "-1" && selector.includes(':not([tabindex="-1"])')) return false;
    if ("disabled" in this.attrs) return false;
    const type = this.attrs.type ?? "text";
    if (selector.includes("textarea") && this.tag === "textarea") return true;
    if (selector.includes("input") && this.tag === "input") {
      return selector.startsWith("a[href]") || !["checkbox", "radio", "button"].includes(type);
    }
    if (!selector.startsWith("a[href]")) return false;
    return this.tag === "button" || this.tag === "a" || "tabindex" in this.attrs;
  }
  querySelector(selector: string): FocusEl | null {
    return this.descendants().find((d) => d.matches(selector)) ?? null;
  }
  querySelectorAll(selector: string): FocusEl[] {
    return this.descendants().filter((d) => d.matches(selector));
  }
  getClientRects(): { length: number } {
    return { length: this.hidden ? 0 : 1 };
  }
}

class Doc implements FocusDoc {
  body: El;
  activeElement: El | null;
  constructor() {
    this.body = new El(this, "body");
    this.activeElement = this.body;
  }
  el(tag: string, attrs: Record<string, string> = {}): El {
    return new El(this, tag, attrs);
  }
}

function tab(shiftKey = false): TabKeyEvent & { prevented: boolean } {
  const e = {
    key: "Tab",
    shiftKey,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e;
}

const listeners = { add: vi.fn(), remove: vi.fn() };
let doc: Doc;

beforeEach(() => {
  listeners.add.mockClear();
  listeners.remove.mockClear();
  vi.stubGlobal("window", { addEventListener: listeners.add, removeEventListener: listeners.remove });
  clearFocusHistory();
  doc = new Doc();
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(openDialogCount(), "a test left a dialog open").toBe(0);
});

/** Hands the focus back at once, instead of on the next task. */
const now = (fn: () => void) => fn();

/** A page with an opener button, and a modal dialog of × / field / OK. */
function page(opts: { modal?: boolean; field?: boolean } = {}) {
  const opener = doc.el("button");
  const dialog = doc.el("div", { role: "dialog", ...(opts.modal === false ? {} : { "aria-modal": "true" }) });
  const close = doc.el("button");
  const field = doc.el("input");
  const ok = doc.el("button");
  dialog.add(close, ...(opts.field === false ? [] : [field]), ok);
  doc.body.add(opener, dialog);
  opener.focus();
  recordFocus(opener);
  return { opener, dialog, close, field, ok };
}

describe("dialog focus (#415)", () => {
  it("moves the focus to the first text field when it opens, and back to the opener when it closes", () => {
    const { opener, dialog, field } = page();
    const close = openDialogFocus(dialog, doc, now);
    expect(doc.activeElement).toBe(field);
    dialog.remove();
    close();
    expect(doc.activeElement).toBe(opener);
  });

  it("focuses the dialog itself when it has only buttons, so Enter answers nothing by accident", () => {
    const { dialog } = page({ field: false });
    const close = openDialogFocus(dialog, doc, now);
    expect(doc.activeElement).toBe(dialog);
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    dialog.remove();
    close();
  });

  it("keeps a control the dialog focused itself, or one marked data-autofocus", () => {
    const { dialog, ok } = page();
    ok.setAttribute("data-autofocus", "");
    const close = openDialogFocus(dialog, doc, now);
    expect(doc.activeElement).toBe(ok);
    dialog.remove();
    close();

    const second = page();
    second.close.focus(); // as an autoFocus would, before the effect runs
    const close2 = openDialogFocus(second.dialog, doc, now);
    expect(doc.activeElement).toBe(second.close);
    second.dialog.remove();
    close2();
    // The autoFocused control was inside; the opener it remembers is the one
    // focused before, from the history.
    expect(doc.activeElement).toBe(second.opener);
  });

  it("Tab and Shift+Tab go round inside a modal dialog", () => {
    const { dialog, close: x, field, ok } = page();
    const close = openDialogFocus(dialog, doc, now);
    expect(listeners.add).toHaveBeenCalledTimes(1);

    // In the middle, Tab is the browser's.
    let e = tab();
    handleTab(e, doc);
    expect(e.prevented).toBe(false);

    // At the last, Tab wraps to the first.
    ok.focus();
    e = tab();
    handleTab(e, doc);
    expect(e.prevented).toBe(true);
    expect(doc.activeElement).toBe(x);

    // At the first, Shift+Tab wraps to the last.
    e = tab(true);
    handleTab(e, doc);
    expect(doc.activeElement).toBe(ok);

    // Lost to the page behind: Tab brings it back in.
    doc.activeElement = doc.body;
    handleTab(tab(), doc);
    expect(doc.activeElement).toBe(x);
    expect(field).toBeTruthy();

    dialog.remove();
    close();
    expect(listeners.remove).toHaveBeenCalledTimes(1);
  });

  it("a panel that is not modal takes the focus but does not trap Tab", () => {
    const { dialog, ok, field } = page({ modal: false });
    const close = openDialogFocus(dialog, doc, now);
    expect(doc.activeElement).toBe(field);
    ok.focus();
    const e = tab();
    handleTab(e, doc);
    expect(e.prevented).toBe(false);
    dialog.remove();
    close();
  });

  it("only the dialog opened last traps, and closing it gives the focus back into the one under it", () => {
    const outer = page();
    const closeOuter = openDialogFocus(outer.dialog, doc, now);
    // A button in the outer dialog opens the inner one.
    outer.ok.focus();
    recordFocus(outer.ok);
    const inner = doc.el("div", { role: "dialog", "aria-modal": "true" });
    const innerOk = doc.el("button");
    inner.add(innerOk);
    doc.body.add(inner);
    const closeInner = openDialogFocus(inner, doc, now);
    expect(doc.activeElement).toBe(inner);

    handleTab(tab(), doc);
    expect(doc.activeElement).toBe(innerOk);
    handleTab(tab(), doc);
    expect(doc.activeElement, "wraps inside the inner dialog").toBe(innerOk);

    inner.remove();
    closeInner();
    expect(doc.activeElement).toBe(outer.ok);
    outer.dialog.remove();
    closeOuter();
    expect(doc.activeElement).toBe(outer.opener);
  });

  it("when the opener has gone, falls back to what was focused before it", () => {
    // Open ▾ (a button) opens a menu; its item opens the dialog and goes
    // with the menu.
    const menuButton = doc.el("button");
    const item = doc.el("button");
    const dialog = doc.el("div", { role: "dialog", "aria-modal": "true" });
    dialog.add(doc.el("button"));
    doc.body.add(menuButton, item, dialog);
    menuButton.focus();
    recordFocus(menuButton);
    item.focus();
    recordFocus(item);
    const close = openDialogFocus(dialog, doc, now);
    item.remove();
    dialog.remove();
    close();
    expect(doc.activeElement).toBe(menuButton);
  });

  it("leaves the focus alone when a click outside already put it somewhere", () => {
    const { dialog } = page({ modal: false });
    const elsewhere = doc.el("button");
    doc.body.add(elsewhere);
    const close = openDialogFocus(dialog, doc, now);
    elsewhere.focus();
    dialog.remove();
    close();
    expect(doc.activeElement).toBe(elsewhere);
  });

  it("hands the focus back only after the key that closed the dialog is over", () => {
    const { opener, dialog } = page();
    const queued: (() => void)[] = [];
    const close = openDialogFocus(dialog, doc, (fn) => queued.push(fn));
    dialog.remove();
    close();
    // Still the Enter that closed it: nothing has the focus yet, so the rest
    // of that key reaches nothing.
    expect(doc.activeElement).toBe(doc.body);
    expect(queued).toHaveLength(1);
    queued[0]();
    expect(doc.activeElement).toBe(opener);
  });

  it("leaves a Tab alone that something closer already handled", () => {
    const { dialog, ok } = page();
    const close = openDialogFocus(dialog, doc, now);
    ok.focus();
    const e = { ...tab(), defaultPrevented: true };
    handleTab(e, doc);
    expect(doc.activeElement).toBe(ok);
    dialog.remove();
    close();
  });
});
