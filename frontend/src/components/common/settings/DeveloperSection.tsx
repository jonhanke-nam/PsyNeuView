/**
 * Settings ▸ Developer: always last, always listed. (#1290)
 *
 * Its first item is the developer-mode switch. Then the things only a
 * developer changes or needs: which PsyNeuView the Mac app runs, which
 * PsyNeuLink is installed, where the two are installed, the installed
 * PsyNeuLink's details, the managed PsyNeuLink copies and checkouts
 * (#1295), and the update options for your own checkouts (#1304).
 */

import { useUIStore } from "@/stores/uiStore";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import type { PsyNeuLinkInfo } from "@/utils/pnlSources";
import { DeveloperBadge } from "../DeveloperBadge";
import { MacAppInstallSwitcher, MacAppReleaseCandidates } from "../MacAppSettingsSection";
import { CheckoutUpdates } from "./CheckoutUpdates";
import { InstallControls } from "./InstallControls";
import { PnlDetails } from "./PnlDetails";
import { InstallLocations, ManagedCopiesAndCheckouts, useLocations, useMacAppInstall } from "./WhereThingsLive";
import { Group, SettingLabel, errorStyle, mutedStyle } from "./shared";
import type { InstallCapabilities, SettingsInfo } from "./types";

export function DeveloperSection({
  info,
  loadError,
  capabilities,
  previousPnl,
  onInstallSucceeded,
}: {
  info: SettingsInfo | null;
  loadError: string | null;
  capabilities: InstallCapabilities | null;
  /** The install before the last successful switch, shown struck through. */
  previousPnl: PsyNeuLinkInfo | null;
  onInstallSucceeded: (snapshot: PsyNeuLinkInfo) => void;
}) {
  // One fetch of /api/locations for the two groups that read it.
  const locations = useLocations();
  const macInstall = useMacAppInstall();
  return (
    <>
      <Group id="developer-mode" title="Developer mode">
        <DeveloperModeRow />
      </Group>

      {hasSettingsBridge() && <MacAppInstallSwitcher />}
      {hasSettingsBridge() && <MacAppReleaseCandidates />}

      <Group id="pnl-install" title="Which PsyNeuLink is installed" badge={<DeveloperBadge audience="developers" />}>
        {loadError && <div style={errorStyle}>Failed to load: {loadError}</div>}
        {!loadError && !(info && capabilities) && <div style={mutedStyle}>Loading…</div>}
        {info && capabilities && (
          <InstallControls
            capabilities={capabilities}
            currentPnl={info.psyneulink}
            onInstallSucceeded={onInstallSucceeded}
          />
        )}
      </Group>

      <Group id="install-locations" title="Where PsyNeuView and PsyNeuLink are installed" badge={<DeveloperBadge audience="developers" />}>
        <InstallLocations {...locations} macInstall={macInstall} />
      </Group>

      <Group id="pnl-details" title="PsyNeuLink details" badge={<DeveloperBadge audience="developers" />}>
        {loadError && <div style={errorStyle}>Failed to load: {loadError}</div>}
        {!loadError && !info && <div style={mutedStyle}>Loading…</div>}
        {info && <PnlDetails pnl={info.psyneulink} previous={previousPnl} features={info.features} />}
      </Group>

      {/* The managed copies under ~/.psyneuview/sources, and known checkouts (#1295). */}
      <ManagedCopiesAndCheckouts {...locations} macInstall={macInstall} />

      {/* Update options for your own checkouts (#1304). */}
      {capabilities?.enabled && <CheckoutUpdates />}
    </>
  );
}

function DeveloperModeRow() {
  const developerMode = useUIStore((s) => s.developerMode);
  const setDeveloperMode = useUIStore((s) => s.setDeveloperMode);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <input
        id="developer-mode-toggle"
        data-testid="setting-developer-mode"
        type="checkbox"
        checked={developerMode}
        onChange={(e) => setDeveloperMode(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <SettingLabel title="Developer mode" htmlFor="developer-mode-toggle">
        <p style={{ margin: "0 0 4px" }}>
          Shows the parts of PsyNeuView that are still being worked on. <strong>In the Open menu:</strong> the
          catalogs under development — PsyNeuLink Examples, Reference Models and Demo Models — and a
          "Developer / Tests…" entry that opens one of PsyNeuLink's own test files as a model.{" "}
          <strong>In this section:</strong> more detail about the installed PsyNeuLink and the copies PsyNeuView
          keeps. <strong>In the Mac app:</strong> its developer menu items, and every branch in Switch Branch
          rather than the main ones.
        </p>
        <p style={{ margin: 0 }}>
          Everything it adds carries the <DeveloperBadge style={{ marginLeft: 0 }} /> badge, and the toolbar
          shows "Developer" while it is on. Turning it off hides those parts again; nothing is deleted or
          changed. Off by default.
        </p>
      </SettingLabel>
    </div>
  );
}
