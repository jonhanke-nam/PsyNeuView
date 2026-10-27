/**
 * File-browser modal for "Open from path" in plain web (#618).
 *
 * The Mac app has a native OS picker; plain browsers can't expose real server
 * paths, so this navigates the backend's configured model directories
 * (`GET /api/models/dirs`) and folders (`GET /api/models/browse?path=`) and
 * hands the chosen path back via onSelect. A typed-path field is kept as a
 * manual-entry fallback. (Only `.py` files are listed — that's what the browse
 * endpoint returns; a `.pnlproject` path can still be typed manually.)
 *
 * Closes the shared ways (#1289): the × in its header, Escape, a click
 * outside, and its own Cancel.
 */
import { useState, useEffect, useCallback } from "react";

import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";

interface Root {
  path: string;
  exists: boolean;
}
interface Entry {
  path: string;
  parent: string | null;
  folders: { name: string; path: string }[];
  files: { name: string; label: string; path: string }[];
}

interface Props {
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function FileBrowserModal({ onSelect, onCancel }: Props) {
  const [roots, setRoots] = useState<Root[]>([]);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/models/browse?path=${encodeURIComponent(path)}`);
      if (!resp.ok) throw new Error("Could not open that folder");
      setEntry(await resp.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/api/models/dirs");
        const data = await resp.json();
        const dirs: Root[] = data.directories || [];
        setRoots(dirs);
        const first = dirs.find((d) => d.exists);
        if (first) browse(first.path);
      } catch {
        setError("Could not load model directories");
      }
    })();
  }, [browse]);

  useDismiss(true, onCancel);

  const empty = entry && !loading && entry.folders.length === 0 && entry.files.length === 0;

  return (
    <div style={OVERLAY} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-browser-title"
        data-testid="file-browser-modal"
        style={CARD}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="Open a model" titleId="file-browser-title" onClose={onCancel} />
        <div style={BODY}>

        {roots.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {roots.map((r) => (
              <button
                key={r.path}
                disabled={!r.exists}
                onClick={() => browse(r.path)}
                title={r.path}
                style={chipStyle(entry?.path === r.path, r.exists)}
              >
                {r.path.split("/").filter(Boolean).pop() || r.path}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <button
            onClick={() => entry?.parent && browse(entry.parent)}
            disabled={!entry?.parent}
            style={UP_BTN}
            title="Parent folder"
          >
            ↑ Up
          </button>
          <span style={PATH_LABEL} title={entry?.path || ""}>
            {entry?.path || ""}
          </span>
        </div>

        <div style={LIST}>
          {loading && <div style={MUTED}>Loading…</div>}
          {error && <div style={{ ...MUTED, color: "var(--pnv-danger)" }}>{error}</div>}
          {entry && !loading &&
            entry.folders.map((f) => (
              <div key={f.path} onClick={() => browse(f.path)} style={ROW}>
                <span style={{ width: 18 }}>📁</span>
                {f.name}
              </div>
            ))}
          {entry && !loading &&
            entry.files.map((f) => (
              <div key={f.path} onClick={() => onSelect(f.path)} style={ROW} title={f.path}>
                <span style={{ width: 18 }}>📄</span>
                {f.name}.py
              </div>
            ))}
          {empty && <div style={MUTED}>No models or folders here.</div>}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type a path: /path/to/model.py"
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed.trim()) onSelect(typed.trim());
            }}
            style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--pnv-border)", borderRadius: 6, fontSize: "var(--pnv-fs-12)" }}
          />
          <Button kind="primary" size="compact" onClick={() => typed.trim() && onSelect(typed.trim())} disabled={!typed.trim()}>
            Open
          </Button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <Button kind="secondary" size="compact" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}

const OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0, background: "var(--pnv-scrim)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
};
const CARD: React.CSSProperties = {
  background: "var(--pnv-surface)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden",
  width: "90%", maxWidth: 560, boxShadow: "var(--pnv-shadow-dialog)",
};
const BODY: React.CSSProperties = { padding: "14px 24px 22px" };
const LIST: React.CSSProperties = {
  height: 280, overflow: "auto", border: "1px solid var(--pnv-border-faint)", borderRadius: 8, padding: 4,
};
const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
  fontSize: "var(--pnv-fs-13)", cursor: "pointer", borderRadius: 6, whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis",
};
const MUTED: React.CSSProperties = { padding: 12, color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-12)" };
const PATH_LABEL: React.CSSProperties = {
  fontFamily: "monospace", fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-muted)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const UP_BTN: React.CSSProperties = {
  fontSize: "var(--pnv-fs-11)", padding: "2px 8px", border: "1px solid var(--pnv-border)", borderRadius: 6,
  background: "var(--pnv-surface-sunken)", cursor: "pointer", flexShrink: 0,
};
function chipStyle(active: boolean, exists: boolean): React.CSSProperties {
  return {
    fontSize: "var(--pnv-fs-11)", padding: "2px 10px", borderRadius: 12,
    border: active ? "1px solid var(--pnv-primary)" : "1px solid var(--pnv-border-light)",
    background: active ? "var(--pnv-primary-tint)" : "var(--pnv-surface-muted)",
    color: exists ? (active ? "var(--pnv-primary)" : "var(--pnv-text-body)") : "var(--pnv-text-faint)",
    cursor: exists ? "pointer" : "not-allowed",
  };
}
