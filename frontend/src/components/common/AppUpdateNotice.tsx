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
import {
  AUTO_INSTALL_QUESTION,
  AUTO_INSTALL_QUESTION_HINT,
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
      {shown?.autoInstallOffer && (
        <AutoInstallOffer
          onAnswer={(yes) => {
            setShown((prev) => (prev ? { ...prev, autoInstallOffer: false } : prev));
            answerAutoInstallOffer(yes)
              .then((s) => setShown(pick(s)))
              .catch(fail("Couldn't save your choice"));
          }}
        />
      )}
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

/**
 * The one-time question (PsyNeuView-MacApp#79): consent first, automatic
 * install is off until the user says yes. Asked once, after setup; the app
 * keeps the answer and never asks again. A small card, not a modal.
 */
function AutoInstallOffer({ onAnswer }: { onAnswer: (yes: boolean) => void }) {
  return (
    <div role="dialog" aria-label="Automatic updates" data-testid="auto-install-offer" style={offerStyle}>
      <div style={{ fontWeight: 600 }}>{AUTO_INSTALL_QUESTION}</div>
      <div style={{ color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-12)", marginTop: 2 }}>{AUTO_INSTALL_QUESTION_HINT}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
        <Button kind="small" data-testid="auto-install-offer-no" onClick={() => onAnswer(false)}>
          No, ask me each time
        </Button>
        <Button kind="primary" data-testid="auto-install-offer-yes" onClick={() => onAnswer(true)}>
          Yes, install automatically
        </Button>
      </div>
    </div>
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

const linkStyle: React.CSSProperties = { color: "var(--pnv-primary)", fontSize: "var(--pnv-fs-12)" };

const offerStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 1000,
  maxWidth: 360,
  padding: "10px 12px",
  fontSize: "var(--pnv-fs-13)",
  color: "var(--pnv-text)",
  background: "var(--pnv-surface)",
  border: "1px solid var(--pnv-border)",
  borderRadius: 6,
  boxShadow: "var(--pnv-shadow-popover)",
  whiteSpace: "normal",
};
