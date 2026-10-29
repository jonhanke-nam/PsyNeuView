/**
 * The ring a guided walkthrough draws on the thing it is talking about (#1181),
 * and the pointer that glides to it (#1310).
 *
 * Only the ring and the pointer. The instruction, progress and controls live
 * in the TourBar, which has space reserved for it at the bottom of the app —
 * see that file for why a floating callout stopped being good enough.
 *
 * Two decisions carried over from earlier work:
 *
 *  - **Window coordinates.** A walkthrough that can only ring canvas nodes can
 *    only teach looking; teaching someone to *build* means pointing at the
 *    palette, which is a sibling of the canvas rather than inside it.
 *  - **Node geometry from the shared `toScreenRect`**, the same one the
 *    off-screen indicator uses, so the ring cannot drift from what the app
 *    believes is visible.
 *
 * It reports an off-screen anchor to the store rather than handling it: the
 * bar owns everything the learner reads.
 *
 * The pointer (#1310) is an arrow that travels from wherever it last was to
 * the step's anchor, for a step marked `pointer: true`. It tells the store
 * when it has arrived, and the bar shows the instruction then: "look here"
 * before the words. Replay sends it again from where it started.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@xyflow/react";

import { useTourProgress } from "@/hooks/useTourProgress";
import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { useModelStore } from "@/stores/modelStore";
import { ringColor, ringWidth, useTourHighlightStore } from "@/stores/tourHighlightStore";
import { tourIdFromUrl, useTourStore } from "@/stores/tourStore";
import { isOnScreen, toScreenRect, type NodeBox } from "@/utils/offscreenNodes";
import { cssEscape, nodeSelector } from "@/utils/nodeSelector";
import { matchesNodeName } from "@/utils/tourStep";
import { Z_TOUR_OVERLAY } from "@/constants/zLayers";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How long the pointer takes to reach an anchor. */
export const POINTER_GLIDE_MS = 700;

/** Where the pointer is when a walkthrough starts: the middle of the window. */
function restingPoint(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** An element that is on screen with some size, or null. */
function shown(el: Element | null): Element | null {
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? el : null;
}

/**
 * Where a step that opens a catalog model points once the Open menu is open
 * (#1392): the model's own entry, or, while its section is folded, the
 * section's header. Null before the menu opens, so the step's anchor (the Open
 * button) is ringed. Without this the ring stayed on the Open button, and the
 * PsyNeuLink Library's EGO looked like the one to pick.
 */
function openModelAnchor(label: string, sectionOf: ((label: string) => string | null) | null): Element | null {
  if (!shown(document.querySelector('[data-testid="open-menu-list"]'))) return null;
  const entry = shown(document.querySelector(`[data-catalog-label="${CSS.escape(label)}"]`));
  if (entry) return entry;
  const section = sectionOf?.(label);
  return section ? shown(document.querySelector(`[data-testid="open-menu-section-${section}"]`)) : null;
}

/**
 * Whether an open modal dialog hides the anchor (#1394).
 *
 * The overlay sits above every dialog so the orientation walkthroughs can ring
 * things inside Settings. A step whose anchor is *behind* a dialog (a canvas
 * node, a toolbar button) then drew its ring on top of the dialog, framing
 * nothing. So: with a modal open, an anchor shows only if it is inside one.
 *
 * Asked of the open modals rather than by hit-testing the anchor's centre: a
 * canvas node's centre is often under an edge label, a value pill or the
 * pointer's own path, and a hit test would hide rings that are plainly visible.
 */
export function coveredByDialog(el: Element, doc: Document = document): boolean {
  const modals = Array.from(doc.querySelectorAll('[role="dialog"][aria-modal="true"]'));
  if (modals.length === 0) return false;
  return !modals.some((m) => m.contains(el));
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export function TourOverlay() {
  const { step, complete } = useTourProgress();
  const nodes = useModelStore((s) => s.nodes);
  const setAnchorOffScreen = useTourStore((s) => s.setAnchorOffScreen);
  const setPointerArrived = useTourStore((s) => s.setPointerArrived);
  const replayCount = useTourStore((s) => s.replayCount);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const startCount = useTourStore((s) => s.startCount);
  const [rect, setRect] = useState<Rect | null>(null);
  // Re-measure a test-id anchor a few times a second: the element a step
  // points at often appears just as the step begins (a panel the previous
  // step opened), and a single measurement would miss it.
  const [tick, setTick] = useState(0);
  // The step whose test-id anchor was last scrolled into view, so it's
  // scrolled once when it appears and the learner can scroll away after.
  const scrolledFor = useRef<string | null>(null);

  // `?tour=<id>` still starts one, so a walkthrough can be linked from a doc
  // or an issue. The menu is the discoverable route; this is the shareable one.
  useEffect(() => {
    const fromUrl = tourIdFromUrl(window.location.search);
    if (fromUrl) useTourStore.getState().startTour(fromUrl);
  }, []);

  // Node anchors too: a dialog opening over the canvas changes nothing the
  // node measurement depends on, so without the tick its ring stayed (#1394).
  useEffect(() => {
    if (!step) return;
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [step]);

  // Scrolling any panel (Settings' sections, the Learn tab) or resizing the
  // window moves the anchor; follow it at once rather than on the next tick.
  useEffect(() => {
    if (!step) return;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("scroll", bump, { capture: true, passive: true });
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, { capture: true });
      window.removeEventListener("resize", bump);
    };
  }, [step]);

  // React Flow's pan/zoom, so the ring re-measures as the canvas moves.
  const transform = useStore((s) => s.transform.join(","));

  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }

    if (step.anchor.testid) {
      const inMenu = step.act?.openModel ? openModelAnchor(step.act.openModel, useCatalogOpener.getState().sectionOf) : null;
      const el = inMenu ?? document.querySelector(`[data-testid="${cssEscape(step.anchor.testid)}"]`);
      // An anchor inside a scrolled panel (the Learn tab's chart, below its
      // form) can be out of sight; bring it into view once per step (#52).
      // "nearest" leaves an anchor that is already in view where it is.
      // The menu entry is a new target within the same step: scroll to it too.
      const stepKey = `${startCount}:${stepIndex}:${inMenu ? (inMenu.getAttribute("data-catalog-label") ?? "section") : "anchor"}`;
      if (el && scrolledFor.current !== stepKey) {
        scrolledFor.current = stepKey;
        el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      const box = el && !coveredByDialog(el) ? el.getBoundingClientRect() : undefined;
      const next = box && (box.width > 0 || box.height > 0) ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      setAnchorOffScreen(false);
      return;
    }

    const pane = document.querySelector('[data-testid="graph-canvas-viewport"]');
    const paneBox = pane?.getBoundingClientRect();
    const name = step.anchor.node;
    if (!paneBox || !name) {
      setRect(null);
      return;
    }

    const match = nodes.find((n) => matchesNodeName(n.id, name));
    const el = match
      ? (document.querySelector(nodeSelector(match.id)) as HTMLElement | null)
      : null;
    if (!el) {
      setRect(null);
      return;
    }
    // Behind a dialog: no ring, and not "off-screen" either (the bar would
    // offer to fit the graph, which the dialog hides).
    if (coveredByDialog(el)) {
      setAnchorOffScreen(false);
      setRect(null);
      return;
    }

    const [tx, ty, zoom] = transform.split(",").map(Number);
    const box: NodeBox = {
      id: match!.id,
      x: match!.position.x,
      y: match!.position.y,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    const viewport = {
      transform: [tx, ty, zoom] as [number, number, number],
      width: paneBox.width,
      height: paneBox.height,
    };
    const local = toScreenRect(box, viewport);
    const onScreen = isOnScreen(box, viewport);
    setAnchorOffScreen(!onScreen);
    setRect(
      onScreen
        ? {
            left: paneBox.left + local.left,
            top: paneBox.top + local.top,
            width: el.offsetWidth * zoom,
            height: el.offsetHeight * zoom,
          }
        : null,
    );
  }, [step, transform, nodes, tick, setAnchorOffScreen, startCount, stepIndex]);

  // --- The pointer (#1310) -------------------------------------------------
  //
  // Where it is drawn now, and where it was last: a new glide starts from
  // the old place, so the eye follows a path rather than a jump. One ref for
  // the whole session; a fresh start begins from the middle of the window.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [pointerAt, setPointerAt] = useState<{ x: number; y: number } | null>(null);
  const [gliding, setGliding] = useState(false);
  // The arrow is optional (#100): off by default, the ring alone marks the anchor.
  const showArrow = useTourHighlightStore((h) => h.showArrow);
  const highlight = useTourHighlightStore();
  const wantsPointer = Boolean(step?.pointer) && showArrow && !complete;
  // One glide per (start, step, replay): the key says when to send it again.
  const glideKey = wantsPointer && rect ? `${startCount}/${stepIndex}/${replayCount}` : null;
  const target = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;

  useEffect(() => {
    if (!glideKey || !target) {
      setPointerAt(null);
      setGliding(false);
      return;
    }
    const from = lastPoint.current ?? restingPoint();
    // Place it at the start without a transition, then let the browser paint
    // and move it: the transition only runs for a change it can see.
    setGliding(false);
    setPointerAt(from);
    const raf = requestAnimationFrame(() => {
      setGliding(true);
      setPointerAt(target);
    });
    // The arrival is on a timer, not transitionend: a pointer already at its
    // target fires no event, and a learner replaying twice should still get
    // the words back.
    const arrive = setTimeout(() => {
      lastPoint.current = target;
      setPointerArrived(true);
    }, POINTER_GLIDE_MS + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(arrive);
    };
    // target is derived from rect; glideKey already changes with the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glideKey, rect?.left, rect?.top, rect?.width, rect?.height]);

  // A step without a pointer never waits for one.
  useEffect(() => {
    if (step && !(step.pointer && showArrow)) setPointerArrived(true);
  }, [step, showArrow, setPointerArrived]);

  if (!step || !rect) return null;

  const pad = 8 + ringWidth(highlight.thickness) / 2;
  // Each side sits just outside the anchor where there is room, and just
  // inside its edge where the gap is taken by something else (#102): a panel's
  // ring ran through the text above it and into the next panel.
  // A node's ring goes round the oval. Tucked inside, it cut the oval
  // wherever a line left the node or the node sat against the panels below
  // the canvas; only another node is in its way.
  const nodeId = step.anchor.testid ? null : nodes.find((n) => matchesNodeName(n.id, step.anchor.node ?? ""))?.id;
  const clearOfOtherNodes = nodeId
    ? (el: Element) => {
        const owner = el.closest(".react-flow__node");
        return !owner || owner.getAttribute("data-id") === nodeId;
      }
    : undefined;
  const sides = ringSides(rect, pad, ringWidth(highlight.thickness), undefined, clearOfOtherNodes);
  // Kept inside the window: around something as wide as the window (the
  // toolbar) the padded ring's top and sides fell outside it, and all that
  // showed was a stray line along its bottom edge.
  const edge = 2;
  const ringLeft = Math.max(edge, rect.left - sides.left);
  const ringTop = Math.max(edge, rect.top - sides.top);
  const ringRight = Math.min(window.innerWidth - edge, rect.left + rect.width + sides.right);
  const ringBottom = Math.min(window.innerHeight - edge, rect.top + rect.height + sides.bottom);

  return (
    <div
      data-testid="tour-overlay"
      // Above Settings and the other dialogs (zIndex 10000): the orientation
      // walkthroughs ring things inside them.
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: Z_TOUR_OVERLAY }}
    >
      <div
        data-testid="tour-highlight"
        data-sides={(["top", "right", "bottom", "left"] as const).map((k) => (sides[k] > 0 ? "out" : "in")).join(" ")}
        data-pulse={complete ? "off" : highlight.pulse}
        className={!complete && highlight.pulse !== "off" ? `pnv-tour-ring-pulse-${highlight.pulse}` : undefined}
        style={{
          position: "fixed",
          left: ringLeft,
          top: ringTop,
          width: ringRight - ringLeft,
          height: ringBottom - ringTop,
          boxSizing: "border-box",
          // Thickness, colour and pulse are the learner's (#100); a done step
          // turns the done colour and stops pulsing.
          color: complete ? "var(--pnv-walkthrough-done)" : ringColor(highlight.color),
          border: `${ringWidth(highlight.thickness)}px solid currentColor`,
          borderRadius: 12,
          transition: "color 120ms ease",
        }}
      />
      {wantsPointer && pointerAt && (
        <svg
          data-testid="tour-pointer"
          data-gliding={gliding ? "true" : "false"}
          width="34"
          height="38"
          viewBox="0 0 34 38"
          style={{
            position: "fixed",
            left: pointerAt.x - 4,
            top: pointerAt.y - 4,
            transition: gliding ? `left ${POINTER_GLIDE_MS}ms ease-in-out, top ${POINTER_GLIDE_MS}ms ease-in-out` : "none",
            filter: "var(--pnv-shadow-pointer)",
          }}
        >
          {/* A plain arrow cursor, blue so it reads as the walkthrough's and not the learner's. */}
          <path d="M4 2 L4 30 L11 23 L16 35 L21 33 L16 21 L26 21 Z" style={{ fill: "var(--pnv-walkthrough-current)", stroke: "var(--pnv-surface)" }} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/**
 * How far each side of the ring sits from the anchor (#102): `pad` outside it
 * where the gap is clear, or just inside its edge where it isn't. "Clear" means
 * that along the padded line, what's on top is a container round the whole
 * anchor (the background it sits on), not text or a neighbouring panel.
 * Empty background counts as clear too (`isBackground`), so a panel whose
 * neighbour's edge is only padding still gets its ring outside (#9).
 * `alsoClear` names more things the ring may cross: for a node, anything but
 * another node, since a side tucked inside the oval cuts it.
 *
 * Where the padded line is taken, the side first tries hugging the anchor,
 * just outside its edge: between toolbar buttons a few pixels apart, the
 * full pad lands on the next button. Then inside, where the anchor's edge is
 * empty background. Then, looser, astride the edge or just inside it, over
 * padding but never over letters (tabs packed tight). Failing all three, only an anchor big
 * enough to hold the ring, a panel, has the side tucked inside; inside a
 * button it cut through the label.
 */
/** The smallest anchor, across, that a side of the ring may tuck inside. */
const MIN_TUCKABLE = 80;

export function ringSides(
  rect: Rect,
  pad: number,
  width: number,
  topAt: (x: number, y: number) => Element | null = (x, y) => topElementAt(x, y),
  alsoClear: (el: Element) => boolean = () => false,
): Record<"top" | "right" | "bottom" | "left", number> {
  const inside = -(width + 2);
  const hug = width + 2;
  const roomInside = Math.min(rect.width, rect.height) >= MIN_TUCKABLE;
  const contains = (el: Element | null) => {
    if (!el) return true; // off the page: nothing to cross
    if (alsoClear(el)) return true;
    if (isBackground(el)) return true;
    const b = el.getBoundingClientRect();
    return b.left <= rect.left + 1 && b.top <= rect.top + 1 && b.right >= rect.left + rect.width - 1 && b.bottom >= rect.top + rect.height - 1;
  };
  // Looser: no letters and no field there, though it may be another
  // button's padding. Used only where a stricter place can't be had.
  const noGlyph = (x: number, y: number) => {
    const el = topAt(x, y);
    if (!el || contains(el)) return true;
    if (typeof el.tagName === "string" && FIELD_TAGS.has(el.tagName.toLowerCase())) return false;
    return !glyphAt(el, x, y);
  };
  // A ring whose outer edge is `d` from the anchor covers `d - width` to `d`;
  // both edges are checked.
  const band = (line: (d: number) => [number, number][], d: number, ok: (x: number, y: number, inner: boolean) => boolean) =>
    [d, d - width === 0 ? -0.5 : d - width].every((e) => line(e).every(([x, y]) => ok(x, y, e <= 0)));
  // Inside the anchor, what's under the ring is the anchor or its parts, so
  // "round the anchor" says nothing there: its letters are what matter.
  const strict = (x: number, y: number, inner = false) => {
    const el = topAt(x, y);
    return contains(el) && !(inner && el && glyphAt(el, x, y));
  };
  const along = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.5)) / n);
  // Every 8px or so: with empty containers counting as clear, sparser
  // points fell between lines of code and missed them.
  const xs = along(Math.max(9, Math.ceil(rect.width / 8)), rect.left, rect.left + rect.width);
  const ys = along(Math.max(7, Math.ceil(rect.height / 8)), rect.top, rect.top + rect.height);
  const side = (line: (d: number) => [number, number][]) => {
    if (band(line, pad, strict)) return pad;
    if (hug < pad && band(line, hug, strict)) return hug;
    // Inside, where the anchor's edge is empty there (a toolbar's padding).
    if (band(line, inside, strict)) return inside;
    // Astride the edge, over padding on both sides (tabs packed tight), and
    // then just inside; never through letters, the anchor's or another's.
    if (band(line, width / 2, noGlyph)) return width / 2;
    if (band(line, inside, noGlyph)) return inside;
    return roomInside ? inside : Math.min(hug, pad);
  };
  return {
    top: side((d) => xs.map((x) => [x, rect.top - d])),
    bottom: side((d) => xs.map((x) => [x, rect.top + rect.height + d])),
    left: side((d) => ys.map((y) => [rect.left - d, y])),
    right: side((d) => ys.map((y) => [rect.left + rect.width + d, y])),
  };
}

/** Containers that only lay things out; a bare one shows nothing of its own. */
const LAYOUT_TAGS = new Set(["div", "section", "main", "nav", "header", "footer", "aside", "form", "ul", "ol", "body", "html"]);

/**
 * Whether what's at a point is empty background: a layout container with no
 * text of its own there (a tab bar's padding below its tabs, a toolbar's gap
 * between buttons). The ring may sit on that; text, buttons and inputs it
 * may not.
 */
function isBackground(el: Element): boolean {
  if (typeof el.tagName !== "string" || !LAYOUT_TAGS.has(el.tagName.toLowerCase())) return false;
  return !Array.from(el.childNodes ?? []).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
}

/** Form fields show their own content box; the ring never lies over one. */
const FIELD_TAGS = new Set(["input", "select", "textarea"]);

/**
 * Whether a letter of `el`'s own text is drawn at this point. Measured from
 * the text's boxes, so a button's padding round its label doesn't count.
 * Without a DOM (unit tests), any text of its own counts.
 */
function glyphAt(el: Element, x: number, y: number): boolean {
  const texts = Array.from(el.childNodes ?? []).filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  if (texts.length === 0) return false;
  if (typeof document === "undefined" || typeof document.createRange !== "function") return true;
  const range = document.createRange();
  return texts.some((n) => {
    range.selectNodeContents(n);
    return Array.from(range.getClientRects()).some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
  });
}

/** The topmost element at a point, not counting the walkthrough's own overlay. */
function topElementAt(x: number, y: number): Element | null {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  return document.elementsFromPoint(x, y).find((el) => !el.closest('[data-testid="tour-overlay"]')) ?? null;
}

