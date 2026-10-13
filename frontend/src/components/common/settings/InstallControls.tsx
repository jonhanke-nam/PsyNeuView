/**
 * Settings ▸ Developer ▸ Which PsyNeuLink is installed: what is in use, one
 * "Switch to" dropdown of everything it can be switched to, and the known
 * sources to manage. (#130, #1276; moved here from SettingsPanel in #1290;
 * the dropdown in #1331)
 *
 * The dropdown starts with "Another local checkout…" and "Another GitHub
 * repo or branch…", which open the Path or the Repo and Branch fields, then
 * the known sources in groups that fold (#1334) — your checkouts, one group
 * per GitHub repo, the official releases — only the group holding the one
 * in use open at first. A known source shows its full name and what the
 * switch changes; no fields. Apply & restart appears only for a valid
 * choice that differs from what is in use (docs/settings-etiquette.md §10);
 * what is missing is said in a line instead. Rename and Remove live under
 * "Manage known sources", folded.
 *
 * A path typed under "Another local checkout…" is checked as soon as typing
 * pauses (#1342), and what was found is said under the Path field: a
 * PsyNeuLink checkout; an empty or missing folder, with the offer to
 * download PsyNeuLink into it; or neither, in plain words, with no button.
 *
 * Gated by `/api/settings/install/capabilities`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "../Combobox";
import { useNotificationStore } from "@/stores/notificationStore";
import { hasFileBridge, pickOpenPath } from "@/utils/fileBridge";
import { formatJobElapsed, useInstallJob } from "./useInstallJob";
import { PnlRecordNotice } from "./PnlRecordNotice";
import { newestInstallableRelease, useReleases } from "./useReleases";
import {
  DEFAULT_DOWNLOAD_SOURCE,
  DEFAULT_GITHUB_REPO,
  downloadSourceName,
  downloadSourceValue,
  downloadSources,
  dropPlaceholderSources,
  expectedWait,
  findSwitchOption,
  formForChoice,
  formatInstallSummary,
  installFormProblem,
  parseSwitchChoice,
  somethingToApply,
  sourceFullName,
  sourceOptionName,
  switchGroups,
  switchSummary,
  type LocalFolderCheck,
  type PnlSourceEntry,
  type PsyNeuLinkInfo,
  type SwitchChoice,
  type SwitchOption,
} from "@/utils/pnlSources";
import { SwitchListbox } from "./SwitchListbox";
import type { InstallCapabilities } from "./types";
import { ApplyExplanation, BreakAfterSlashes, InUseNow, errorStyle, inputStyle, mutedStyle, selectStyle } from "./shared";
import { Button } from "../Button";

const SWITCH_LABEL_ID = "pnl-switch-label";

export function InstallControls({
  capabilities,
  currentPnl,
  onInstallSucceeded,
}: {
  capabilities: InstallCapabilities;
  currentPnl: PsyNeuLinkInfo;
  onInstallSucceeded: (snapshot: PsyNeuLinkInfo) => void;
}) {
  // Nothing chosen until the user picks: the status line says what is in use.
  const [choice, setChoice] = useState<SwitchChoice | null>(null);
  const [open, setOpen] = useState(false);
  // The fields behind the two "Another…" rows.
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  // Where an empty folder is filled from (#1342): "Latest development" unless changed.
  const [downloadFrom, setDownloadFrom] = useState(downloadSourceValue(DEFAULT_DOWNLOAD_SOURCE));
  const logRef = useRef<HTMLPreElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const knownSources = useKnownSources(capabilities.enabled);
  // The official releases, with their dates, and which one "PyPI" without a
  // version would install, so the button appears only when that isn't the
  // one installed (#1303).
  const releases = useReleases(capabilities.enabled);
  const applyOptions = useMemo(() => ({ newestRelease: newestInstallableRelease(releases) }), [releases]);
  const groups = useMemo(
    () => switchGroups(knownSources.sources, releases?.releases ?? null, currentPnl, applyOptions),
    [knownSources.sources, releases, currentPnl, applyOptions],
  );
  const chosen = findSwitchOption(groups, choice);
  const typedPath = choice?.kind === "other-local" ? path.trim() : "";
  const folder = useFolderCheck(typedPath);
  const fillFrom = useMemo(() => downloadSources(knownSources.sources), [knownSources.sources]);
  const download = fillFrom.find((d) => downloadSourceValue(d) === downloadFrom) ?? DEFAULT_DOWNLOAD_SOURCE;
  const typedForm = formForChoice(choice, groups, { repo, ref, path });
  // An empty or missing folder is a download into it (#1342).
  const form =
    typedForm && typedPath && folder.state === "checked" && folder.check.status === "downloadable"
      ? { ...typedForm, download }
      : typedForm;
  // Still checking, or not a folder PsyNeuLink can be used from or put in:
  // no button; the line under the Path field says which.
  const folderBlocks =
    !!typedPath && (folder.state === "checking" || (folder.state === "checked" && folder.check.status === "refused"));
  const recentRepos = useRecentRepos(capabilities.enabled && choice?.kind === "other-github");
  const branchData = useBranches(choice?.kind === "other-github" ? (repo.trim() || DEFAULT_GITHUB_REPO) : "");

  const reset = useCallback(() => {
    setChoice(null);
    setRepo("");
    setRef("");
    setPath("");
    setDownloadFrom(downloadSourceValue(DEFAULT_DOWNLOAD_SOURCE));
  }, []);
  // The one install mechanism, shared with General ▸ PsyNeuLink version.
  const { job, submitError, isRunning, isDone, submit } = useInstallJob({
    currentPnl,
    onInstallSucceeded,
    // After a switch the new install is what is in use: back to nothing chosen.
    onSucceeded: () => {
      knownSources.reload();
      reset();
    },
  });

  // A click outside closes the list.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-scroll the log to the bottom on every update so the latest line
  // (✓ step or Total: ...) is always visible without manual scrolling.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.log]);

  if (!capabilities.enabled) {
    // "loopback-only" is the right explanation for a backend someone exposed
    // on their own machine, and the wrong one for a container — there the venv
    // is read-only and no amount of connecting from the right address helps
    // (#1062).
    const explanation =
      capabilities.reason === "unavailable_in_deployment"
        ? "The PsyNeuLink version is fixed by this deployment's image and can't be changed from here."
        : "Install controls are disabled (loopback-only).";
    return (
      <div style={{ ...mutedStyle, marginTop: 10 }}>{explanation}</div>
    );
  }

  const pick = (option: SwitchOption) => {
    setChoice(parseSwitchChoice(option.value));
    setOpen(false);
  };
  const choosePath = async () => {
    const picked = await pickOpenPath({
      directories: true,
      message: "Choose your PsyNeuLink checkout, or an empty folder to download PsyNeuLink into",
      defaultDir: path.trim() || undefined,
    });
    if (picked) setPath(picked);
  };

  // One rule decides the button, the summary and the hint (#1303): a valid
  // choice that differs from what is in use.
  const problem = form ? installFormProblem(form) : null;
  const pending = !!form && problem === null && !folderBlocks && somethingToApply(form, currentPnl, applyOptions);
  const sameAsInUse = !!form && problem === null && !folderBlocks && !pending;
  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, fontSize: 13 };
  const labelStyle: React.CSSProperties = { width: 80, color: "var(--pnv-text-secondary)", flexShrink: 0 };

  return (
    <div style={{ padding: 12, background: "var(--pnv-surface-muted)", borderRadius: 6 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--pnv-text-body)",
          marginBottom: 8,
        }}
      >
        Change install
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* What is in use now, always; the button appears below only for a change (#1303). */}
        <InUseNow testId="install-in-use">{formatInstallSummary(currentPnl)}</InUseNow>
        {/* The Mac app's saved choice, when it disagrees with the install (MacApp#9). */}
        <PnlRecordNotice currentPnl={currentPnl} />

        <div style={{ ...row, alignItems: "flex-start" }}>
          <label id={SWITCH_LABEL_ID} style={{ ...labelStyle, paddingTop: 6 }}>Switch to</label>
          <div ref={dropdownRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <button
              type="button"
              data-testid="setting-pnl-source"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-labelledby={SWITCH_LABEL_ID}
              disabled={!!isRunning}
              title={chosen?.title}
              onClick={() => setOpen((o) => !o)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && !open) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
              style={{
                ...inputStyle,
                width: "100%",
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                textAlign: "left",
                cursor: isRunning ? "default" : "pointer",
                color: chosen ? "var(--pnv-text)" : "var(--pnv-text-muted)",
                // Full names: a long branch wraps rather than being cut off.
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{chosen ? <BreakAfterSlashes text={chosen.fullName} /> : "Choose a source…"}</span>
              <span aria-hidden="true" style={{ fontSize: 10, color: "var(--pnv-text-muted)", flexShrink: 0 }}>▼</span>
            </button>
            {open && (
              <SwitchListbox
                groups={groups}
                selectedValue={chosen?.value ?? null}
                labelId={SWITCH_LABEL_ID}
                onPick={pick}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        </div>

        {/* A known source or a release: its full name, no fields. */}
        {chosen && chosen.form && (
          <div data-testid="install-choice-name" style={{ marginLeft: 92, fontSize: 12, color: "var(--pnv-text-body)", overflowWrap: "anywhere" }}>
            <BreakAfterSlashes text={chosen.title} />
          </div>
        )}

        {choice?.kind === "other-local" && (
          <div style={row}>
            <label htmlFor="install-path" style={labelStyle}>Path</label>
            <input
              id="install-path"
              data-testid="install-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={!!isRunning}
              placeholder="/path/to/PsyNeuLink"
              style={{ ...inputStyle, fontFamily: "monospace" }}
            />
            {/* A Finder folder picker inside the Mac app; in a browser, typing. */}
            {hasFileBridge() && (
              <Button
                kind="secondary"
                size="compact"
                data-testid="install-choose-path"
                disabled={!!isRunning}
                onClick={choosePath}
                style={{ flexShrink: 0 }}
              >
                Choose…
              </Button>
            )}
          </div>
        )}
        {typedPath && (
          <FolderCheckLine
            folder={folder}
            sources={fillFrom}
            downloadFrom={downloadSourceValue(download)}
            onDownloadFrom={setDownloadFrom}
            disabled={!!isRunning}
          />
        )}

        {choice?.kind === "other-github" && (
          <>
            <div style={row}>
              <label style={labelStyle}>Repo</label>
              <Combobox
                value={repo}
                onChange={setRepo}
                disabled={!!isRunning}
                placeholder={DEFAULT_GITHUB_REPO}
                recent={recentRepos}
                all={null}
                monospace
              />
            </div>
            <div style={row}>
              <label style={labelStyle}>Branch / ref</label>
              <Combobox
                value={ref}
                onChange={setRef}
                disabled={!!isRunning}
                placeholder={
                  currentPnl.source === "github" && currentPnl.branch ? currentPnl.branch : "devel"
                }
                recent={branchData.recentRefs}
                all={branchData.branches}
                defaultBranch={branchData.default}
                loadError={branchData.error ? "Couldn't load branches — type the name manually." : null}
              />
            </div>
            <div style={{ marginLeft: 92, fontSize: 11, color: "var(--pnv-text-hint)" }}>
              Leave Repo blank to install from {DEFAULT_GITHUB_REPO}. Public GitHub repos only.
            </div>
          </>
        )}

        {/* Not yet a valid choice: what is missing, instead of a button (#1331). */}
        {problem && !isRunning && (
          <div data-testid="install-choice-hint" style={{ ...mutedStyle, marginLeft: 92 }}>{problem}</div>
        )}
        {sameAsInUse && !isRunning && (
          <div data-testid="install-choice-same" style={{ ...mutedStyle, marginLeft: 92 }}>
            That is the one in use now: nothing to apply.
          </div>
        )}

        {/* What the switch changes, and what it doesn't, before it is applied (#1295). */}
        {pending && !isRunning && (
          <div data-testid="install-switch-summary" style={{ fontSize: 12, color: "var(--pnv-primary-text-on-tint)", background: "var(--pnv-primary-tint)", border: "1px solid var(--pnv-primary-tint-border)", borderRadius: 4, padding: "6px 8px" }}>
            {switchSummary(form, currentPnl, applyOptions)}
          </div>
        )}
        {pending && !isRunning && <ApplyExplanation testId="install-apply-explanation" />}
        {(pending || isRunning) && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            {!isRunning && form && (
              <span data-testid="install-wait-hint" style={{ fontSize: 11, color: "var(--pnv-text-hint)" }}>
                Expected wait: {expectedWait(form, currentPnl)}
              </span>
            )}
            <Button kind="primary" size="compact" onClick={() => form && submit(form)} data-testid="install-apply" disabled={!!isRunning}>
              {isRunning ? "Installing…" : "Apply & restart"}
            </Button>
          </div>
        )}

        {knownSources.sources.length > 0 && (
          <ManageKnownSources
            sources={knownSources.sources}
            onRename={knownSources.rename}
            onRemove={knownSources.remove}
            disabled={!!isRunning}
          />
        )}
      </div>

      {submitError && <div style={{ ...errorStyle, marginTop: 8 }}>{submitError}</div>}

      {job && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--pnv-text-secondary)", marginBottom: 4 }}>
            Status: <strong>{job.status}</strong>
            {job.exit_code !== null && ` (exit ${job.exit_code})`}
            {formatJobElapsed(job) && (
              <span style={{ color: "var(--pnv-text-hint)" }}>{" "}— {formatJobElapsed(job)}</span>
            )}
          </div>
          <pre
            ref={logRef}
            style={{
              background: "var(--pnv-code-bg)",
              color: "var(--pnv-border-light)",
              fontSize: 11,
              padding: 8,
              borderRadius: 4,
              maxHeight: 180,
              overflowY: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {job.log.join("\n") || "(starting…)"}
          </pre>
          {isDone && job.status === "succeeded" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--pnv-success)" }}>
              ✓ Install succeeded. PsyNeuLink details below shows the new version.
            </div>
          )}
          {isDone && job.status === "failed" && (
            <div style={{ ...errorStyle, marginTop: 8 }}>
              Install failed. See log above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── The folder under "Another local checkout…" (#1342) ───────────────

type FolderState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "checked"; check: LocalFolderCheck }
  // The check itself failed (an older backend, a dropped connection): say
  // nothing and let Apply ask; the install refuses a bad folder anyway.
  | { state: "unknown" };

/** Ask the backend what the folder at `path` is, once typing pauses. */
function useFolderCheck(path: string): FolderState {
  const [result, setResult] = useState<{ path: string; folder: FolderState }>({ path: "", folder: { state: "idle" } });
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/settings/install/check-folder?path=${encodeURIComponent(path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((check: LocalFolderCheck) => {
          if (!cancelled) setResult({ path, folder: { state: "checked", check } });
        })
        .catch(() => {
          if (!cancelled) setResult({ path, folder: { state: "unknown" } });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [path]);
  if (!path) return { state: "idle" };
  // A result for another path (typing went on) is no answer for this one.
  return result.path === path ? result.folder : { state: "checking" };
}

/**
 * What the typed folder is, under the Path field: a checkout; an empty or
 * missing folder, with the offer to download PsyNeuLink into it and where
 * from; or neither, and why.
 */
function FolderCheckLine({
  folder,
  sources,
  downloadFrom,
  onDownloadFrom,
  disabled,
}: {
  folder: FolderState;
  sources: Array<{ repo: string; ref: string }>;
  downloadFrom: string;
  onDownloadFrom: (value: string) => void;
  disabled: boolean;
}) {
  const indent: React.CSSProperties = { marginLeft: 92 };
  if (folder.state === "checking") {
    return <div data-testid="install-path-checking" style={{ ...mutedStyle, ...indent }}>Checking the folder…</div>;
  }
  if (folder.state !== "checked") return null;
  const { check } = folder;
  if (check.status === "usable") {
    return (
      <div data-testid="install-path-usable" style={{ ...indent, fontSize: 12, color: "var(--pnv-success)" }}>
        ✓ A PsyNeuLink checkout.
      </div>
    );
  }
  if (check.status === "refused") {
    return (
      <div data-testid="install-path-refused" style={{ ...errorStyle, ...indent, lineHeight: 1.4 }}>
        {check.reason}
      </div>
    );
  }
  return (
    <div
      data-testid="install-download-offer"
      style={{ ...indent, fontSize: 12, color: "var(--pnv-text-body)", background: "var(--pnv-surface)", border: "1px solid var(--pnv-border-light)", borderRadius: 4, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ fontWeight: 600 }}>Download PsyNeuLink here</div>
      <div style={{ ...mutedStyle, color: "var(--pnv-text-secondary)" }}>
        {check.exists ? "This folder is empty." : "This folder doesn't exist yet: it will be made."}{" "}
        Apply &amp; restart downloads PsyNeuLink into it, as your own checkout to edit and run.
        Latest development is recommended.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="install-download-from" style={{ color: "var(--pnv-text-secondary)", flexShrink: 0 }}>Download from</label>
        <select
          id="install-download-from"
          data-testid="install-download-from"
          value={downloadFrom}
          disabled={disabled}
          onChange={(e) => onDownloadFrom(e.target.value)}
          style={{ ...selectStyle, fontSize: 12 }}
        >
          {sources.map((d) => (
            <option key={downloadSourceValue(d)} value={downloadSourceValue(d)}>
              {downloadSourceName(d)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Typeahead support (#251) ─────────────────────────────────────────

function useRecentRepos(enabled: boolean): string[] {
  const [repos, setRepos] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/settings/install/repos")
      .then((r) => (r.ok ? r.json() : { recent_repos: [] }))
      .then((data: { recent_repos?: string[] }) => {
        if (!cancelled) setRepos(data.recent_repos ?? []);
      })
      .catch(() => {
        if (!cancelled) setRepos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return repos;
}

interface BranchData {
  branches: string[] | null;       // null = not fetched yet (or empty repo string)
  default: string | null;
  recentRefs: string[];
  error: string | null;
}

function useBranches(repo: string): BranchData {
  const [data, setData] = useState<BranchData>({
    branches: null,
    default: null,
    recentRefs: [],
    error: null,
  });

  useEffect(() => {
    if (!repo) {
      setData({ branches: null, default: null, recentRefs: [], error: null });
      return;
    }

    // 500ms debounce so typing in Repo doesn't fire one fetch per keystroke.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/settings/install/branches?repo=${encodeURIComponent(repo)}`)
        .then(async (r) => {
          if (!r.ok) {
            const detail = await r.json().catch(() => ({}));
            throw new Error(detail?.detail?.message ?? `HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((body: { branches: string[]; default: string; recent_refs: string[] }) => {
          if (!cancelled) {
            setData({
              branches: body.branches,
              default: body.default,
              recentRefs: body.recent_refs,
              error: null,
            });
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setData({
              branches: null,
              default: null,
              recentRefs: [],
              error: String(e),
            });
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repo]);

  return data;
}

// ─── Remembered sources (#1276) ───────────────────────────────────────

interface KnownSources {
  sources: PnlSourceEntry[];
  reload: () => void;
  rename: (id: string, label: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function useKnownSources(enabled: boolean): KnownSources {
  const [sources, setSources] = useState<PnlSourceEntry[]>([]);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const reload = useCallback(() => {
    if (!enabled) return;
    fetch("/api/settings/pnl-sources")
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      // A placeholder (owner/repo) is never a source (#1292).
      .then((data: { sources?: PnlSourceEntry[] }) => setSources(dropPlaceholderSources(data.sources ?? [])))
      .catch(() => setSources([]));
  }, [enabled]);

  useEffect(reload, [reload]);

  const post = useCallback(
    async (action: "rename" | "remove", body: Record<string, string>) => {
      try {
        const r = await fetch(`/api/settings/pnl-sources/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: { sources: PnlSourceEntry[] } = await r.json();
        setSources(dropPlaceholderSources(data.sources));
      } catch (e) {
        addNotification("error", `Couldn't ${action} that source: ${String(e)}`);
        reload();
      }
    },
    [addNotification, reload],
  );

  return {
    sources,
    reload,
    rename: (id, label) => post("rename", { id, label }),
    remove: (id) => post("remove", { id }),
  };
}

/**
 * The known sources to manage (#1276, folded away in #1331): every source
 * used before, with Rename, and Remove for any but the one in use. Names
 * are shown in full. Removing an entry only takes it off the list and the
 * dropdown: no folder is deleted. Switching is the dropdown's job.
 */
function ManageKnownSources({
  sources,
  onRename,
  onRemove,
  disabled,
}: {
  sources: PnlSourceEntry[];
  onRename: (id: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  disabled: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const badge = (text: string, color: string): React.ReactNode => (
    <span style={{ fontSize: 10, color, border: `1px solid ${color}`, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
  const kindOf = (e: PnlSourceEntry) => (e.kind === "local" ? "Your checkout" : e.kind === "github" ? "GitHub" : "Official release");

  return (
    <div data-testid="pnl-known-sources" style={{ fontSize: 13, marginTop: 4 }}>
      <Button
        kind="link"
        data-testid="pnl-manage-sources-toggle"
        aria-expanded={shown}
        onClick={() => setShown((v) => !v)}
        style={{ fontSize: 12 }}
      >
        {shown ? "▼" : "▶"} Manage known sources ({sources.length})
      </Button>
      {shown && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
          {sources.map((e) => {
            const full = sourceFullName(e);
            return (
              <div
                key={e.id}
                data-testid="pnl-source-row"
                data-source-id={e.id}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                  borderRadius: 4, border: "1px solid var(--pnv-border-faint)", background: "var(--pnv-surface)",
                }}
              >
                {editingId === e.id ? (
                  <form
                    style={{ display: "flex", gap: 6, flex: 1 }}
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      onRename(e.id, draft).then(() => setEditingId(null));
                    }}
                  >
                    <input
                      autoFocus
                      aria-label="Source name"
                      value={draft}
                      placeholder={sourceOptionName({ ...e, label: null })}
                      onChange={(ev) => setDraft(ev.target.value)}
                      style={{ ...inputStyle, fontSize: 12, padding: "2px 6px" }}
                    />
                    <Button kind="small" type="submit">Save</Button>
                    <Button kind="small" onClick={() => setEditingId(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    {/* The full name, wrapping; never cut off (#1331). */}
                    <span
                      data-testid="pnl-source-name"
                      title={full}
                      style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--pnv-text)", overflowWrap: "anywhere" }}
                    >
                      <span style={{ color: "var(--pnv-text-muted)" }}>{kindOf(e)}: </span>
                      <BreakAfterSlashes text={full} />
                    </span>
                    {e.active && badge("in use", "var(--pnv-success)")}
                    {e.missing && badge("folder missing", "var(--pnv-danger)")}
                    {e.editable ? badge("editable", "var(--pnv-primary)") : badge("managed, read-only", "var(--pnv-text-hint)")}
                    <Button
                      kind="small"
                      disabled={disabled}
                      title="Rename this source"
                      onClick={() => {
                        setDraft(e.label ?? "");
                        setEditingId(e.id);
                      }}
                    >
                      Rename
                    </Button>
                    {/* Never for the one in use: removing it would only confuse. */}
                    {e.remembered && !e.active && (
                      <Button
                        kind="danger"
                        disabled={disabled}
                        title="Remove from this list (no folder is deleted)"
                        onClick={() => onRemove(e.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
