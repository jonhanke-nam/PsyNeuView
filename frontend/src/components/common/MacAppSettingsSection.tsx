/**
 * The Mac app's parts of Settings (jonhanke-nam/PsyNeuView-MacApp#200).
 *
 * The settings only the Mac app can act on: which PsyNeuView install it runs
 * (PsyNeuView-MacApp#195), auto-restart, launch at login, and how Report a
 * Problem sends a report (PsyNeuView-MacApp#202). The app keeps them; these
 * parts read and write them through the pnvSettings bridge
 * (utils/macAppSettings.ts). Each section of Settings shows its part only when
 * the bridge is present (hasSettingsBridge), so in a browser none of this
 * exists.
 *
 * Since the redesign (#1290) they live where they belong rather than in one
 * "Mac app" section: the two app toggles in General, the install switcher in
 * Developer, problem reports in their own section. Each setting has this one control: the
 * app has no Settings window of its own any more (docs/settings-inventory.yaml).
 */

import { useEffect, useState } from "react";
import { hasFileBridge, pickOpenPath } from "@/utils/fileBridge";
import {
  checkInstall,
  getMacAppSettings,
  onMacAppSettingsChanged,
  setMacAppReportSetting,
  setMacAppSetting,
  switchInstall,
  type InstallChoice,
  type InstallVerdict,
  type MacAppSettings,
  type MacAppSwitchKey,
  type ReportSendWith,
} from "@/utils/macAppSettings";
import { DeveloperBadge } from "./DeveloperBadge";
import { APPLY_EXPLANATION, Group, InUseNow, PathBox, abbreviateHome } from "./settings/shared";
import { Button } from "./Button";

/** The app's settings, kept in step with it; null until the first read. */
function useMacAppSettings(): {
  settings: MacAppSettings | null;
  setSettings: (s: MacAppSettings) => void;
  loadError: string | null;
} {
  const [settings, setSettings] = useState<MacAppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getMacAppSettings()
      .then((s) => alive && setSettings(s))
      .catch((e) => alive && setLoadError(String(e?.message ?? e)));
    const off = onMacAppSettingsChanged((s) => alive && setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { settings, setSettings, loadError };
}

function LoadState({ loadError }: { loadError: string | null }) {
  if (loadError) {
    return <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)" }}>Couldn't read the Mac app's settings: {loadError}</div>;
  }
  return <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-hint)" }}>Loading…</div>;
}

/** General: the two switches the app acts on. */
export function MacAppLaunchToggles() {
  const { settings, setSettings, loadError } = useMacAppSettings();
  const [error, setError] = useState<string | null>(null);
  if (!settings) return <LoadState loadError={loadError} />;

  const toggle = async (key: MacAppSwitchKey, value: boolean) => {
    setError(null);
    setSettings({ ...settings, [key]: value }); // optimistic
    try {
      setSettings(await setMacAppSetting(key, value));
    } catch (e: any) {
      setSettings({ ...settings }); // back to what the app has
      setError(String(e?.message ?? e));
    }
  };

  return (
    <div style={{ fontSize: "var(--pnv-fs-13)" }}>
      <label style={checkRow}>
        <input
          type="checkbox"
          data-testid="setting-mac-auto-restart"
          checked={settings.autoRestart}
          onChange={(e) => toggle("autoRestart", e.target.checked)}
        />
        Restart PsyNeuView if it crashes
      </label>
      <label style={checkRow}>
        <input
          type="checkbox"
          data-testid="setting-mac-launch-at-login"
          checked={settings.launchAtLogin}
          onChange={(e) => toggle("launchAtLogin", e.target.checked)}
        />
        Open PsyNeuView when you log in
      </label>
      {error && <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/**
 * Developer ▸ Get release candidates: the app's own update notice also offers
 * test versions before everyone gets them. The app keeps the setting and
 * Sparkle reads it; an app that can't do this sends no value, and nothing
 * shows.
 */
export function MacAppReleaseCandidates() {
  const { settings, setSettings } = useMacAppSettings();
  const [error, setError] = useState<string | null>(null);
  if (typeof settings?.receiveReleaseCandidates !== "boolean") return null;

  const toggle = async (value: boolean) => {
    setError(null);
    setSettings({ ...settings, receiveReleaseCandidates: value }); // optimistic
    try {
      setSettings(await setMacAppSetting("receiveReleaseCandidates", value));
    } catch (e: any) {
      setSettings({ ...settings });
      setError(String(e?.message ?? e));
    }
  };

  return (
    <Group id="release-candidates" title="Release candidates" badge={<DeveloperBadge audience="developers" />}>
      <div style={{ fontSize: "var(--pnv-fs-13)" }}>
        <label style={checkRow}>
          <input
            type="checkbox"
            data-testid="setting-mac-release-candidates"
            checked={settings.receiveReleaseCandidates}
            onChange={(e) => toggle(e.target.checked)}
          />
          Get release candidates
        </label>
        <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-hint)", marginLeft: 20 }}>
          Your app's update notice also offers test versions before they are released to everyone.
        </div>
        {error && <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)", marginTop: 6 }}>{error}</div>}
      </div>
    </Group>
  );
}

/**
 * Developer ▸ Which PsyNeuView runs: the copy included with the app, or a
 * checkout. Folded to "Running now: …" until opened — switching is rare.
 */
export function MacAppInstallSwitcher() {
  const { settings, loadError } = useMacAppSettings();
  // The install choice being edited; starts on the one running now.
  const [choice, setChoice] = useState<"bundled" | "checkout">("bundled");
  const [path, setPath] = useState("");
  const [started, setStarted] = useState(false);
  const [verdict, setVerdict] = useState<InstallVerdict | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings || started) return;
    setStarted(true);
    setChoice(settings.install.choice);
    setPath(settings.install.checkoutPath ?? settings.install.recentCheckouts[0] ?? "");
  }, [settings, started]);

  // What Apply & Restart would do with the current choice, in the app's words.
  useEffect(() => {
    if (!settings || !started) return;
    let alive = true;
    const request: InstallChoice = choice === "bundled" ? { choice } : { choice, path };
    const timer = window.setTimeout(() => {
      checkInstall(request)
        .then((v) => alive && setVerdict(v))
        .catch((e) => alive && setVerdict({ decision: "refuse", message: String(e?.message ?? e) }));
    }, choice === "checkout" ? 250 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [settings, started, choice, path]);

  const apply = async () => {
    setError(null);
    try {
      const v = await switchInstall(choice === "bundled" ? { choice } : { choice, path });
      setVerdict(v);
      if (v.decision === "useBundled" || v.decision === "useCheckout") setSwitching(true);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const browse = async () => {
    const picked = await pickOpenPath({
      directories: true,
      message: "Choose the folder of your PsyNeuView checkout",
    });
    if (picked) {
      setChoice("checkout");
      setPath(picked);
    }
  };

  // The field shows `~` for the home folder, like the rest of Settings, while
  // the path kept and sent stays the full one (#1290). Typing `~/…` back is
  // expanded with the home folder the current path (or a recent one) is under.
  const home = homeFolder(path, ...(settings?.install.recentCheckouts ?? []));
  const onPathTyped = (typed: string) => setPath(expandHome(typed, home));

  // The button appears only when the app says the choice would switch
  // something (#1303): not while the choice is what runs now, and not when
  // the app refuses it — hidden, not greyed out, in both cases.
  const canApply =
    !switching && (verdict?.decision === "useBundled" || verdict?.decision === "useCheckout");
  const included = settings?.install.includedVersion
    ? `Included with this app (${settings.install.includedVersion}, recommended)`
    : "Included with this app (not in this build)";
  const hintColor =
    verdict?.decision === "refuse" ? "var(--pnv-warning)" : verdict?.decision === "useCheckout" ? "var(--pnv-success)" : "var(--pnv-text-muted)";
  const summary = settings ? `Running now: ${settings.install.running}` : undefined;

  return (
    <Group id="mac-install" title="Which PsyNeuView runs" summary={summary} defaultFolded badge={<DeveloperBadge audience="developers" />}>
      {!settings ? (
        <LoadState loadError={loadError} />
      ) : (
        <div style={{ fontSize: "var(--pnv-fs-13)" }}>
          <div data-testid="mac-install-running" style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", margin: "2px 0 6px" }}>
            Running now: {settings.install.running}
          </div>

          <div data-testid="setting-mac-install" role="radiogroup" aria-label="Which PsyNeuView to run">
            <label style={checkRow}>
              <input
                type="radio"
                name="mac-install"
                data-testid="mac-install-bundled"
                checked={choice === "bundled"}
                onChange={() => setChoice("bundled")}
                disabled={switching}
              />
              {included}
            </label>
            <label style={checkRow}>
              <input
                type="radio"
                name="mac-install"
                data-testid="mac-install-checkout"
                checked={choice === "checkout"}
                onChange={() => setChoice("checkout")}
                disabled={switching}
              />
              A PsyNeuView checkout:
            </label>
            {choice === "checkout" && (
              <div style={{ marginLeft: 22 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={abbreviateHome(path)}
                    onChange={(e) => onPathTyped(e.target.value)}
                    placeholder="Folder of your PsyNeuView checkout"
                    title={path}
                    data-testid="mac-install-path"
                    disabled={switching}
                    style={{
                      flex: 1, minWidth: 0, fontSize: "var(--pnv-fs-12)", padding: "3px 6px",
                      border: "1px solid var(--pnv-border)", borderRadius: 4, fontFamily: "monospace",
                    }}
                  />
                  {hasFileBridge() && (
                    <Button kind="small" size="tall" onClick={browse} disabled={switching}>
                      Browse…
                    </Button>
                  )}
                </div>
                {path && <PathBox path={path} label="Full path of the checkout" />}
                {settings.install.recentCheckouts.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)" }}>
                    Used before:{" "}
                    {settings.install.recentCheckouts.map((p) => (
                      <Button
                        key={p}
                        onClick={() => setPath(p)}
                        data-testid="mac-install-recent"
                        title={p}
                        disabled={switching}
                        kind="link" style={{ fontWeight: p === path ? 600 : 400, fontFamily: "monospace" }}
                      >
                        {abbreviateHome(p)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {verdict?.decision === "nothingToDo" && !switching && (
            <div style={{ marginTop: 6 }}>
              <InUseNow testId="mac-install-in-use">{settings.install.running}</InUseNow>
            </div>
          )}
          {verdict && verdict.decision !== "nothingToDo" && (
            <div data-testid="mac-install-hint" style={{ fontSize: "var(--pnv-fs-12)", color: hintColor, marginTop: 6 }}>
              {verdict.message}
            </div>
          )}
          {(canApply || switching) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
              <span data-testid="mac-install-apply-explanation" style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)" }}>
                Switching stops PsyNeuView and starts the one you pick. Nothing is deleted, and
                switching back is the same choice. {APPLY_EXPLANATION}
              </span>
              <Button
                onClick={apply}
                disabled={!canApply}
                data-testid="mac-install-apply"
                kind="primary"
                size="tall"
                style={{ flexShrink: 0 }}
              >
                {switching ? "Switching…" : "Apply & restart"}
              </Button>
            </div>
          )}
          {error && <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)", marginTop: 6 }}>{error}</div>}
        </div>
      )}
    </Group>
  );
}

/**
 * Problem reports: how Report a Problem offers to send a report. Its own
 * section since #1295, so it starts open there; `defaultFolded` is for a
 * host that wants it folded to its current choice.
 */
export function MacAppProblemReports({ defaultFolded = true }: { defaultFolded?: boolean } = {}) {
  const { settings, setSettings, loadError } = useMacAppSettings();
  // "Send to" as typed; saved when the field loses focus or on Enter.
  const [sendToDraft, setSendToDraft] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // An app build from before PsyNeuView-MacApp#202 has no report settings.
  if (settings && settings.reportSendWith === undefined) return null;

  const setReport = async (key: "reportSendWith" | "reportSendTo", value: string) => {
    if (!settings) return;
    setReportError(null);
    try {
      setSettings(await setMacAppReportSetting(key, value));
      if (key === "reportSendTo") setSendToDraft(null);
    } catch (e: any) {
      setReportError(String(e?.message ?? e));
    }
  };

  const commitSendTo = () => {
    if (!settings || sendToDraft === null || sendToDraft === (settings.reportSendTo ?? "")) return;
    void setReport("reportSendTo", sendToDraft);
  };

  const summary = settings
    ? `Send with ${SEND_WITH_LABELS[settings.reportSendWith ?? "ask"]}, to ${
        settings.reportSendTo || settings.reportSendToDefault || "the PsyNeuView team"
      }`
    : undefined;

  return (
    <Group id="problem-reports" title="Problem reports" summary={summary} defaultFolded={defaultFolded}>
      {!settings ? (
        <LoadState loadError={loadError} />
      ) : (
        <div style={{ fontSize: "var(--pnv-fs-13)" }}>
          <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", margin: "2px 0 6px" }}>
            Help ▸ Report a Problem… saves a report folder in Downloads. These choose how it
            offers to send it.
          </div>
          <label style={fieldRow}>
            <span style={fieldLabel}>Send reports with</span>
            <select
              data-testid="setting-mac-report-send-with"
              value={settings.reportSendWith}
              onChange={(e) => setReport("reportSendWith", e.target.value as ReportSendWith)}
              style={{ fontSize: "var(--pnv-fs-12)", padding: "2px 4px" }}
            >
              <option value="ask">Ask each time (show every way)</option>
              <option value="mail">Mail app</option>
              <option value="outlook">Outlook</option>
              <option value="gmail">Gmail (web)</option>
            </select>
          </label>
          <label style={fieldRow}>
            <span style={fieldLabel}>Send to</span>
            <input
              type="email"
              data-testid="setting-mac-report-send-to"
              value={sendToDraft ?? settings.reportSendTo ?? ""}
              placeholder={settings.reportSendToDefault ?? "an email address"}
              onChange={(e) => setSendToDraft(e.target.value)}
              onBlur={commitSendTo}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSendTo();
              }}
              style={{
                flex: 1, minWidth: 0, fontSize: "var(--pnv-fs-12)", padding: "3px 6px",
                border: "1px solid var(--pnv-border)", borderRadius: 4,
              }}
            />
          </label>
          {settings.reportSendToDefault && (
            <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", marginLeft: 118 }}>
              Leave empty to send to {settings.reportSendToDefault}.
            </div>
          )}
          {reportError && (
            <div data-testid="mac-report-error" style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)", marginTop: 6 }}>
              {reportError}
            </div>
          )}
        </div>
      )}
    </Group>
  );
}

const SEND_WITH_LABELS: Record<ReportSendWith, string> = {
  ask: "a choice each time",
  mail: "the Mail app",
  outlook: "Outlook",
  gmail: "Gmail",
};

/** The `/Users/<name>` any of these paths is under, if one is. */
function homeFolder(...paths: string[]): string | null {
  for (const p of paths) {
    const m = p.match(/^\/Users\/[^/]+/);
    if (m) return m[0];
  }
  return null;
}

/** `~/x` typed in the field → `<home>/x`; anything else as typed. */
function expandHome(typed: string, home: string | null): string {
  if (home && (typed === "~" || typed.startsWith("~/"))) return home + typed.slice(1);
  return typed;
}

const checkRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer",
};
const fieldRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "2px 0",
};
const fieldLabel: React.CSSProperties = { width: 110, flexShrink: 0, fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-body)" };
