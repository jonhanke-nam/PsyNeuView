/**
 * Rows and sections that fold (#418): the one arrow, turned.
 *
 *  - DisclosureArrow is the mark: the panel-edge chevron (PanelHandle's
 *    Chevron) in a 16×16 box, pointing right (▸) when closed and turned 90°
 *    to point down (▾) when open. It goes first in the row, inside the
 *    control that toggles, and that control carries `aria-expanded`.
 *  - DisclosureDetails is a native <details>/<summary> with that arrow in
 *    place of the browser's own marker, and `aria-expanded` on the summary so
 *    every fold in the app reads the same way to a test and to a screen
 *    reader. The browser still gives it Enter and Space.
 *
 * Only disclosures use this arrow. A menu trigger keeps its trailing "▾"
 * text; composition −/+ on the graph stay their own symbols. The guard test
 * (disclosureConventions.test.ts) holds the app to it.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { Chevron } from "./PanelHandle";

export function DisclosureArrow({
  open,
  small = false,
  hidden = false,
  line,
}: {
  open: boolean;
  small?: boolean;
  /** Keep the space but draw nothing: a row that does not fold, lined up with those that do. */
  hidden?: boolean;
  /**
   * The line height the row's old glyph gave it, in px, where the row's
   * height came from that glyph (restyles keep layout). Omit elsewhere.
   */
  line?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        ...(hidden ? { visibility: "hidden" as const } : {}),
        ...(line ? { ["--disclosure-line" as string]: `${line}px` } : {}),
      }}
      data-disclosure-arrow=""
      data-open={open ? "true" : "false"}
      className={`pnv-disclosure-arrow${small ? " pnv-disclosure-arrow--small" : ""}`}
    >
      <Chevron direction="right" size={small ? 8 : 10} />
    </span>
  );
}

export interface DisclosureDetailsProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled: the caller keeps whether it is open (pair with onToggle). */
  open?: boolean;
  /** Called after the user opens or closes it. */
  onToggle?: (open: boolean) => void;
  style?: CSSProperties;
  summaryStyle?: CSSProperties;
  className?: string;
  summaryClassName?: string;
  testId?: string;
  summaryTestId?: string;
}

export function DisclosureDetails({
  summary,
  children,
  defaultOpen = false,
  open: openProp,
  onToggle,
  style,
  summaryStyle,
  className,
  summaryClassName,
  testId,
  summaryTestId,
}: DisclosureDetailsProps) {
  const [openState, setOpen] = useState(defaultOpen);
  const open = openProp ?? openState;
  return (
    <details
      open={open}
      className={className}
      style={style}
      data-testid={testId}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now !== open) {
          setOpen(now);
          onToggle?.(now);
        }
      }}
    >
      <summary
        aria-expanded={open}
        data-testid={summaryTestId}
        className={`pnv-disclosure-summary${summaryClassName ? ` ${summaryClassName}` : ""}`}
        style={summaryStyle}
      >
        <DisclosureArrow open={open} />
        {summary}
      </summary>
      {children}
    </details>
  );
}
