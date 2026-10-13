/**
 * The five kinds of button, and nothing else about them to decide. (#1302)
 *
 *   primary    filled blue; the one action a dialog or step is for
 *   secondary  outlined; Cancel, Close beside a real action, the other choices
 *   small      outlined, row-sized; Rename, Remove, Show in Finder, Check now
 *   link       text only; "Change in Developer", a fold toggle
 *   danger     red, row-sized; the press that deletes something
 *
 * The size comes with the kind (primary and secondary share one, small and
 * danger another), and every colour is a palette token (styles/palette.css),
 * so a file never writes a button's padding or a hex value of its own.
 * docs/ui-style-conventions.md says when to use which, and the Close rule: a
 * dialog whose only way out is closing (Settings) makes Close primary and the
 * default button, so Return closes it; where there is a real action (Save,
 * Move…, Apply), that is the primary and Close or Cancel is secondary.
 *
 * `isDefault` is the macOS default button: Return activates it while the
 * key is not already someone's — not from a text field (a path being typed,
 * a prompt that submits on Enter itself), not from a focused control (Enter
 * on a focused button presses that button), and not while a dialog opened
 * on top is still open. The × that closes a dialog is DialogCloseButton in
 * dialog/DialogHeader.tsx, the one icon button; it keeps its own three sizes.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

export type ButtonKind = "primary" | "secondary" | "small" | "link" | "danger";

/**
 * A size other than the kind's own, for a place that always had it (#1302):
 * a restyle keeps the old size — colour moves, size stays. Each one is the
 * size some swept place measured before its sweep, so a row or a dialog
 * footer keeps its height and side-by-side controls stay in line.
 *
 *   compact  13px text, 6×14 padding: 30px tall. Settings and most dialogs'
 *            buttons; Reset and Run Model.
 *   slim     13px text, 3×14 padding: 24px. Start Learning and Cancel in Learn.
 *   tall     11px text, 3×10 padding: 21px. A row of actions under a list
 *            (+ Add trial, Import, Clear, + Add Execution Condition) and the
 *            Inspector's inline Save / Cancel.
 *   line     11px text, 18px line, 0×6 padding: 20px. A button inside a
 *            condition's line, which is 20px (its ✕, Edit).
 *   icon     11px text, line-height 1, 0×5 padding: 13px. A row's × or + on a
 *            line of 11–13px text (a port, a trial, a recent run): the glyph
 *            and its box, no taller than the text beside it.
 *
 * The colours, border and radius stay the kind's; only the box changes.
 */
export type ButtonSize = "compact" | "slim" | "tall" | "line" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind;
  /** A size other than the kind's own (see ButtonSize); omit for the kind's. */
  size?: ButtonSize;
  /** The default button of the open dialog: Return activates it. One per dialog. */
  isDefault?: boolean;
}

const regular: CSSProperties = {
  padding: "8px 20px",
  fontSize: 13,
  borderRadius: 6,
  lineHeight: "normal",
};

const rowSized: CSSProperties = {
  padding: "1px 8px",
  fontSize: 11,
  borderRadius: 3,
  lineHeight: "normal",
};

const SIZES: Record<ButtonSize, CSSProperties> = {
  compact: { padding: "6px 14px", fontSize: 13, lineHeight: "normal" },
  slim: { padding: "3px 14px", fontSize: 13, lineHeight: "normal" },
  tall: { padding: "3px 10px", fontSize: 11, lineHeight: "normal" },
  line: { padding: "0 6px", fontSize: 11, lineHeight: "18px" },
  icon: { padding: "0 5px", fontSize: 11, lineHeight: 1 },
};

/** The look of each kind, enabled; `disabled` overrides what differs. */
const KINDS: Record<ButtonKind, { style: CSSProperties; disabled: CSSProperties }> = {
  primary: {
    style: {
      ...regular,
      fontWeight: 500,
      border: "1px solid transparent",
      background: "var(--pnv-primary)",
      color: "var(--pnv-on-primary)",
    },
    disabled: { background: "var(--pnv-disabled-bg)", color: "var(--pnv-text-hint)" },
  },
  secondary: {
    style: {
      ...regular,
      border: "1px solid var(--pnv-border)",
      background: "var(--pnv-surface)",
      color: "var(--pnv-text-secondary)",
    },
    disabled: { opacity: 0.6 },
  },
  small: {
    style: {
      ...rowSized,
      border: "1px solid var(--pnv-border-light)",
      background: "var(--pnv-surface-muted)",
      color: "var(--pnv-text-secondary)",
    },
    disabled: { opacity: 0.5 },
  },
  danger: {
    style: {
      ...rowSized,
      border: "1px solid var(--pnv-danger)",
      background: "var(--pnv-surface-muted)",
      color: "var(--pnv-danger)",
    },
    disabled: { opacity: 0.5 },
  },
  link: {
    style: {
      border: "none",
      background: "none",
      padding: 0,
      font: "inherit",
      color: "var(--pnv-primary)",
      textDecoration: "none",
    },
    disabled: { color: "var(--pnv-text-hint)" },
  },
};

/** The style a kind renders with, for a test to compare computed styles against. */
export function buttonStyleFor(kind: ButtonKind, disabled = false, size?: ButtonSize): CSSProperties {
  const k = KINDS[kind];
  const box = size && kind !== "link" ? SIZES[size] : {};
  return { cursor: disabled ? "default" : "pointer", ...k.style, ...box, ...(disabled ? k.disabled : {}) };
}

/** Is the key event's target something that already means something on Return? */
function returnIsTakenBy(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return type !== "checkbox" && type !== "radio";
  }
  return false;
}

/** Is `el` inside the dialog opened last — the one Return belongs to? */
function inTopmostDialog(el: HTMLElement): boolean {
  // (Unquoted in the selector: dialogInventory.test.ts finds overlays by
  // grepping for the quoted role attribute, and this file is not one.)
  const dialogs = document.querySelectorAll("[role=dialog]");
  const top = dialogs[dialogs.length - 1];
  return !!top && el.closest("[role=dialog]") === top;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = "secondary", size, isDefault = false, disabled, style, type = "button", ...rest },
  ref,
) {
  const inner = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLButtonElement);

  useEffect(() => {
    if (!isDefault) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const button = inner.current;
      if (!button || button.disabled) return;
      if (returnIsTakenBy(e.target)) return;
      if (!inTopmostDialog(button)) return;
      e.preventDefault();
      button.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDefault]);

  return (
    <button
      ref={inner}
      type={type}
      disabled={disabled}
      data-button-kind={kind}
      data-button-size={size}
      data-default-button={isDefault ? "true" : undefined}
      style={{ ...buttonStyleFor(kind, !!disabled, size), ...style }}
      {...rest}
    />
  );
});
