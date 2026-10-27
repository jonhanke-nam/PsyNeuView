/**
 * Developer mode, visible in the main window. (#1291)
 *
 * A Developer badge in the toolbar, beside the app name and gear, shown
 * whenever developer mode is on — so anyone looking at the screen, or at a
 * screenshot in a problem report, can tell at once. Clicking it opens a small
 * menu: turn developer mode off, or open Settings at its Developer section.
 *
 * It is a shortcut to the one control (Settings ▸ Developer ▸ Show what's still under development),
 * not a second setting (docs/settings-and-mac-app.md). With developer mode
 * off, nothing shows here.
 */

import { useEffect, useRef, useState } from "react";
import { DeveloperBadge } from "@/components/common/DeveloperBadge";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { openSettings } from "@/components/common/settings/sections";
import { useUIStore } from "@/stores/uiStore";
import { Z_MENU } from "@/constants/zLayers";

export function DeveloperModeIndicator() {
  const developerMode = useUIStore((s) => s.developerMode);
  const setDeveloperMode = useUIStore((s) => s.setDeveloperMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!developerMode) return null;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="developer-mode-indicator"
        title="Developer mode is on. Click for options."
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        <DeveloperBadge style={{ marginLeft: 0, cursor: "pointer" }} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="developer-mode-menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            minWidth: 200,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            padding: 4,
            zIndex: Z_MENU,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", padding: "4px 8px 6px" }}>
            Developer mode is on. Regular users don't see what it adds.
          </div>
          <button
            type="button"
            role="menuitem"
            data-testid="developer-mode-turn-off"
            onClick={() => {
              setDeveloperMode(false);
              setOpen(false);
            }}
            style={menuItem}
          >
            Turn off developer mode
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="developer-mode-settings"
            onClick={() => {
              setOpen(false);
              openSettings("developer");
            }}
            style={menuItem}
          >
            Developer settings…
          </button>
        </div>
      )}
    </div>
  );
}

const menuItem: React.CSSProperties = {
  textAlign: "left",
  fontSize: "var(--pnv-fs-13)",
  padding: "6px 8px",
  border: "none",
  background: "none",
  borderRadius: 4,
  cursor: "pointer",
  color: "var(--pnv-text-body)",
};
