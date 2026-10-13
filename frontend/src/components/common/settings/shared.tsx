/**
 * The small pieces every Settings section is built from. (#1290)
 *
 * `Group` is a titled block of related settings that can fold. One that is
 * rarely changed starts folded and shows a one-line summary in its place, so
 * the section stays short without hiding what the group holds
 * (docs/settings-etiquette.md).
 */

import { useState, type CSSProperties, type ReactNode } from "react";

export function Group({
  id,
  title,
  summary,
  defaultFolded = false,
  badge,
  children,
}: {
  /** Stable, for the test id `settings-group-<id>`. */
  id: string;
  title: string;
  /** One line shown while folded: the group's current state, in brief. */
  summary?: ReactNode;
  defaultFolded?: boolean;
  /** A mark after the title, like the Developer badge (#1291). */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(defaultFolded);
  return (
    <div data-testid={`settings-group-${id}`} style={{ marginBottom: 18 }}>
      <button
        type="button"
        onClick={() => setFolded((f) => !f)}
        aria-expanded={!folded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 0",
          border: "none",
          borderBottom: "1px solid var(--pnv-border-faint)",
          background: "none",
          cursor: "pointer",
          textAlign: "left",
          marginBottom: folded ? 4 : 8,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 10, width: 12, color: "var(--pnv-text-hint)" }}>
          {folded ? "▶" : "▼"}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--pnv-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
        {badge}
      </button>
      {/* Indented under the heading, so the contents read as the group's. */}
      <div style={{ paddingLeft: GROUP_INDENT }}>
        {folded ? (
          summary !== undefined && (
            <div
              data-testid={`settings-group-${id}-summary`}
              style={{ ...mutedStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {summary}
            </div>
          )
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** How far a group's contents sit in from its heading. */
export const GROUP_INDENT = 16;

/**
 * An action button appears only when pressing it would change something
 * (#1303, docs/settings-etiquette.md §10). When there is nothing to apply,
 * this quiet line takes its place and says what is in use.
 */
export function InUseNow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ fontSize: 12, color: "var(--pnv-success)" }}>
      ✓ In use now: {children}
    </div>
  );
}

/** The one line beside an Apply & restart button: what pressing it does, and that nothing happens until then. */
export const APPLY_EXPLANATION = "Nothing changes until you press Apply & restart.";

export function ApplyExplanation({ testId }: { testId?: string }) {
  return (
    <div data-testid={testId} style={mutedStyle}>
      {APPLY_EXPLANATION}
    </div>
  );
}

/**
 * A path, on its own line, unmistakably a full path. (#1290 review)
 *
 * Monospace in a light box, the home folder shown as `~` with the full path
 * as the tooltip, and wrapping only after a `/` (a `<wbr>` after each) rather
 * than mid-word; a single segment too long for the line still breaks rather
 * than overflowing. Display only: what is stored stays the full path.
 */
export function PathBox({ path, label, testId }: { path: string; label?: string; testId?: string }) {
  const shown = abbreviateHome(path);
  const parts = shown.split("/");
  return (
    <div
      data-testid={testId}
      title={path}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        margin: "4px 0",
        padding: "4px 8px",
        background: "var(--pnv-surface-sunken)",
        border: "1px solid var(--pnv-border-faint)",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--pnv-text-hint)", fontSize: 11, flexShrink: 0 }}>{label ?? "Full path"}</span>
      <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--pnv-text)", minWidth: 0, overflowWrap: "anywhere" }}>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <>
                /<wbr />
              </>
            )}
          </span>
        ))}
      </code>
    </div>
  );
}

/**
 * Text that may hold a path or a branch name, breaking after a `/` before
 * anything else (a `<wbr>` after each), so a long name wraps at a slash
 * rather than mid-word (#1331). A single segment too long for the line
 * still breaks rather than overflowing (`overflowWrap: "anywhere"` on the
 * element around it).
 */
export function BreakAfterSlashes({ text }: { text: string }) {
  const parts = text.split("/");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </span>
      ))}
    </>
  );
}

/** A label and its value, side by side. */
export function Row({
  label,
  value,
  mono,
  dimmed,
  struck,
}: {
  label: string;
  value: string;
  mono?: boolean;
  dimmed?: boolean;
  /** Only for a value that no longer holds, like the previous version. Dimmed
   * alone is for a secondary line ("Up to date with devel" was rendered struck
   * through as if it were wrong, #1276). */
  struck?: boolean;
}) {
  return (
    <div style={{ display: "flex", padding: "4px 0", gap: 12 }}>
      <div style={{ width: 160, color: "var(--pnv-text-secondary)", flexShrink: 0 }}>{label}</div>
      <div
        style={{
          color: dimmed ? "var(--pnv-text-faint)" : "var(--pnv-text)",
          fontFamily: mono ? "monospace" : undefined,
          textDecoration: struck ? "line-through" : undefined,
          // Words wrap at spaces; only a token too long for the line (a path, a
          // commit) breaks inside, instead of "boundarie / s" (#1290).
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * `~` for the home folder, the way the rest of Settings and the Mac app
 * write paths. Display only: a stored path is never rewritten.
 */
export function abbreviateHome(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  return m ? `~${m[1] ?? ""}` : p;
}

export const mutedStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--pnv-text-muted)",
  lineHeight: 1.4,
};

export const errorStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--pnv-danger)",
};

export const linkStyle: CSSProperties = {
  color: "var(--pnv-primary)",
  textDecoration: "none",
};

export const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "5px 8px",
  fontSize: 13,
  border: "1px solid var(--pnv-border)",
  borderRadius: 4,
  background: "var(--pnv-surface)",
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

/** A setting's name and its one-paragraph explanation, above its control. */
export function SettingLabel({ title, children, htmlFor }: { title: ReactNode; children?: ReactNode; htmlFor?: string }) {
  const body = (
    <>
      <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{title}</div>
      {children && <div style={{ fontSize: 12, color: "var(--pnv-text-muted)", marginTop: 2, maxWidth: 560 }}>{children}</div>}
    </>
  );
  return htmlFor ? (
    <label htmlFor={htmlFor} style={{ fontSize: 13, cursor: "pointer" }}>{body}</label>
  ) : (
    <div style={{ fontSize: 13 }}>{body}</div>
  );
}
