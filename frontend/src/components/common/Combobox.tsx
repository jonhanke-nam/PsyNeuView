/**
 * Two-section combobox: "Recent" on top, optional "All …" list below.
 *
 * Extracted from SettingsPanel (#251) so the Load Model → "From GitHub
 * repo…" modal (#258) can use the same widget for Repo + Branch fields.
 *
 * Filtering: the "All …" section is a case-insensitive substring match
 * against the typed text. The "Recent" section is shown unfiltered (#455)
 * — it's small, bounded, and represents the user's own history, so it
 * should stay visible even when a long value is sitting in the input.
 * Free-text always wins — the field's `value` is whatever the user typed,
 * regardless of whether it appears in the dropdown.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "./dialog/useDismiss";

// Cap on how many Recent rows the dropdown surfaces at once. Backend stores
// up to 50; that's too many to always render as a section header.
const RECENT_DISPLAY = 5;

interface ComboboxRow {
  label: string;
  section: "recent" | "all";
  isDefault?: boolean;
}

export interface ComboboxProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  recent: string[];
  all: string[] | null;           // null when there's no live list (Repo field)
  defaultBranch?: string | null;  // ignored when `all` is null
  loadError?: string | null;
  monospace?: boolean;
  allSectionLabel?: string;        // header for the lower section; defaults to "All branches"
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: 13,
  border: "1px solid var(--pnv-border)",
  borderRadius: 4,
  background: "var(--pnv-surface)",
};

export function Combobox({
  value,
  onChange,
  disabled,
  placeholder,
  recent,
  all,
  defaultBranch,
  loadError,
  monospace,
  allSectionLabel = "All branches",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<ComboboxRow[]>(() => {
    const q = value.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    // #455: the Recent section is small, bounded, and shows the user's
    // own history. Don't filter it by the current input — otherwise a
    // long value left in the field after an install (e.g. ``refactor/
    // emcomposition/...``) kicks out every other recent entry because
    // none of them contain that exact substring. Cap at RECENT_DISPLAY
    // so users with long histories don't blow out the dropdown header.
    const recentRows: ComboboxRow[] = recent
      .slice(0, RECENT_DISPLAY)
      .map((label) => ({ label, section: "recent" }));
    const recentSet = new Set(recentRows.map((r) => r.label));
    // "All branches" stays input-filtered — typeahead is its whole point.
    const allRows: ComboboxRow[] = (all ?? [])
      .filter((label) => !recentSet.has(label) && match(label))
      .map((label) => ({
        label,
        section: "all",
        isDefault: defaultBranch != null && label === defaultBranch,
      }));
    return [...recentRows, ...allRows];
  }, [value, recent, all, defaultBranch]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keep highlight in range when rows change (typing filters them).
  useEffect(() => {
    if (highlight >= rows.length) setHighlight(rows.length - 1);
  }, [rows.length, highlight]);

  // With the list showing, Escape closes the list and nothing more: it is the
  // innermost open thing, so the dialog around it (Settings, #1288; the
  // GitHub loader) keeps the key for the next press (#1289).
  const listShown = open && (rows.length > 0 || !!loadError);
  useDismiss(listShown, () => {
    setOpen(false);
    setHighlight(-1);
  });

  const selectRow = (row: ComboboxRow) => {
    onChange(row.label);
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(rows.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === "Enter" && open && highlight >= 0) {
      e.preventDefault();
      selectRow(rows[highlight]);
    } else if (e.key === "Tab" && open && highlight >= 0) {
      selectRow(rows[highlight]);
    }
  };

  const inputBase: React.CSSProperties = {
    ...inputStyle,
    // The wrapper is the flex item, not the input, so `flex: 1` alone left the
    // input at its default 20 characters and cut the placeholder off (#1290).
    width: "100%",
    boxSizing: "border-box",
    paddingRight: 26,
    ...(monospace ? { fontFamily: "monospace" } : {}),
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        style={inputBase}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Toggle dropdown"
        style={{
          position: "absolute",
          right: 1,
          top: 1,
          bottom: 1,
          width: 22,
          border: "none",
          background: "transparent",
          cursor: disabled ? "default" : "pointer",
          color: "var(--pnv-text-muted)",
          fontSize: 10,
        }}
      >
        ▼
      </button>

      {listShown && (
        <div
          role="listbox"
          data-testid="combobox-list"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 2,
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 4,
            boxShadow: "var(--pnv-shadow-float)",
            zIndex: 10,
            fontSize: 12,
          }}
        >
          {(() => {
            const out: React.ReactNode[] = [];
            let lastSection: ComboboxRow["section"] | null = null;
            rows.forEach((row, i) => {
              if (row.section !== lastSection) {
                out.push(
                  <div
                    key={`hdr-${row.section}`}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      textTransform: "uppercase",
                      color: "var(--pnv-text-hint)",
                      background: "var(--pnv-surface-sunken)",
                      borderTop: lastSection ? "1px solid var(--pnv-border-faint)" : undefined,
                    }}
                  >
                    {row.section === "recent" ? "Recent" : allSectionLabel}
                  </div>,
                );
                lastSection = row.section;
              }
              const isHighlighted = i === highlight;
              out.push(
                <div
                  key={`row-${i}-${row.label}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus on the input
                    selectRow(row);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: "4px 8px",
                    cursor: "pointer",
                    background: isHighlighted ? "var(--pnv-primary-tint)" : "var(--pnv-surface)",
                    fontFamily: monospace ? "monospace" : undefined,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>{row.label}</span>
                  {row.isDefault && (
                    <span style={{ color: "var(--pnv-text-hint)", fontSize: 10 }}>default</span>
                  )}
                </div>,
              );
            });
            if (loadError) {
              out.push(
                <div
                  key="load-error"
                  style={{
                    padding: "6px 8px",
                    color: "var(--pnv-danger)",
                    fontSize: 11,
                    borderTop: rows.length ? "1px solid var(--pnv-border-faint)" : undefined,
                  }}
                >
                  {loadError}
                </div>,
              );
            }
            return out;
          })()}
        </div>
      )}
    </div>
  );
}
