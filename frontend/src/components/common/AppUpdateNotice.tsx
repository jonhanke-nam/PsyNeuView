/**
 * An app update is waiting (PsyNeuView-MacApp#6).
 *
 * Inside the Mac app, a small notice in the toolbar says a newer version is
 * ready. Install… opens the app's own update window; Later hides it for that
 * version for a day. The app supplies the state through its settings bridge
 * (`appUpdate`), so this works only inside the app; in a browser, or with an
 * app from before #6, nothing shows.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  getMacAppSettings,
  hasSettingsBridge,
  installMacAppUpdate,
  onMacAppSettingsChanged,
  type MacAppUpdate,
} from "@/utils/macAppSettings";
import { loadDismissal, saveDismissal, shouldShowUpdateNotice, updateNoticeText, type Dismissal } from "@/utils/appUpdateNotice";

export function AppUpdateNotice() {
  const [update, setUpdate] = useState<MacAppUpdate | null>(null);
  const [dismissal, setDismissal] = useState<Dismissal | null>(() => loadDismissal());
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    if (!hasSettingsBridge()) return;
    let live = true;
    getMacAppSettings()
      .then((s) => live && setUpdate(s.appUpdate ?? null))
      .catch(() => {});
    const stop = onMacAppSettingsChanged((s) => setUpdate(s.appUpdate ?? null));
    return () => {
      live = false;
      stop();
    };
  }, []);

  if (!shouldShowUpdateNotice(update, dismissal, Date.now())) return null;
  const version = update!.version!;

  return (
    <div
      role="status"
      data-testid="app-update-notice"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        padding: "2px 4px 2px 10px",
        fontSize: 12,
        color: "var(--pnv-text)",
        background: "var(--pnv-primary-tint)",
        border: "1px solid var(--pnv-primary-tint-border)",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      <span
        data-testid="app-update-text"
        title={update!.releasedAt ? `Released ${new Date(update!.releasedAt).toLocaleString()}` : undefined}
      >
        {updateNoticeText(update!)}
      </span>
      <Button
        kind="small"
        data-testid="app-update-install"
        onClick={() => {
          installMacAppUpdate().catch((e: any) =>
            addNotification("error", `Couldn't open the update: ${e?.message || e}`),
          );
        }}
      >
        Install…
      </Button>
      <Button
        kind="link"
        data-testid="app-update-later"
        title="Hide this for a day"
        onClick={() => setDismissal(saveDismissal(version, Date.now()))}
      >
        Later
      </Button>
    </div>
  );
}
