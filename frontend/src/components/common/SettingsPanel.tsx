/**
 * Settings: a sidebar of sections, one shown at a time. (#119, #1290)
 *
 * Reachable via the gear icon in the toolbar, Layout ▸ Settings…, the Mac
 * app's ⌘, and `openSettings(section)` (settings/sections.ts). It reopens on
 * the section shown last; About the first time.
 *
 * This is the one Settings (#1279, PsyNeuView-MacApp#200): inside the Mac app
 * the settings only the app can act on appear in the sections they belong to,
 * read and written through its pnvSettings bridge. Every setting has one
 * control; docs/settings-inventory.yaml lists them with their section, and
 * docs/settings-etiquette.md says how a new one is placed.
 *
 * Version and install data is fetched from `/api/settings/info` on open (#120);
 * install controls are gated by `/api/settings/install/capabilities` (#130).
 */

import { useCallback, useEffect, useState } from "react";
import { record } from "@/utils/activityLog";
import { noteUiFact, rememberServerInfo } from "@/utils/diagnostics";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import type { PsyNeuLinkInfo } from "@/utils/pnlSources";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { AboutSection } from "./settings/AboutSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { DeveloperSection } from "./settings/DeveloperSection";
import { FoldersSection } from "./settings/FoldersSection";
import { GeneralSection } from "./settings/GeneralSection";
import { OpenMenuSection } from "./settings/OpenMenuSection";
import { ReportsSection } from "./settings/ReportsSection";
import { ShortcutsSection } from "./settings/ShortcutsSection";
import { TutorialsVoiceSection } from "./settings/TutorialsVoiceSection";
import {
  availableSectionOrDefault,
  availableSections,
  loadLastSection,
  persistLastSection,
  type SettingsSectionId,
} from "./settings/sections";
import type { InstallCapabilities, SettingsInfo } from "./settings/types";
import { Button } from "./Button";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The section asked for by whoever opened Settings; null means the last one shown. */
  section?: SettingsSectionId | null;
}

export function SettingsPanel({ isOpen, onClose, section: requested = null }: Props) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<InstallCapabilities | null>(null);
  // Snapshot of the PsyNeuLink install that was current just before an install
  // started. Set when InstallControls succeeds so the user can see "you went
  // from X to Y" without having to remember what was installed before. Cleared
  // on close/reopen so the panel doesn't claim a previous version that's stale.
  const [previousPnl, setPreviousPnl] = useState<PsyNeuLinkInfo | null>(null);
  const inMacApp = hasSettingsBridge();
  const [section, setSection] = useState<SettingsSectionId>(() => availableSectionOrDefault(loadLastSection(), inMacApp));

  // Refetch /settings/info. Called once on open and again after a successful
  // install so the panel reflects the new install without a page reload —
  // dist metadata is read fresh from disk so the new install shows up
  // immediately even though the backend process hasn't restarted.
  const refreshInfo = useCallback(async () => {
    try {
      const resp = await fetch("/api/settings/info");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: SettingsInfo = await resp.json();
      rememberServerInfo(data);
      setInfo(data);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  const handleInstallSucceeded = useCallback(
    (snapshot: PsyNeuLinkInfo) => {
      setPreviousPnl(snapshot);
      refreshInfo();
    },
    [refreshInfo],
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInfo(null);
    setLoadError(null);
    setCapabilities(null);
    setPreviousPnl(null);
    setSection(availableSectionOrDefault(requested ?? loadLastSection(), inMacApp));

    fetch("/api/settings/info")
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data: SettingsInfo) => {
        rememberServerInfo(data);
        if (!cancelled) setInfo(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });

    fetch("/api/settings/install/capabilities")
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data: InstallCapabilities | null) => {
        if (!cancelled && data) setCapabilities(data);
      })
      .catch(() => {
        // Capabilities probe is non-fatal — without it we just don't show controls.
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, requested, inMacApp]);

  const showSection = (id: SettingsSectionId) => {
    setSection(id);
    persistLastSection(id);
  };

  // The diagnostics snapshot (#1287) says whether Settings is open and on
  // which section; the activity log gets the section each time it changes.
  useEffect(() => {
    noteUiFact({ settingsOpen: isOpen, activeSettingsSection: isOpen ? section : null });
    if (isOpen) record("menu", `Settings › ${section}`, { section });
  }, [isOpen, section]);

  // Escape closes Settings (#1288) — except while a shortcut is being recorded:
  // the recorder handles Escape itself, before this sees it (see useDismiss).
  useDismiss(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--pnv-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        data-testid="settings-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pnv-surface)",
          borderRadius: 12,
          maxWidth: 880,
          width: "92%",
          height: "min(85vh, 720px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--pnv-shadow-dialog)",
        }}
      >
        <DialogHeader title="Settings" titleId="settings-dialog-title" onClose={onClose} />

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <nav
            aria-label="Settings sections"
            data-testid="settings-sidebar"
            style={{
              width: 180,
              flexShrink: 0,
              padding: "12px 8px",
              borderRight: "1px solid var(--pnv-border-faint)",
              background: "var(--pnv-surface-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {availableSections(inMacApp).map((s) => {
              const active = s.id === section;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => showSection(s.id)}
                  aria-current={active ? "page" : undefined}
                  data-testid={`settings-section-${s.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--pnv-primary)" : "var(--pnv-text-body)",
                    background: active ? "var(--pnv-primary-tint)" : "transparent",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>

          <div
            data-testid={`settings-content-${section}`}
            style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "16px 24px" }}
          >
            {section === "about" && <AboutSection info={info} loadError={loadError} />}
            {section === "general" && (
              <GeneralSection
                info={info}
                loadError={loadError}
                capabilities={capabilities}
                onInstallSucceeded={handleInstallSucceeded}
              />
            )}
            {section === "appearance" && <AppearanceSection />}
            {section === "tutorials-voice" && <TutorialsVoiceSection />}
            {section === "open-menu" && <OpenMenuSection />}
            {section === "folders" && <FoldersSection />}
            {section === "reports" && <ReportsSection />}
            {section === "shortcuts" && (
              <ShortcutsSection
                deployment={
                  // Inside the Mac app the WKWebView gets chords the browser
                  // would otherwise keep, so what is bindable differs by mode.
                  info?.deployment?.mode === "mac_app" ? "macApp" : "browser"
                }
              />
            )}
            {section === "developer" && (
              <DeveloperSection
                info={info}
                loadError={loadError}
                capabilities={capabilities}
                previousPnl={previousPnl}
                onInstallSucceeded={handleInstallSucceeded}
              />
            )}
          </div>
        </div>

        {/* The footer stays put too; the × in the header is the one labelled
            plainly "Close", so this one says what it closes. Closing is the
            only way out of Settings, so Close is the primary and the default
            button: Return closes it (docs/ui-style-conventions.md, #1302). */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "10px 20px",
            borderTop: "1px solid var(--pnv-border-faint)",
            flexShrink: 0,
          }}
        >
          <Button kind="primary" size="compact" isDefault onClick={onClose} aria-label="Close Settings" data-testid="settings-close">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
