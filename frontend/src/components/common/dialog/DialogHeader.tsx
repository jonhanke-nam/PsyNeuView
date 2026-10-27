/**
 * The fixed header of a dialog: its title and a × that never scrolls away.
 * (#1288, then every dialog: #1289)
 *
 * The header sits outside the dialog's scrolling area, so the × is visible
 * however far down the content the user is. The × is labelled "Close" for
 * screen readers; Escape does the same through useDismiss. `children` go
 * between the title and the ×, for anything a dialog wants in its header.
 *
 * The dialog itself is expected to be a flex column with this at the top, a
 * scrolling body, and whatever footer it needs; the header only has to not
 * shrink. A pop-up panel that is narrower than a dialog (History) uses the
 * `compact` size.
 *
 * `DialogCloseButton` is the × on its own, so the one thing in the app that
 * closes but is not a dialog — a toast in NotificationBar — draws the same ×.
 * Its styling lives here and nowhere else: it is the one icon button of
 * docs/ui-style-conventions.md (#1302), its colours palette tokens and its
 * three sizes (full, `compact`, `inline`) its own, not a Button kind's.
 */

import type { CSSProperties, ReactNode } from "react";

interface CloseProps {
  onClick: () => void;
  /** The accessible name; "Close" unless the × means something more specific. */
  label?: string;
  /** The tooltip; names Escape unless the × is not the Escape half of anything. */
  title?: string;
  /** Inherit the colour of a coloured surface (a toast) instead of the dialog grey. */
  color?: string;
  compact?: boolean;
  /**
   * The small × that sits inside a line of text (a toast, the legend, a
   * one-line note): it keeps the size those had before #1289, so it stays
   * centred on the line instead of making a one-line box taller.
   */
  inline?: boolean;
  /** Fades an inline × (a toast's was 0.7). */
  opacity?: number;
  testId?: string;
}

export function DialogCloseButton({
  onClick,
  label = "Close",
  title = "Close (Escape)",
  color = "var(--pnv-text-muted)",
  compact = false,
  inline = false,
  opacity,
  testId = "dialog-close",
}: CloseProps) {
  if (inline) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={title}
        data-testid={testId}
        style={{
          background: "none",
          border: "none",
          color,
          cursor: "pointer",
          fontSize: "var(--pnv-fs-14)",
          lineHeight: 1,
          padding: "0 4px",
          opacity,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    );
  }
  const size = compact ? 22 : 28;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      data-testid={testId}
      style={{
        width: size,
        height: size,
        border: "1px solid transparent",
        borderRadius: 6,
        background: "transparent",
        color,
        fontSize: compact ? 16 : 18,
        lineHeight: 1,
        padding: 0,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ×
    </button>
  );
}

interface Props {
  title: string;
  onClose: () => void;
  /** The id the dialog's aria-labelledby points at. */
  titleId?: string;
  /** The smaller size, for a pop-up panel rather than a dialog. */
  compact?: boolean;
  children?: ReactNode;
}

export function DialogHeader({ title, onClose, titleId, compact = false, children }: Props) {
  const style: CSSProperties = compact
    ? { gap: 8, padding: "6px 8px 6px 12px" }
    : { gap: 12, padding: "12px 16px 12px 20px" };
  return (
    <div
      data-testid="dialog-header"
      style={{
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--pnv-border-faint)",
        flexShrink: 0,
        ...style,
      }}
    >
      <div id={titleId} style={{ fontSize: compact ? 13 : 16, fontWeight: 600, color: "var(--pnv-text)", flex: 1 }}>
        {title}
      </div>
      {children}
      <DialogCloseButton onClick={onClose} compact={compact} />
    </div>
  );
}
