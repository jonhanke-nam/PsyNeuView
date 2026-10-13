/**
 * "Load Model → From GitHub repo…" modal (#258).
 *
 * Lets the user pick a (repo, branch, path) triple from GitHub and load
 * the file into the editor as remote-sourced content. Repo + Branch reuse
 * the same Combobox the install settings use (#251); the file list is a
 * filterable two-section list (Recent / All paths) backed by
 * GET /api/model/github/tree, and Open fetches via
 * GET /api/model/github/file.
 *
 * Free-text wins everywhere — the user can type a path that isn't in the
 * tree (e.g. an untracked test file added since the cache was warmed) and
 * Open will still try it; backend returns 404 if it truly doesn't exist.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "./Combobox";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";

const DEFAULT_REPO = "PrincetonUniversity/PsyNeuLink";
const DEFAULT_REF = "devel";

interface TreeResponse {
  paths: string[];
  truncated: boolean;
  recent: { path: string; selected_at: number }[];
}

interface FileResponse {
  repo: string;
  ref: string;
  path: string;
  content: string;
}

interface ErrorDetail {
  reason?: string;
  message?: string;
}

export interface GithubFileLoaderModalProps {
  onCancel: () => void;
  onLoaded: (file: FileResponse) => void;
}

// ─── Recent repos (shared endpoint with install settings) ─────────────

function useRecentRepos(): string[] {
  const [repos, setRepos] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/install/repos")
      .then((r) => (r.ok ? r.json() : { recent_repos: [] }))
      .then((data: { recent_repos?: string[] }) => {
        if (!cancelled) setRepos(data.recent_repos ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return repos;
}

// ─── Branches (debounced fetch, same as SettingsPanel) ────────────────

interface BranchData {
  branches: string[] | null;
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
            setData({ branches: null, default: null, recentRefs: [], error: String(e) });
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

// ─── Tree (debounced fetch on repo+ref change) ────────────────────────

interface TreeState {
  data: TreeResponse | null;
  loading: boolean;
  error: ErrorDetail | null;
}

function useTree(repo: string, ref: string): TreeState {
  const [state, setState] = useState<TreeState>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!repo.trim() || !ref.trim()) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      fetch(
        `/api/model/github/tree?repo=${encodeURIComponent(repo.trim())}` +
          `&ref=${encodeURIComponent(ref.trim())}`,
      )
        .then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw body?.detail ?? { reason: "network", message: `HTTP ${r.status}` };
          }
          return (await r.json()) as TreeResponse;
        })
        .then((data) => {
          if (!cancelled) setState({ data, loading: false, error: null });
        })
        .catch((err: ErrorDetail) => {
          if (!cancelled) setState({ data: null, loading: false, error: err });
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repo, ref]);

  return state;
}

// ─── Styles (kept local — these only exist in this modal) ─────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--pnv-scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
};

const panelStyle: React.CSSProperties = {
  background: "var(--pnv-surface)",
  borderRadius: 12,
  width: "min(720px, 92vw)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "var(--pnv-shadow-dialog)",
};

// Everything under the fixed header; the file list inside it is what scrolls.
const bodyStyle: React.CSSProperties = {
  padding: "12px 24px 20px",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13,
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = { width: 70, color: "var(--pnv-text-secondary)" };

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: 13,
  border: "1px solid var(--pnv-border)",
  borderRadius: 4,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  maxHeight: 360,
  overflowY: "auto",
  border: "1px solid var(--pnv-border-faint)",
  borderRadius: 6,
  marginTop: 6,
  background: "var(--pnv-surface-muted)",
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 10,
  textTransform: "uppercase",
  color: "var(--pnv-text-hint)",
  background: "var(--pnv-border-faint)",
  position: "sticky",
  top: 0,
};

const rowItemStyle = (selected: boolean): React.CSSProperties => ({
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
  background: selected ? "var(--pnv-primary-tint)" : "transparent",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

// ─── Component ────────────────────────────────────────────────────────

export function GithubFileLoaderModal({ onCancel, onLoaded }: GithubFileLoaderModalProps) {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [ref, setRef] = useState(DEFAULT_REF);
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<ErrorDetail | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const recentRepos = useRecentRepos();
  const branchData = useBranches(repo.trim() || DEFAULT_REPO);
  const tree = useTree(repo.trim() || DEFAULT_REPO, ref.trim() || DEFAULT_REF);

  // Focus the filter input on mount.
  useEffect(() => {
    filterInputRef.current?.focus();
  }, []);

  // Closes the shared ways (#1289): ×, Escape, click outside, Cancel. A
  // combobox with its list open takes Escape first and closes only the list.
  useDismiss(true, onCancel);

  const recentPaths = useMemo(
    () => (tree.data?.recent ?? []).map((r) => r.path),
    [tree.data],
  );

  // Filter rows by case-insensitive substring on the typed filter text.
  // Recent paths show on top; remaining all-paths show below (deduped).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const recents = recentPaths.filter(match);
    const recentSet = new Set(recentPaths);
    const all = (tree.data?.paths ?? []).filter(
      (p) => !recentSet.has(p) && match(p),
    );
    return { recents, all };
  }, [filter, recentPaths, tree.data]);

  const handleOpen = async () => {
    const r = repo.trim() || DEFAULT_REPO;
    const b = ref.trim() || DEFAULT_REF;
    const p = path.trim();
    if (!p) return;
    setOpening(true);
    setOpenError(null);
    try {
      const url =
        `/api/model/github/file?repo=${encodeURIComponent(r)}` +
        `&ref=${encodeURIComponent(b)}` +
        `&path=${encodeURIComponent(p)}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setOpenError(body?.detail ?? { reason: "network", message: `HTTP ${resp.status}` });
        return;
      }
      const data: FileResponse = await resp.json();
      onLoaded(data);
    } catch (e) {
      setOpenError({ reason: "network", message: String(e) });
    } finally {
      setOpening(false);
    }
  };

  const treeErrorBanner = tree.error && (
    <div
      style={{
        marginTop: 6,
        padding: "6px 10px",
        background: "var(--pnv-danger-tint)",
        color: "var(--pnv-danger)",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {treeErrorMessage(tree.error)}
    </div>
  );

  const canOpen = !!path.trim() && !opening;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-file-loader-title"
        data-testid="github-file-loader-modal"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="Open file from GitHub" titleId="github-file-loader-title" onClose={onCancel} />
        <div style={bodyStyle}>

        <div style={rowStyle}>
          <label style={labelStyle}>Repo</label>
          <Combobox
            value={repo}
            onChange={(v) => {
              setRepo(v);
              setPath("");
            }}
            placeholder={DEFAULT_REPO}
            recent={recentRepos}
            all={null}
            monospace
          />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Branch</label>
          <Combobox
            value={ref}
            onChange={(v) => {
              setRef(v);
              setPath("");
            }}
            placeholder={DEFAULT_REF}
            recent={branchData.recentRefs}
            all={branchData.branches}
            defaultBranch={branchData.default}
            loadError={
              branchData.error ? "Couldn't load branches — type the name manually." : null
            }
          />
        </div>

        <div style={rowStyle}>
          <label style={labelStyle}>Path</label>
          <input
            ref={filterInputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter paths (e.g. tests/composition)"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>

        {treeErrorBanner}

        <div style={listStyle}>
          {tree.loading && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--pnv-text-hint)" }}>
              Loading file list…
            </div>
          )}
          {!tree.loading && !tree.error && (filtered.recents.length + filtered.all.length === 0) && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--pnv-text-hint)" }}>
              {tree.data == null
                ? "Enter a repo and branch to list files."
                : filter
                  ? "No paths match this filter."
                  : "No .py files in this branch."}
            </div>
          )}

          {filtered.recents.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Recent</div>
              {filtered.recents.map((p) => (
                <div
                  key={`r-${p}`}
                  onClick={() => setPath(p)}
                  onDoubleClick={() => {
                    setPath(p);
                    void handleOpen();
                  }}
                  style={rowItemStyle(p === path)}
                  title={p}
                >
                  {p}
                </div>
              ))}
            </>
          )}
          {filtered.all.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>All paths</div>
              {filtered.all.map((p) => (
                <div
                  key={`a-${p}`}
                  onClick={() => setPath(p)}
                  onDoubleClick={() => {
                    setPath(p);
                    void handleOpen();
                  }}
                  style={rowItemStyle(p === path)}
                  title={p}
                >
                  {p}
                </div>
              ))}
            </>
          )}
        </div>

        {tree.data?.truncated && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--pnv-text-hint)" }}>
            File list is truncated — narrow with the filter or pick a more specific branch.
          </div>
        )}

        <div style={{ ...rowStyle, marginTop: 10 }}>
          <label style={labelStyle}>Selected</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path/to/file.py"
            style={{ ...inputStyle, fontFamily: "monospace" }}
          />
        </div>

        {openError && (
          <div
            style={{
              marginTop: 4,
              padding: "6px 10px",
              background: "var(--pnv-danger-tint)",
              color: "var(--pnv-danger)",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {openErrorMessage(openError)}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Button
            onClick={onCancel}
            kind="secondary"
          >
            Cancel
          </Button>
          <Button
            onClick={handleOpen}
            disabled={!canOpen}
            kind="primary"
          >
            {opening ? "Opening…" : "Open"}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Error message helpers ────────────────────────────────────────────

function treeErrorMessage(err: ErrorDetail): string {
  switch (err.reason) {
    case "invalid_slug":
      return "Repo must look like owner/name.";
    case "invalid_ref":
      return "Branch name is invalid.";
    case "not_found":
      return "Repo or branch not found.";
    case "auth_required":
      return "GitHub requires authentication. Add a token in Settings → GitHub.";
    case "rate_limited":
      return "GitHub rate limit hit. Add a token in Settings or wait a few minutes.";
    case "network":
      return "Couldn't reach GitHub. Check your connection.";
    default:
      return err.message ?? "Couldn't load file list.";
  }
}

function openErrorMessage(err: ErrorDetail): string {
  switch (err.reason) {
    case "invalid_path":
      return "Path is invalid.";
    case "not_a_file":
      return "That path is a directory, not a file.";
    case "not_found":
      return "File not found on this branch.";
    case "too_large":
      return "File is larger than 1 MB — can't load directly.";
    case "not_utf8":
      return "File isn't UTF-8 text.";
    case "auth_required":
      return "GitHub requires authentication. Add a token in Settings → GitHub.";
    case "rate_limited":
      return "GitHub rate limit hit. Add a token in Settings or wait a few minutes.";
    case "network":
      return "Couldn't reach GitHub. Check your connection.";
    default:
      return err.message ?? "Couldn't open file.";
  }
}
