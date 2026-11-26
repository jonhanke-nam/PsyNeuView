/**
 * An app update is waiting (PsyNeuView-MacApp#6), ready to install on quit,
 * or just installed (PsyNeuView-MacApp#79), and the one-time question whether
 * to install updates automatically (#79: consent first, default off).
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
  answerAutoInstallOffer,
  dismissJustUpdated,
  getMacAppSettings,
  hasSettingsBridge,
  installAndRelaunch,
  installMacAppUpdate,
  onAppUpdateReady,
  onMacAppSettingsChanged,
  type MacAppSettings,
} from "@/utils/macAppSettings";
import { AutoInstallOffer } from "@/components/common/AutoInstallOffer";
import {
  loadDismissal,
  noticeKind,
  readyNoticeText,
  saveDismissal,
  updatedNoticeText,
  updateNoticeText,
  type Dismissal,
} from "@/utils/appUpdateNotice";

type Shown = Pick<MacAppSettings, "appUpdate" | "justUpdated" | "autoInstallOffer">;

const pick = (s: MacAppSettings): Shown => ({
  appUpdate: s.appUpdate,
  justUpdated: s.justUpdated,
  autoInstallOffer: s.autoInstallOffer,
});

export function AppUpdateNotice() {
  const [shown, setShown] = useState<Shown | null>(null);
  // Closed without an answer (× or Escape): asked again at the next launch.
  const [offerClosed, setOfferClosed] = useState(false);
  const [dismissal, setDismissal] = useState<Dismissal | null>(() => loadDismissal());
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    if (!hasSettingsBridge()) return;
    let live = true;
    getMacAppSettings()
      .then((s) => live && setShown(pick(s)))
      .catch(() => {});
    const stop = onMacAppSettingsChanged((s) => setShown(pick(s)));
    // Downloaded and installs on quit (PsyNeuView-MacApp#79).
    const stopReady = onAppUpdateReady((version) =>
      setShown((prev) => ({
        ...prev,
        appUpdate: { ...prev?.appUpdate, available: true, version, readyToInstall: true },
      })),
    );
    return () => {
      live = false;
      stop();
      stopReady();
    };
  }, []);

  const update = shown?.appUpdate ?? null;
  const kind = noticeKind(update, shown?.justUpdated, dismissal, Date.now());
  const notesURL = kind === "updated" ? shown?.justUpdated?.releaseNotesURL : update?.releaseNotesURL;
  const fail = (what: string) => (e: any) => addNotification("error", `${what}: ${e?.message || e}`);

  return (
    <>
      <AutoInstallOffer
        open={!!shown?.autoInstallOffer && !offerClosed}
        onClose={() => setOfferClosed(true)}
        onAnswer={(yes) => {
          setOfferClosed(true);
          answerAutoInstallOffer(yes)
            .then((s) => setShown(pick(s)))
            .catch(fail("Couldn't save your choice"));
        }}
      />
      {kind && (
        <div role="status" data-testid="app-update-notice" data-kind={kind} style={noticeStyle}>
          <span
            data-testid="app-update-text"
            title={kind !== "updated" && update?.releasedAt ? `Released ${new Date(update.releasedAt).toLocaleString()}` : undefined}
          >
            {kind === "ready"
              ? readyNoticeText(update!)
              : kind === "available"
                ? updateNoticeText(update!)
                : updatedNoticeText(shown!.justUpdated!.version)}
          </span>
          {notesURL && (
            <a href={notesURL} target="_blank" rel="noreferrer" data-testid="app-update-notes" style={linkStyle}>
              What's new
            </a>
          )}
          {kind === "ready" && (
            <Button kind="small" data-testid="app-update-restart" onClick={() => installAndRelaunch().catch(fail("Couldn't restart"))}>
              Restart now
            </Button>
          )}
          {kind === "available" && (
            <Button
              kind="small"
              data-testid="app-update-install"
              onClick={() => installMacAppUpdate().catch(fail("Couldn't open the update"))}
            >
              Install and restart
            </Button>
          )}
          {kind === "updated" ? (
            <Button
              kind="link"
              data-testid="app-update-dismiss"
              style={ON_TINT}
              onClick={() => {
                setShown((prev) => (prev ? { ...prev, justUpdated: null } : prev));
                void dismissJustUpdated();
              }}
            >
              OK
            </Button>
          ) : (
            <Button
              kind="link"
              data-testid="app-update-later"
              style={ON_TINT}
              title="Hide this for a day"
              onClick={() => setDismissal(saveDismissal(update!.version!, Date.now()))}
            >
              Later
            </Button>
          )}
        </div>
      )}
    </>
  );
}

const noticeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
  padding: "2px 4px 2px 10px",
  fontSize: "var(--pnv-fs-12)",
  color: "var(--pnv-text)",
  background: "var(--pnv-primary-tint)",
  border: "1px solid var(--pnv-primary-tint-border)",
  borderRadius: 4,
  whiteSpace: "nowrap",
};

// On the notice's blue tint the primary blue reads below WCAG AA (3.9:1);
// the deeper blue made for text on a tint passes.
const ON_TINT: React.CSSProperties = { color: "var(--pnv-primary-deep)" };
const linkStyle: React.CSSProperties = { ...ON_TINT, fontSize: "var(--pnv-fs-12)" };
