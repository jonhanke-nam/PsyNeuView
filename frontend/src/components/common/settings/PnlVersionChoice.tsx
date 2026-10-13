/**
 * General ▸ PsyNeuLink version: the simple view of which PsyNeuLink is
 * installed (#1295 round 4, releases in round 5).
 *
 * Two choices for everyone — the latest development branch (recommended,
 * and the default for a new user) or an official PyPI release, picked from
 * every release with its date — editing the same setting as Developer ▸
 * Which PsyNeuLink is installed, through the same install mechanism
 * (useInstallJob). When the installed PsyNeuLink is anything else — another
 * repo or branch, a checkout — the radios would mislead, so this says
 * "Custom — chosen in Developer" with the source, its path and a link.
 */

import { useEffect, useState } from "react";
import {
  RECOMMENDED_PNL_CHOICE,
  SIMPLE_PNL_CHOICES,
  defaultReleaseVersion,
  expectedWait,
  formatInstallSummary,
  officialVersionOf,
  releaseOptionLabel,
  releaseOptionState,
  simpleChoiceOf,
  switchSummary,
  type InstallForm,
  type PsyNeuLinkInfo,
  type SimplePnlChoice,
} from "@/utils/pnlSources";
import { openSettings } from "./sections";
import { ApplyExplanation, GROUP_INDENT, InUseNow, PathBox, errorStyle, linkStyle, mutedStyle, selectStyle } from "./shared";
import type { InstallCapabilities, PnlFreshness } from "./types";
import { formatJobElapsed, useInstallJob } from "./useInstallJob";
import { useReleases } from "./useReleases";
import { Button } from "../Button";

/** When the development branch last moved, from the freshness check; null when it can't say. */
function useBranchDate(pnl: PsyNeuLinkInfo): string | null {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings/pnl-freshness")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PnlFreshness | null) => alive && setDate(data?.head_date ? data.head_date.slice(0, 10) : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pnl.version, pnl.branch]);
  return date;
}

export function PnlVersionChoice({
  capabilities,
  currentPnl,
  onInstallSucceeded,
}: {
  capabilities: InstallCapabilities;
  currentPnl: PsyNeuLinkInfo;
  onInstallSucceeded: (snapshot: PsyNeuLinkInfo) => void;
}) {
  const inUse = simpleChoiceOf(currentPnl);
  const inUseVersion = officialVersionOf(currentPnl);
  const [chosen, setChosen] = useState<SimplePnlChoice>(inUse === "official" ? "official" : RECOMMENDED_PNL_CHOICE);
  const releases = useReleases();
  const branchDate = useBranchDate(currentPnl);
  const [version, setVersion] = useState<string | null>(null);
  // After a switch the installed one changes; the choice follows it.
  useEffect(() => {
    if (inUse === "latest" || inUse === "official") setChosen(inUse);
  }, [inUse]);
  // The dropdown starts on the release in use, else the newest that can install.
  useEffect(() => {
    if (releases) setVersion(defaultReleaseVersion(releases.releases, inUseVersion));
  }, [releases, inUseVersion]);
  const { job, submitError, isRunning, isDone, submit } = useInstallJob({ currentPnl, onInstallSucceeded });

  if (!capabilities.enabled) {
    return (
      <div style={mutedStyle}>
        {capabilities.reason === "unavailable_in_deployment"
          ? "The PsyNeuLink version is fixed by this deployment's image and can't be changed from here."
          : "Changing the PsyNeuLink version is disabled (loopback-only)."}
      </div>
    );
  }

  const toDeveloper = (
    <Button
      onClick={() => openSettings("developer")}
      kind="link"
    >
      Change in Developer
    </Button>
  );

  if (inUse === "custom" || inUse === null) {
    return (
      <div data-testid="pnl-version-custom" style={{ fontSize: 13 }}>
        <div style={{ fontWeight: 500 }}>Custom — chosen in Developer</div>
        <div style={{ paddingLeft: GROUP_INDENT }}>
          <div data-testid="pnl-version-custom-source" style={{ marginTop: 2 }}>
            {inUse === null ? "Not detected" : formatInstallSummary(currentPnl)}
          </div>
          {currentPnl.path && <PathBox path={currentPnl.path} />}
          <div style={{ ...mutedStyle, marginTop: 2 }}>{toDeveloper}</div>
        </div>
      </div>
    );
  }

  const chosenRelease = releases?.releases.find((r) => r.version === version) ?? null;
  const form: InstallForm =
    chosen === "official" && version ? { ...SIMPLE_PNL_CHOICES.official.form, version } : SIMPLE_PNL_CHOICES[chosen].form;
  // The button appears only when pressing it would change something (#1303).
  const summary = switchSummary(form, currentPnl);
  const differs = summary !== null;
  const latestDescription = `${SIMPLE_PNL_CHOICES.latest.description}${branchDate ? ` · last updated ${branchDate}` : ""}`;

  return (
    <div style={{ fontSize: 13 }}>
      <div data-testid="setting-pnl-version" role="radiogroup" aria-label="PsyNeuLink version">
        {(Object.keys(SIMPLE_PNL_CHOICES) as SimplePnlChoice[]).map((key) => {
          const choice = SIMPLE_PNL_CHOICES[key];
          return (
            <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0", cursor: isRunning ? "default" : "pointer" }}>
              <input
                type="radio"
                name="pnl-version"
                data-testid={`pnl-version-${key}`}
                checked={chosen === key}
                disabled={isRunning}
                onChange={() => setChosen(key)}
                style={{ marginTop: 3 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{choice.label}</span>
                {key === RECOMMENDED_PNL_CHOICE && <span style={{ color: "var(--pnv-text-muted)" }}> (recommended)</span>}
                {inUse === key && (
                  <span
                    data-testid="pnl-version-in-use"
                    style={{ marginLeft: 6, fontSize: 10, color: "var(--pnv-success)", border: "1px solid var(--pnv-success)", borderRadius: 3, padding: "0 4px" }}
                  >
                    in use{key === "official" && inUseVersion ? ` · ${inUseVersion}` : ""}
                  </span>
                )}
                <span style={{ ...mutedStyle, display: "block" }}>{key === "latest" ? latestDescription : choice.description}</span>
                {key === "official" && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    {releases === null && <span style={mutedStyle}>Finding the releases…</span>}
                    {releases && releases.releases.length === 0 && (
                      <span style={mutedStyle}>
                        {releases.offline ? "PyPI can't be reached and no release is kept locally; the newest release is installed when it can." : "No releases listed."}
                      </span>
                    )}
                    {releases && releases.releases.length > 0 && (
                      <select
                        data-testid="pnl-version-release"
                        value={version ?? ""}
                        onChange={(e) => {
                          setVersion(e.target.value);
                          setChosen("official");
                        }}
                        disabled={isRunning}
                        style={{ ...selectStyle, flex: "none", fontFamily: "monospace", fontSize: 12, maxWidth: "100%" }}
                      >
                        {releases.releases.map((r) => {
                          const state = releaseOptionState(r);
                          return (
                            <option key={r.version} value={r.version} disabled={state.disabled} title={state.title}>
                              {releaseOptionLabel(r)}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {releases?.offline && releases.releases.length > 0 && (
                      <span data-testid="pnl-version-offline" style={{ ...mutedStyle, display: "block" }}>
                        PyPI can't be reached right now: this is the last list seen, and the kept releases.
                      </span>
                    )}
                    {chosenRelease?.kept && (
                      <span style={{ ...mutedStyle, display: "block" }}>
                        Kept locally: switching back reuses the kept PsyNeuLink download; a release whose dependencies differ may still need the network.
                      </span>
                    )}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <div style={{ ...mutedStyle, marginTop: 4 }}>
        One PsyNeuLink is in use at a time. Another repo, branch or your own checkout: {toDeveloper}
      </div>
      {chosen === "official" && chosenRelease?.limited && !isRunning && (
        <div data-testid="pnl-version-limited" style={{ fontSize: 12, color: "var(--pnv-warning)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)", borderRadius: 4, padding: "6px 8px", marginTop: 6 }}>
          ⚠ {chosenRelease.limited_reason ?? "An older release: no run stepping."} Models still load and run.
        </div>
      )}
      {!differs && !isRunning && (
        <div style={{ marginTop: 6 }}>
          <InUseNow testId="pnl-version-in-use-now">{formatInstallSummary(currentPnl)}</InUseNow>
        </div>
      )}
      {differs && !isRunning && (
        <div data-testid="install-switch-summary" style={{ fontSize: 12, color: "var(--pnv-primary-text-on-tint)", background: "var(--pnv-primary-tint)", border: "1px solid var(--pnv-primary-tint-border)", borderRadius: 4, padding: "6px 8px", marginTop: 6 }}>
          {summary}
        </div>
      )}
      {differs && !isRunning && (
        <div style={{ marginTop: 4 }}>
          <ApplyExplanation testId="pnl-version-apply-explanation" />
        </div>
      )}
      {(differs || isRunning) && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 6 }}>
          {!isRunning && (
            <span style={{ fontSize: 11, color: "var(--pnv-text-hint)" }}>
              Switching reinstalls PsyNeuLink and restarts the model runner. Expected wait:{" "}
              {chosenRelease?.kept ? "a few seconds" : expectedWait(form, currentPnl)}
            </span>
          )}
          <Button
            onClick={() => submit(form)}
            disabled={isRunning || (chosen === "official" && !!releases && releases.releases.length > 0 && !version)}
            data-testid="pnl-version-apply"
            kind="primary"
            size="compact"
          >
            {isRunning ? "Installing…" : "Apply & restart"}
          </Button>
        </div>
      )}
      {submitError && <div style={{ ...errorStyle, marginTop: 6 }}>{submitError}</div>}
      {job && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--pnv-text-secondary)" }}>
          Status: <strong>{job.status}</strong>
          {formatJobElapsed(job) && <span style={{ color: "var(--pnv-text-hint)" }}> — {formatJobElapsed(job)}</span>}
          {isDone && job.status === "succeeded" && (
            <div style={{ marginTop: 4, color: "var(--pnv-success)" }}>✓ Install succeeded. The Open menu's Library, Examples and Tests now list it.</div>
          )}
          {isDone && job.status === "failed" && (
            <div style={{ ...errorStyle, marginTop: 4 }}>Install failed. Developer ▸ Which PsyNeuLink is installed has the full log.</div>
          )}
          {job.log.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", color: "var(--pnv-text-hint)" }}>Log</summary>
              <pre style={{ background: "var(--pnv-code-bg)", color: "var(--pnv-code-text)", fontSize: 11, padding: 8, borderRadius: 4, maxHeight: 140, overflowY: "auto", margin: "4px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {job.log.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
