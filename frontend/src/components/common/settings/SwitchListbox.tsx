/**
 * The open half of the Switch to dropdown in Developer ▸ Which PsyNeuLink is
 * installed (#1331, folded into groups in #1334): a listbox whose names are
 * shown in full. A native <select> can't wrap a long branch name, show a
 * second line or fold, so this is a popover of <button role="option"> rows
 * (a real button: hover and focus for free,
 * docs/ui-interaction-conventions.md) under role="group" headings.
 *
 * The two "Another…" rows come first and are always in view. The groups
 * below fold, each heading a <button aria-expanded> with its count: only the
 * group holding the PsyNeuLink in use starts open (and the one holding what
 * has been chosen since, if that is another); a folded group holding it
 * says "✓ in use" in its heading. The releases group shows the newest few
 * and a "Show older (n)" row for the rest. Fold state lives only while the
 * list is open: it opens the same way every time.
 *
 * Keyboard: Up/Down move over headings and rows, Home/End to the first and
 * last. On a heading, Right opens it and Left closes it, Enter or Space
 * toggle (the button's own click). On a row, Enter or Space pick, and Left
 * goes to its heading and closes the group. Escape closes the list through
 * the shared `useDismiss`, so it closes before the Settings dialog does. The
 * trigger button, the click-outside and what a pick does belong to the
 * control that opens this.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { groupsOpenAtFirst, splitOlderReleases, type SwitchGroup, type SwitchOption } from "@/utils/pnlSources";
import { useDismiss } from "../dialog/useDismiss";
import { BreakAfterSlashes } from "./shared";

export function SwitchListbox({
  groups,
  selectedValue,
  labelId,
  onPick,
  onClose,
}: {
  groups: SwitchGroup[];
  /** The value chosen now, focused when the list opens; null focuses the one in use. */
  selectedValue: string | null;
  /** The id of the "Switch to" label, for the listbox's name. */
  labelId: string;
  onPick: (option: SwitchOption) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idBase = useId();
  useDismiss(true, onClose);
  const place = useFitToContainer(ref);

  // Which groups are open. Until the user folds or unfolds one, it follows
  // the groups as they arrive (the sources and the releases are fetched), so
  // the group in use opens even when it is listed after the list opened.
  const [touched, setTouched] = useState<Set<string> | null>(null);
  const open = useMemo(() => touched ?? groupsOpenAtFirst(groups, selectedValue), [touched, groups, selectedValue]);
  const setGroupOpen = (id: string, isOpen: boolean) => {
    const next = new Set(open);
    if (isOpen) next.add(id);
    else next.delete(id);
    setTouched(next);
  };
  // "Show older (n)" reveals the rest of the releases; focus goes to the first of them.
  const [olderShown, setOlderShown] = useState(false);
  const revealFirst = useRef<string | null>(null);
  useEffect(() => {
    if (!olderShown || revealFirst.current === null) return;
    const row = ref.current?.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(revealFirst.current)}"]`);
    revealFirst.current = null;
    row?.focus();
  }, [olderShown]);

  // Focus the chosen row, else the one in use, else the first row — but
  // only once the rows are there, and never after the user has moved focus
  // within the list.
  const focusedByUs = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const rows = navigable(ref.current).filter((b) => b.dataset.switchNav === "row");
    const active = document.activeElement;
    if (ref.current?.contains(active) && active !== focusedByUs.current) return;
    const start =
      rows.find((b) => b.dataset.value === selectedValue) ??
      rows.find((b) => b.dataset.current === "true") ??
      rows[0];
    if (start && start !== active) {
      start.focus();
      focusedByUs.current = start;
    }
  }, [selectedValue, groups, open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = navigable(ref.current);
    if (items.length === 0) return;
    const active = document.activeElement as HTMLButtonElement;
    const at = items.indexOf(active);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, at + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const group = active?.dataset.group;
      if (!group) return;
      e.preventDefault();
      if (active.dataset.switchNav === "heading") {
        setGroupOpen(group, e.key === "ArrowRight");
      } else if (e.key === "ArrowLeft") {
        // From a row, Left goes up to its heading and folds the group.
        const heading = items.find((b) => b.dataset.switchNav === "heading" && b.dataset.group === group);
        if (heading) {
          heading.focus();
          setGroupOpen(group, false);
        }
      }
      return;
    }
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-labelledby={labelId}
      data-testid="pnl-switch-listbox"
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        ...(place.up ? { bottom: "100%", marginBottom: 2 } : { top: "100%", marginTop: 2 }),
        left: 0,
        right: 0,
        maxHeight: place.maxHeight,
        overflowY: "auto",
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-border)",
        borderRadius: 4,
        boxShadow: "var(--pnv-shadow-popover)",
        zIndex: 20,
        fontSize: 13,
      }}
    >
      {groups.map((g, gi) => {
        const headingId = `${idBase}-${gi}`;
        const isOpen = g.kind === "other" || open.has(g.id);
        const inUse = g.options.some((o) => o.current);
        // The releases: the newest few, then "Show older (n)" for the rest.
        const { shown, older } = g.kind === "releases" ? splitOlderReleases(g.options) : { shown: g.options, older: [] };
        const rows = olderShown ? [...shown, ...older] : shown;
        return (
          <div
            key={g.id}
            role="group"
            aria-labelledby={g.label ? headingId : undefined}
            data-testid={`pnl-switch-group-${g.id}`}
            data-open={g.label ? (isOpen ? "true" : "false") : undefined}
            style={{ borderTop: gi > 0 ? "1px solid var(--pnv-border-faint)" : undefined }}
          >
            {g.label && (
              <button
                type="button"
                id={headingId}
                aria-expanded={isOpen}
                data-testid="pnl-switch-group-heading"
                data-switch-nav="heading"
                data-group={g.id}
                onClick={() => setGroupOpen(g.id, !isOpen)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "var(--pnv-surface-muted)",
                  padding: "5px 8px",
                  font: "inherit",
                  fontSize: 12,
                  color: "var(--pnv-text-body)",
                  cursor: "pointer",
                  overflowWrap: "anywhere",
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 9, width: 10, color: "var(--pnv-text-hint)", flexShrink: 0 }}>
                  {isOpen ? "▼" : "▶"}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}><BreakAfterSlashes text={g.label} /></span>
                  <span style={{ color: "var(--pnv-text-muted)" }}> ({g.options.length})</span>
                  {g.note && <span style={{ color: "var(--pnv-text-muted)" }}> · {g.note}</span>}
                </span>
                {inUse && !isOpen && <InUseBadge />}
              </button>
            )}
            {isOpen && rows.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === selectedValue}
                data-testid="pnl-switch-option"
                data-switch-nav="row"
                data-group={g.id}
                data-value={o.value}
                data-current={o.current ? "true" : undefined}
                disabled={o.disabled}
                title={o.title}
                onClick={() => onPick(o)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: o.value === selectedValue ? "var(--pnv-primary-tint)" : "var(--pnv-surface)",
                  padding: g.kind === "other" ? "5px 8px" : "5px 8px 5px 24px",
                  font: "inherit",
                  color: o.disabled ? "var(--pnv-text-faint)" : "var(--pnv-text)",
                  cursor: o.disabled ? "default" : "pointer",
                  // Full names: a long branch wraps rather than being cut off.
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                }}
              >
                {g.kind === "other" && <span aria-hidden="true" style={{ color: "var(--pnv-primary)", fontWeight: 600, flexShrink: 0 }}>+</span>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: o.current ? 600 : 400 }}><BreakAfterSlashes text={o.name} /></span>
                  {o.detail && <span style={{ display: "block", fontSize: 11, color: "var(--pnv-text-muted)" }}><BreakAfterSlashes text={o.detail} /></span>}
                </span>
                {o.current && <InUseBadge />}
              </button>
            ))}
            {isOpen && older.length > 0 && !olderShown && (
              <button
                type="button"
                data-testid="pnl-switch-show-older"
                data-switch-nav="row"
                data-group={g.id}
                onClick={() => {
                  revealFirst.current = older[0].value;
                  setOlderShown(true);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "var(--pnv-surface)",
                  padding: "5px 8px 5px 24px",
                  font: "inherit",
                  fontSize: 12,
                  color: "var(--pnv-primary)",
                  cursor: "pointer",
                }}
              >
                Show older ({older.length})
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InUseBadge() {
  return (
    <span style={{ fontSize: 10, color: "var(--pnv-success)", border: "1px solid var(--pnv-success)", borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap", flexShrink: 0 }}>
      ✓ in use
    </span>
  );
}

/** The headings and rows the arrow keys move over, in order: every button that can be pressed. */
function navigable(root: HTMLDivElement | null): HTMLButtonElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-switch-nav]:not(:disabled)"));
}

/** The tallest the list gets when there's room. */
const LIST_MAX = 360;
/** Below this much room underneath, open upward if there's more room above. */
const LIST_MIN_BELOW = 200;

/**
 * Keep the open list inside the window it's in (#1331): size it to the room
 * between the trigger and the edge of the nearest scrolling ancestor (the
 * Settings content), opening upward when there's more room above. The list
 * scrolls within that height, so it never runs off the end.
 */
function useFitToContainer(ref: { current: HTMLDivElement | null }) {
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number }>({ up: false, maxHeight: LIST_MAX });
  useLayoutEffect(() => {
    const measure = () => {
      const list = ref.current;
      const anchor = list?.parentElement;
      if (!list || !anchor) return;
      const box = scrollingAncestor(anchor)?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
      };
      const trigger = anchor.getBoundingClientRect();
      const below = box.bottom - trigger.bottom - 8;
      const above = trigger.top - box.top - 8;
      const up = below < LIST_MIN_BELOW && above > below;
      const room = up ? above : below;
      setPlace({ up, maxHeight: Math.max(96, Math.min(LIST_MAX, Math.floor(room))) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return place;
}

function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}
