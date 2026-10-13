/**
 * Settings ▸ About: versions and links, simply. (#1290, #1295)
 *
 * First in the sidebar, because it is what a new user and a problem report
 * both need: which PsyNeuView and PsyNeuLink this is, in one line each. The
 * PsyNeuLink details (repo, branch, commit, freshness, debugging support)
 * are Developer's, and the other folders are Folders'. The Mac app's bridge
 * has no app version of its own, so none is shown.
 *
 * And what PsyNeuView is running, and from where (#1356): the Mac app's
 * included copy or your checkout (the one path shown here, since which
 * folder it is *is* the answer), a checkout's branch, commit and how far
 * behind devel it is as last fetched, with Check now; and a warning when
 * this page and the server come from different versions.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { downloadDiagnostics } from "@/utils/diagnostics";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import { pnlSourceLabel, type PsyNeuLinkInfo } from "@/utils/pnlSources";
import {
  checkRunningNow,
  checkoutLines,
  fetchRunning,
  isDevServer,
  mismatch,
  pageBuild,
  pageBuildLine,
  whereLine,
  type RunningInfo,
} from "@/utils/runningFrom";
import { TONE_COLOR } from "./PnlUpdateStatus";
import { Group, Row, errorStyle, linkStyle, mutedStyle } from "./shared";
import type { GithubAuthInfo, SettingsInfo } from "./types";
import { Button } from "../Button";

export function AboutSection({ info, loadError }: { info: SettingsInfo | null; loadError: string | null }) {
  const running = useRunning();
  const page = pageBuild();
  const dev = isDevServer(page);
  const warning = running.info ? mismatch(running.info, page, dev) : null;
  return (
    <Group id="about" title="About PsyNeuView">
      {warning && <MismatchNote text={warning.text} reload={warning.action === "reload"} id={warning.id} />}
      {loadError && <div style={errorStyle}>Failed to load: {loadError}</div>}
      {!loadError && !info && <div style={mutedStyle}>Loading…</div>}
      {info && (
        <div style={{ fontSize: 13 }}>
          <Row label="PsyNeuView version" value={info.psyneuview.version} />
          <RunningFrom {...running} />
          <Row label="Server commit" value={running.info?.started_commit ?? info.psyneuview.commit} mono />
          <div data-testid="about-page-build">
            <Row label="Page built from" value={pageBuildLine(page, dev)} />
          </div>
          <Row label="PsyNeuLink" value={formatPsyNeuLinkLine(info.psyneulink)} />
          <Row label="ModECI MDF" value={info.modeci_mdf.version ?? "not installed"} />
          <Row label="GitHub sign-in" value={formatGithubAuth(info.github_auth)} />
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 12 }}>
        <a href="https://github.com/jonhanke-nam/PsyNeuView" target="_blank" rel="noreferrer" style={linkStyle}>
          PsyNeuView on GitHub
        </a>
        {"  ·  "}
        <a href="https://github.com/PrincetonUniversity/PsyNeuLink" target="_blank" rel="noreferrer" style={linkStyle}>
          PsyNeuLink
        </a>
      </div>
      {info && (
        <div style={{ ...mutedStyle, marginTop: 8 }}>
          Where everything is kept: Folders. The PsyNeuLink details, and changing it: Developer.
        </div>
      )}
      {/* In the Mac app, Help ▸ Report a Problem… gathers the same thing (#1287). */}
      {!hasSettingsBridge() && <DownloadDiagnostics />}
    </Group>
  );
}

/** `/api/settings/running` for this page, fetched when About opens, and Check now. */
function useRunning() {
  const [info, setInfo] = useState<RunningInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRunning()
      .then((r) => !cancelled && setInfo(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const checkNow = useCallback(async () => {
    setBusy(true);
    setCheckError(null);
    try {
      const r = await checkRunningNow();
      setInfo(r);
      if (r.fetched === false) setCheckError(r.fetch_error ?? "Couldn't fetch.");
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { info, error, busy, checkError, checkNow };
}

/** A label and anything under it, laid out as `Row` lays out a label and its value. */
function LabelledBlock({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: "flex", padding: "4px 0", gap: 12 }}>
      <div style={{ width: 160, color: "var(--pnv-text-secondary)", flexShrink: 0 }}>{label}</div>
      <div style={{ color: "var(--pnv-text)", minWidth: 0, overflowWrap: "anywhere", flex: 1 }}>{children}</div>
    </div>
  );
}

/**
 * Running from (#1356): where, in one line, and for a checkout its branch,
 * commit, files changed and how it stands against devel as last fetched,
 * with Check now (a fetch, with a timeout; nothing is pulled).
 */
function RunningFrom({
  info,
  error,
  busy,
  checkError,
  checkNow,
}: ReturnType<typeof useRunning>) {
  return (
    <LabelledBlock label="Running from" testId="about-running">
      {error && <span style={errorStyle}>Couldn&apos;t find out: {error}</span>}
      {!error && !info && <span style={mutedStyle}>Finding out…</span>}
      {info && (
        <>
          <div data-testid="about-running-where" data-kind={info.kind}>{whereLine(info)}</div>
          {checkoutLines(info).map((line) => (
            <div
              key={line.id}
              data-testid="about-running-line"
              data-line-id={line.id}
              style={{ fontSize: 12, lineHeight: 1.4, marginTop: 2, color: TONE_COLOR[line.tone] }}
            >
              {line.text}
            </div>
          ))}
          {info.kind === "checkout" && info.git && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <Button
                data-testid="about-running-check-now"
                kind="small"
                disabled={busy}
                onClick={() => void checkNow()}
                title="Fetch from the remote and compare again; nothing is pulled"
              >
                {busy ? "Checking…" : "Check now"}
              </Button>
              {checkError && (
                <span data-testid="about-running-check-error" style={errorStyle}>
                  Couldn&apos;t check: {checkError}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </LabelledBlock>
  );
}

/** The page and the server disagree (#1356): say so first, in an amber box. */
function MismatchNote({ text, reload, id }: { text: string; reload: boolean; id: string }) {
  return (
    <div
      data-testid="about-mismatch"
      data-mismatch={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 12,
        lineHeight: 1.4,
        padding: "6px 10px",
        marginBottom: 8,
        background: "var(--pnv-warning-tint)",
        border: "1px solid var(--pnv-warning-border)",
        borderRadius: 4,
        color: "var(--pnv-warning-text-on-tint)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {reload && (
        <Button data-testid="about-mismatch-reload" kind="small" onClick={() => window.location.reload()}>
          Reload
        </Button>
      )}
    </div>
  );
}

/**
 * Download diagnostics (#1287): the versions, settings, the open model's name
 * and where it came from, and the activity since the page opened, as one JSON
 * file for a problem report. An action, not a setting, so it is always shown;
 * the Mac app has it inside Report a Problem instead.
 */
function DownloadDiagnostics() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 14 }} data-testid="diagnostics-download">
      <Button
        data-testid="download-diagnostics"
        kind="small"
        onClick={() => {
          setError(null);
          downloadDiagnostics().catch((e) => setError(String(e)));
        }}
      >
        Download diagnostics
      </Button>
      <div style={{ ...mutedStyle, marginTop: 4 }}>
        Saves a file with the versions and settings, the open model&apos;s name and where it came from, and what
        happened since this page opened, to send with a problem report. No model contents; your home folder is
        shown as ~.
      </div>
      {error && <div style={errorStyle}>Couldn&apos;t save the file: {error}</div>}
    </div>
  );
}

/** "PsyNeuLink 0.19.1.0, from PrincetonUniversity/PsyNeuLink @ devel". */
export function formatPsyNeuLinkLine(pnl: PsyNeuLinkInfo): string {
  if (!pnl.version) return "not installed";
  const source = pnlSourceLabel(pnl);
  return `PsyNeuLink ${pnl.version}${source ? `, ${source}` : ""}`;
}

function formatGithubAuth(auth: GithubAuthInfo): string {
  if (auth.source === "none" || !auth.user) {
    return "unauthenticated (public repos only)";
  }
  const sourceLabel =
    auth.source === "gh_cli"
      ? "via gh CLI"
      : auth.source.startsWith("env:")
        ? `via ${auth.source.slice(4)}`
        : `via ${auth.source}`;
  const scopeNote = auth.has_repo_scope ? "repo scope" : "no repo scope";
  return `${auth.user} ${sourceLabel} (${scopeNote})`;
}
