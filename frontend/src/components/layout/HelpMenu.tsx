/**
 * Help ▾ in the toolbar: the one place for help. (#292)
 *
 * Matches the Mac app's Help menu, and a Windows app's when there is one. It
 * gathers what was spread about rather than replacing anything: the Tutorials
 * menu, Settings ▸ About and the diagnostics still open from where they did.
 *
 *   Keyboard Shortcuts     the read-only reference (also ⌘/ and "?")
 *   Tutorials and walkthroughs   opens the Tutorials menu
 *   Report a Problem…      in the Mac app, Settings ▸ Problem reports, which
 *                          explains the app's own Help ▸ Report a Problem…;
 *                          in a browser, Settings ▸ About, where Download
 *                          diagnostics is
 *   About PsyNeuView       Settings ▸ About
 *
 * Last in the toolbar and pushed to its right-hand end, so adding it moves
 * none of the controls before it.
 */

import { useEffect, useRef, useState } from "react";

import { Z_MENU } from "@/constants/zLayers";
import { MENU_ROW_HOVER, menuRowColours, toggleColours } from "@/components/common/toolbarStyles";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { openSettings } from "@/components/common/settings/sections";
import { displayBinding } from "@/shortcuts/binding";
import { openShortcutsReference } from "@/shortcuts/reference";
import { useResolvedShortcuts } from "@/shortcuts/useAppShortcuts";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import { record as recordActivity } from "@/utils/activityLog";

/** Asks the Tutorials menu to open, for Help ▸ Tutorials and walkthroughs. */
export const OPEN_TUTORIALS_MENU = "psyneuview:open-tutorials-menu";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  useDismiss(open, () => setOpen(false));

  const shortcuts = useResolvedShortcuts();
  const referenceKey = (() => {
    const s = shortcuts.find((x) => x.id === "help.shortcuts");
    return s ? displayBinding(s.binding) : "";
  })();

  const choose = (what: string, action: () => void) => {
    recordActivity("menu", `Help ▸ ${what}`);
    setOpen(false);
    action();
  };

  const items: { id: string; label: string; title: string; keys?: string; run: () => void }[] = [
    {
      id: "shortcuts",
      label: "Keyboard Shortcuts",
      title: "Every keyboard shortcut, and which ones you have changed",
      keys: referenceKey,
      run: openShortcutsReference,
    },
    {
      id: "tutorials",
      label: "Tutorials and walkthroughs",
      title: "Guided walkthroughs (also the Tutorials menu)",
      run: () => window.dispatchEvent(new CustomEvent(OPEN_TUTORIALS_MENU)),
    },
    {
      id: "report",
      label: "Report a Problem…",
      title: hasSettingsBridge()
        ? "How Help ▸ Report a Problem… in the app's menu bar sends a report"
        : "Download diagnostics to send with a problem report (Settings ▸ About)",
      run: () => openSettings(hasSettingsBridge() ? "reports" : "about"),
    },
    {
      id: "about",
      label: "About PsyNeuView",
      title: "Versions and links (Settings ▸ About)",
      run: () => openSettings("about"),
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", marginLeft: "auto" }}>
      <button
        onClick={() => {
          if (!open) recordActivity("menu", "Help menu opened");
          setOpen((o) => !o);
        }}
        style={{
          fontSize: "var(--pnv-fs-13)",
          padding: "4px 10px",
          cursor: "pointer",
          ...toggleColours(open),
          borderRadius: 4,
        }}
        title="Keyboard shortcuts, tutorials, reporting a problem, and About"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="help-menu-button"
      >
        Help {"▾"}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="help-menu-list"
          data-pnv-menu="Help"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            // Right-aligned: the button sits at the toolbar's right-hand end.
            right: 0,
            zIndex: Z_MENU,
            minWidth: 240,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            padding: 4,
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              data-testid={`help-menu-${item.id}`}
              onClick={() => choose(item.label, item.run)}
              title={item.title}
              style={{
                width: "100%",
                fontSize: "var(--pnv-fs-12)",
                textAlign: "left",
                padding: "5px 8px",
                border: "none",
                borderRadius: 4,
                ...menuRowColours(false),
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = MENU_ROW_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
              {item.keys && (
                <span style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)", whiteSpace: "nowrap" }}>
                  {item.keys}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
