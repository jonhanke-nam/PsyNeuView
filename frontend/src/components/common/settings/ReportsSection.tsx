/**
 * Settings ▸ Problem reports: how Report a Problem sends a report. (#1295)
 *
 * The Mac app's section: it is listed only when the pnvSettings bridge is
 * present (sections.ts, `macAppOnly`), and its two settings are the app's
 * (PsyNeuView-MacApp#202). Open from the start, since the section is its
 * own. Report a Problem itself is a menu item of the app; there is no bridge
 * op to open it from here, and none is needed.
 */

import { hasSettingsBridge } from "@/utils/macAppSettings";
import { MacAppProblemReports } from "../MacAppSettingsSection";
import { mutedStyle } from "./shared";

export function ReportsSection() {
  if (!hasSettingsBridge()) return null;
  return (
    <>
      <MacAppProblemReports defaultFolded={false} />
      <div style={mutedStyle}>
        <strong>Help ▸ Report a Problem…</strong> makes a report: a screenshot, the versions, the last log
        lines and your description, saved to Downloads and ready to send.
      </div>
    </>
  );
}
