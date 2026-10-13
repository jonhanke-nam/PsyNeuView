/**
 * The pieces of Settings ▸ Folders and Settings ▸ Developer that show where
 * things live (#1295).
 *
 * A location row: its path, whether it is yours to edit or managed for you,
 * and a way to get there — Show in Finder inside the Mac app, Copy path in a
 * browser. Folders (FoldersSection.tsx) lists everything you can open with
 * these rows; Developer adds, from here, where PsyNeuView and PsyNeuLink are
 * installed and the managed PsyNeuLink copies under ~/.psyneuview/sources —
 * size, when last used, Remove for one not in use — with the checkouts
 * PsyNeuView knows. Those come from `/api/locations`; inside the Mac app,
 * which PsyNeuView the app runs comes from its bridge.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { hasFileBridge, revealInFinder } from "@/utils/fileBridge";
import { getMacAppSettings, hasSettingsBridge, type MacAppInstall } from "@/utils/macAppSettings";
import { formatInstallSummary } from "@/utils/pnlSources";
import { copyToClipboard, revealOrCopy } from "@/utils/revealPath";
import { DeveloperBadge } from "../DeveloperBadge";
import { GROUP_INDENT, Group, PathBox, abbreviateHome, errorStyle, mutedStyle } from "./shared";
import type { KeptRelease, Locations, ManagedCopy } from "./types";
import { Button } from "../Button";

// ── Data ─────────────────────────────────────────────────────────────

interface LocationsState {
  locations: Locations | null;
  error: string | null;
  reload: () => void;
}

/** `/api/locations`, fetched on mount; `reload` after a change. */
export function useLocations(): LocationsState {
  const [locations, setLocations] = useState<Locations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fetch("/api/locations")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Locations) => {
        setLocations(data);
        setError(null);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);
  useEffect(reload, [reload]);
  return { locations, error, reload };
}

/** The Mac app's own account of which PsyNeuView it runs, inside the app. */
export function useMacAppInstall(): MacAppInstall | null {
  const [install, setInstall] = useState<MacAppInstall | null>(null);
  useEffect(() => {
    if (!hasSettingsBridge()) return;
    let alive = true;
    getMacAppSettings()
      .then((s) => alive && setInstall(s.install))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return install;
}

// ── Pieces ───────────────────────────────────────────────────────────

/**
 * Show in Finder, or Copy path where Finder is out of reach. The outcome is
 * said next to the button: the note after a copy, or why the app refused.
 */
export function RevealButton({ path, testId }: { path: string; testId?: string }) {
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const inApp = hasFileBridge();
  const act = async () => {
    setNote(null);
    const outcome = await revealOrCopy(path, { hasBridge: inApp, reveal: revealInFinder, copy: copyToClipboard });
    if (outcome.kind === "copied") setNote({ text: outcome.note, error: false });
    if (outcome.kind === "failed") setNote({ text: outcome.message, error: true });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Button onClick={act} kind="small" data-testid={testId ?? "reveal-path"} title={path}>
        {inApp ? "Show in Finder" : "Copy path"}
      </Button>
      {note && (
        <span data-testid="reveal-note" style={{ ...(note.error ? errorStyle : mutedStyle), fontSize: 11 }}>
          {note.text}
        </span>
      )}
    </span>
  );
}

/** "yours to edit" or "managed for you", in one small mark. */
function Ownership({ editable }: { editable: boolean }) {
  const color = editable ? "var(--pnv-primary)" : "var(--pnv-text-hint)";
  return (
    <span
      data-testid="location-ownership"
      title={
        editable
          ? "Your folder: edit what's in it as you like"
          : "PsyNeuView keeps this one for you; changes here are overwritten"
      }
      style={{ fontSize: 10, color, border: `1px solid ${color}`, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}
    >
      {editable ? "yours to edit" : "managed for you"}
    </span>
  );
}

export function LocationRow({
  id,
  name,
  path,
  pathTestId,
  editable,
  detail,
  badge,
  actions,
  below,
  compact,
}: {
  id: string;
  name: string;
  path: string | null;
  /** The PathBox's test id; `location-<id>-path` by default. */
  pathTestId?: string;
  editable: boolean;
  /** One line under the name: what it is, in plain words. */
  detail?: ReactNode;
  badge?: ReactNode;
  /** Buttons beside Show in Finder / Copy path (Change…, Move…). */
  actions?: ReactNode;
  /** Anything under the path: a note, an offer, an error. */
  below?: ReactNode;
  /** Tighter spacing, for a list that should fit the window (Folders). */
  compact?: boolean;
}) {
  return (
    <div data-testid={`location-${id}`} style={{ padding: compact ? "3px 0" : "6px 0", borderBottom: "1px solid var(--pnv-surface-sunken)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500 }}>{name}</span>
        <Ownership editable={editable} />
        {badge}
      </div>
      {/* What's under the name is indented like a group's contents under its heading. */}
      <div style={{ paddingLeft: GROUP_INDENT }}>
        {detail && <div style={{ ...mutedStyle, marginTop: 1 }}>{detail}</div>}
        {path ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PathBox path={path} testId={pathTestId ?? `location-${id}-path`} />
            </div>
            {actions}
            <RevealButton path={path} />
          </div>
        ) : (
          <div style={mutedStyle}>No folder on disk for this one.</div>
        )}
        {below}
      </div>
    </div>
  );
}

// ── Developer ────────────────────────────────────────────────────────

export function formatBytes(bytes: number, complete = true): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const text = `${i === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
  return complete ? text : `at least ${text}`;
}

export function formatLastUsed(epochSeconds: number | null): string {
  if (!epochSeconds) return "never recorded";
  const days = Math.floor((Date.now() / 1000 - epochSeconds) / 86400);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function ManagedCopyRow({ copy, onRemove }: { copy: ManagedCopy; onRemove: (name: string) => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    const err = await onRemove(copy.name);
    setBusy(false);
    setError(err);
    if (!err) setConfirming(false);
  };
  return (
    <div data-testid="managed-copy" data-name={copy.name} style={{ padding: "6px 0", borderBottom: "1px solid var(--pnv-surface-sunken)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500, fontFamily: "monospace" }}>{copy.repo ?? copy.name}</span>
        {copy.in_use && (
          <span style={{ fontSize: 10, color: "var(--pnv-success)", border: "1px solid var(--pnv-success)", borderRadius: 3, padding: "0 4px" }}>
            in use
          </span>
        )}
        <span style={{ ...mutedStyle, marginLeft: "auto" }}>
          {formatBytes(copy.size_bytes, copy.size_complete)} on disk · last used {formatLastUsed(copy.last_used)}
        </span>
        {!copy.in_use && !confirming && (
          <Button kind="danger" onClick={() => setConfirming(true)} data-testid="managed-copy-remove">
            Remove
          </Button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <PathBox path={copy.path} />
        </div>
        <RevealButton path={copy.path} />
      </div>
      {confirming && (
        <div data-testid="managed-copy-confirm" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 12 }}>
          <span>
            Remove this copy? Only <code>{abbreviateHome(copy.path)}</code>, a folder PsyNeuView made, is deleted.
            Switching to it again clones it afresh.
          </span>
          <Button kind="danger" onClick={remove} disabled={busy} data-testid="managed-copy-confirm-remove">
            {busy ? "Removing…" : "Remove"}
          </Button>
          <Button kind="small" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
      {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Settings ▸ Developer: where the PsyNeuView and the PsyNeuLink in use are installed. */
export function InstallLocations({
  locations,
  error,
  macInstall,
}: LocationsState & { macInstall: MacAppInstall | null }) {
  if (error) return <div style={errorStyle}>Couldn't find them: {error}</div>;
  if (!locations) return <div style={mutedStyle}>Loading…</div>;
  const pv = locations.psyneuview;
  // Inside the Mac app the app knows which PsyNeuView it runs; a checkout it
  // chose is yours to edit, its included copy is not.
  const pvPath = macInstall?.choice === "checkout" && macInstall.checkoutPath ? macInstall.checkoutPath : pv.path;
  const pvEditable = macInstall ? macInstall.choice === "checkout" : pv.editable;
  const pvDetail = macInstall
    ? macInstall.running
    : pv.kind === "checkout"
      ? `A git checkout, version ${pv.version} (${pv.commit}).`
      : `A copy of PsyNeuView ${pv.version}, without its git history.`;
  const pnl = locations.psyneulink;
  return (
    <div data-testid="install-locations" style={{ fontSize: 13 }}>
      <LocationRow id="psyneuview" name="PsyNeuView" path={pvPath} editable={pvEditable} detail={pvDetail} compact />
      <LocationRow
        id="psyneulink"
        name="PsyNeuLink"
        path={pnl.path}
        editable={pnl.editable}
        compact
        detail={
          <>
            {formatInstallSummary(pnl)}
            {pnl.managed && " — the Open menu's Library, Examples and Tests come from here."}
          </>
        }
      />
    </div>
  );
}

/** One kept official release: its file, size, when last used, Remove unless in use. */
function KeptReleaseRow({ release, onRemove }: { release: KeptRelease; onRemove: (version: string) => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    const err = await onRemove(release.version);
    setBusy(false);
    setError(err);
    if (!err) setConfirming(false);
  };
  return (
    <div data-testid="kept-release" data-version={release.version} style={{ padding: "4px 0", borderBottom: "1px solid var(--pnv-surface-sunken)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500, fontFamily: "monospace" }}>PsyNeuLink {release.version}</span>
        {release.in_use && (
          <span style={{ fontSize: 10, color: "var(--pnv-success)", border: "1px solid var(--pnv-success)", borderRadius: 3, padding: "0 4px" }}>in use</span>
        )}
        <span style={{ ...mutedStyle, marginLeft: "auto" }}>
          {formatBytes(release.size_bytes)} on disk · last used {formatLastUsed(release.last_used)}
        </span>
        {!release.in_use && !confirming && (
          <Button kind="danger" onClick={() => setConfirming(true)} data-testid="kept-release-remove">
            Remove
          </Button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PathBox path={release.path} />
        </div>
        <RevealButton path={release.path} />
      </div>
      {confirming && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 12 }}>
          <span>Remove this file? Switching to {release.version} again downloads PsyNeuLink afresh.</span>
          <Button kind="danger" onClick={remove} disabled={busy} data-testid="kept-release-confirm-remove">
            {busy ? "Removing…" : "Remove"}
          </Button>
          <Button kind="small" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
        </div>
      )}
      {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Settings ▸ Developer: the managed copies and the checkouts PsyNeuView knows. */
export function ManagedCopiesAndCheckouts({
  locations,
  error,
  reload,
  macInstall,
}: LocationsState & { macInstall: MacAppInstall | null }) {
  const onRemoveRelease = async (version: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/settings/pnl-releases/${encodeURIComponent(version)}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return typeof data.detail === "string" ? data.detail : data.detail?.message ?? `HTTP ${r.status}`;
      }
      reload();
      return null;
    } catch {
      return "Couldn't reach PsyNeuView.";
    }
  };
  const onRemove = async (name: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/locations/managed-copies/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return typeof data.detail === "string" ? data.detail : data.detail?.message ?? `HTTP ${r.status}`;
      }
      reload();
      return null;
    } catch {
      return "Couldn't reach PsyNeuView.";
    }
  };
  const copies = locations?.managedCopies ?? [];
  const summary = locations
    ? `${copies.length} managed ${copies.length === 1 ? "copy" : "copies"} under ${abbreviateHome(locations.appData.sources)}`
    : undefined;
  const pvCheckouts = macInstall
    ? Array.from(new Set([macInstall.checkoutPath, ...macInstall.recentCheckouts].filter((p): p is string => !!p)))
    : locations?.psyneuview.kind === "checkout"
      ? [locations.psyneuview.path]
      : [];
  return (
    <Group id="managed-copies" title="Managed PsyNeuLink copies and checkouts" summary={summary} defaultFolded badge={<DeveloperBadge audience="developers" />}>
      {error && <div style={errorStyle}>Couldn't list them: {error}</div>}
      {!error && !locations && <div style={mutedStyle}>Loading…</div>}
      {locations && (
        <div style={{ fontSize: 13 }} data-testid="managed-copies">
          <div style={{ ...mutedStyle, marginBottom: 4 }}>
            Switching to a GitHub source keeps a clone under <code>{abbreviateHome(locations.appData.sources)}</code>. Old ones
            pile up; one not in use can be removed here. Nothing outside that folder is ever touched.
          </div>
          {copies.length === 0 && <div style={mutedStyle}>No managed copies yet.</div>}
          {copies.map((c) => (
            <ManagedCopyRow key={c.name} copy={c} onRemove={onRemove} />
          ))}

          <div style={{ fontWeight: 600, fontSize: 12, color: "var(--pnv-text-secondary)", margin: "12px 0 2px" }}>Kept official releases</div>
          <div style={{ ...mutedStyle, marginBottom: 4 }}>
            Installing an official release keeps its file under <code>{abbreviateHome(locations.releasesDir ?? "~/.psyneuview/releases")}</code>.
            Switching back reuses the kept PsyNeuLink download; a release whose dependencies differ may still need the network.
          </div>
          {(locations.keptReleases ?? []).length === 0 && <div style={mutedStyle}>No kept releases yet.</div>}
          {(locations.keptReleases ?? []).map((k) => (
            <KeptReleaseRow key={k.version} release={k} onRemove={onRemoveRelease} />
          ))}

          <div style={{ fontWeight: 600, fontSize: 12, color: "var(--pnv-text-secondary)", margin: "12px 0 2px" }}>Your checkouts</div>
          {locations.checkouts.length === 0 && pvCheckouts.length === 0 && (
            <div style={mutedStyle}>None yet. A checkout appears here once Settings has switched to it.</div>
          )}
          {locations.checkouts.map((c) => (
            <LocationRow
              key={c.path}
              id={`checkout-${c.path}`}
              name={c.label ? `PsyNeuLink — ${c.label}` : "PsyNeuLink checkout"}
              path={c.path}
              editable
              detail={c.in_use ? "The PsyNeuLink in use." : c.exists ? "A PsyNeuLink checkout used before." : "Used before; the folder is missing now."}
            />
          ))}
          {pvCheckouts.map((p) => (
            <LocationRow key={p} id={`checkout-${p}`} name="PsyNeuView checkout" path={p} editable detail="A PsyNeuView checkout." />
          ))}
        </div>
      )}
    </Group>
  );
}
