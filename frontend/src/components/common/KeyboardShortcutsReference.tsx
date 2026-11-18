/**
 * Help ▸ Keyboard Shortcuts: every shortcut, read-only, with the ones you have
 * changed marked. (#292)
 *
 * Settings ▸ Keyboard shortcuts is where keys are changed; this is where they
 * are looked up. It reads the same registry and the same stored overrides, so
 * the two cannot disagree, and each links to the other.
 *
 * Opens from Help ▸ Keyboard Shortcuts in the toolbar, from ⌘/ (Ctrl+/) and
 * "?" away from typing, and from the Mac app's own Help menu (the
 * `pnv:open-shortcuts` event, shortcuts/reference.ts). Inside the Mac app it
 * also lists the keys the native menus keep, marked "set by macOS".
 *
 * Closes the shared ways (#1289): the ×, Escape, a click outside, and Close.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Z_DIALOG } from "@/constants/zLayers";
import { deliverability, formatBinding, isMac } from "@/shortcuts/binding";
import {
  MAC_APP_MENU_KEYS,
  changedSummary,
  onOpenShortcutsReference,
  referenceRows,
  rowMatches,
} from "@/shortcuts/reference";
import { SHORTCUT_GROUPS, resolveShortcuts } from "@/shortcuts/registry";
import { OVERRIDES_CHANGED, loadOverrides } from "@/shortcuts/storage";
import { openSettings } from "@/components/common/settings/sections";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import { record } from "@/utils/activityLog";
import { Button } from "./Button";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Drawn by App; renders nothing until something asks for it. */
export function KeyboardShortcutsReference() {
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      onOpenShortcutsReference(() => {
        record("menu", "Keyboard Shortcuts opened");
        setOpen(true);
      }),
    []
  );
  if (!open) return null;
  return <Reference onClose={() => setOpen(false)} />;
}

function Reference({ onClose }: { onClose: () => void }) {
  useDismiss(true, onClose);
  const [overrides, setOverrides] = useState<Record<string, string>>(loadOverrides);
  useEffect(() => {
    const refresh = () => setOverrides(loadOverrides());
    window.addEventListener(OVERRIDES_CHANGED, refresh);
    return () => window.removeEventListener(OVERRIDES_CHANGED, refresh);
  }, []);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => searchRef.current?.focus(), []);

  const mac = isMac();
  const inMacApp = hasSettingsBridge();
  const deployment = inMacApp ? "macApp" : "browser";
  const { resolved } = useMemo(() => resolveShortcuts(overrides), [overrides]);
  const rows = useMemo(() => referenceRows(resolved, overrides, mac), [resolved, overrides, mac]);
  const summary = changedSummary(rows);
  const shown = rows.filter((r) => rowMatches(r, query));
  const nativeShown = inMacApp
    ? MAC_APP_MENU_KEYS.filter((k) => rowMatches({ label: k.label, keys: k.keys, group: k.menu }, query))
    : [];
  const unreachable = new Set(
    resolved
      .filter((s) => !deliverability(formatBinding(s.binding), deployment).deliverable)
      .map((s) => s.id)
  );

  const changeShortcuts = () => {
    onClose();
    openSettings("shortcuts");
  };

  return (
    <div
      data-testid="shortcuts-reference-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: Z_DIALOG, display: "flex",
        alignItems: "center", justifyContent: "center", background: "var(--pnv-scrim)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-reference-title"
        data-testid="shortcuts-reference"
        data-platform={mac ? "mac" : "other"}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 94%)", maxHeight: "86%", display: "flex", flexDirection: "column",
          background: "var(--pnv-surface)", borderRadius: 8, boxShadow: "var(--pnv-shadow-dialog)", overflow: "hidden",
        }}
      >
        <DialogHeader title="Keyboard Shortcuts" titleId="shortcuts-reference-title" onClose={onClose} />

        <div style={{ padding: "10px 20px 8px", borderBottom: "1px solid var(--pnv-border-faint)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontSize: "var(--pnv-fs-13)" }}>
            <span data-testid="shortcuts-reference-summary" style={{ color: summary ? "var(--pnv-text-body)" : "var(--pnv-text-muted)" }}>
              {summary ?? "Every shortcut is on its default."}
            </span>
            <Button kind="link" data-testid="shortcuts-reference-open-settings" onClick={changeShortcuts}>
              Change shortcuts…
            </Button>
          </div>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            data-testid="shortcuts-reference-search"
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "5px 8px",
              fontSize: "var(--pnv-fs-13)",
              border: "1px solid var(--pnv-border)",
              borderRadius: 4,
              background: "var(--pnv-surface)",
              color: "var(--pnv-text)",
            }}
          />
        </div>

        <div style={{ overflowY: "auto", padding: "8px 20px 12px", fontSize: "var(--pnv-fs-13)" }}>
          {SHORTCUT_GROUPS.map((group) => {
            const items = shown.filter((r) => r.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} data-testid={`shortcuts-reference-group-${group}`} style={{ marginBottom: 10 }}>
                <GroupHeading>{group}</GroupHeading>
                {items.map((row) => (
                  <div
                    key={row.id}
                    data-testid={`shortcuts-reference-row-${row.id}`}
                    data-changed={row.changed ? "true" : undefined}
                    style={rowStyle}
                  >
                    <span style={{ color: "var(--pnv-text-body)" }}>
                      {row.label}
                      {unreachable.has(row.id) && (
                        <span style={noteStyle}> · a browser keeps this key</span>
                      )}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                      {row.changed && (
                        <span data-testid={`shortcuts-reference-changed-${row.id}`} style={noteStyle}>
                          <span style={changedTagStyle}>changed</span> (default {row.defaultKeys})
                        </span>
                      )}
                      <kbd data-testid={`shortcuts-reference-keys-${row.id}`} style={keyStyle}>{row.keys}</kbd>
                    </span>
                  </div>
                ))}
              </section>
            );
          })}

          {nativeShown.length > 0 && (
            <section data-testid="shortcuts-reference-native" style={{ marginBottom: 10 }}>
              <GroupHeading>Mac app menus</GroupHeading>
              {nativeShown.map((k) => (
                <div key={`${k.menu}-${k.label}`} style={rowStyle}>
                  <span style={{ color: "var(--pnv-text-body)" }}>
                    {k.menu} ▸ {k.label}
                    {k.note && <span style={noteStyle}> · {k.note}</span>}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                    <span style={noteStyle}>set by macOS</span>
                    <kbd style={keyStyle}>{k.keys}</kbd>
                  </span>
                </div>
              ))}
            </section>
          )}

          {shown.length === 0 && nativeShown.length === 0 && (
            <div data-testid="shortcuts-reference-no-match" style={{ color: "var(--pnv-text-muted)", padding: "8px 0" }}>
              No shortcut matches “{query}”.
            </div>
          )}

          <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", marginTop: 8, lineHeight: 1.5 }}>
            Keys are shown for {mac ? "macOS" : "Windows and Linux"}. A shortcut with no ⌘ or Ctrl never fires
            while you are typing in a field.{unreachable.size > 0 && " A key a browser keeps works in the Mac app, or can be changed."}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button kind="primary" size="compact" isDefault onClick={onClose} data-testid="shortcuts-reference-close">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
      {children}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 12,
  padding: "3px 0",
};

const keyStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "var(--pnv-fs-12)",
  color: "var(--pnv-text-body)",
  background: "var(--pnv-surface-sunken)",
  border: "1px solid var(--pnv-border-light)",
  borderRadius: 3,
  padding: "1px 6px",
  minWidth: 50,
  textAlign: "center",
};

const noteStyle: React.CSSProperties = {
  fontSize: "var(--pnv-fs-11)",
  color: "var(--pnv-text-muted)",
};

const changedTagStyle: React.CSSProperties = {
  color: "var(--pnv-warning-text-on-tint)",
  background: "var(--pnv-warning-tint)",
  border: "1px solid var(--pnv-warning-border)",
  borderRadius: 3,
  padding: "0 4px",
};
