/**
 * Settings ▸ Folders: everything you can open, and where it lives. (#1295)
 *
 * One compact row per Open-menu section, in the menu's order: My Project
 * Folder (Change…, Move…, and the one-time offer to leave a hidden legacy
 * folder), your other catalogs (add, rename, remove — here, not in Open
 * menu), the PsyNeuLink Library and Examples (from the PsyNeuLink selected in
 * Developer), and the Reference and Demo models included with PsyNeuView.
 * Each row: its path, whose it is, and Show in Finder (Mac app) or Copy path
 * (browser). Where PsyNeuView and PsyNeuLink themselves are installed is
 * Developer's.
 *
 * Paths are typed rather than picked in a browser: the folders are on the
 * machine running the backend, which may not be this one. Inside the Mac app
 * the folder picker is offered.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCatalogStore, type MoveRecord } from "@/stores/catalogStore";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTourStore } from "@/stores/tourStore";
import { useUIStore } from "@/stores/uiStore";
import {
  SECTION_LABELS,
  SECTION_ORDER_CHANGED,
  catalogSectionId,
  getSectionOrder,
  getShownDevSections,
  isShownOnlyByDeveloperMode,
  type SectionId,
} from "@/stores/openMenuOrder";
import { hasFileBridge, pickOpenPath } from "@/utils/fileBridge";
import { hasSettingsBridge } from "@/utils/macAppSettings";
import { pnlSourceName, type PsyNeuLinkInfo } from "@/utils/pnlSources";
import { announceRecentPathsChanged, rewriteRecentPaths, rewriteUnder } from "@/utils/recentPaths";
import { DeveloperBadge } from "../DeveloperBadge";
import { DialogHeader } from "../dialog/DialogHeader";
import { useDismiss } from "../dialog/useDismiss";
import { openSettings } from "./sections";
import { Group, PathBox, abbreviateHome, errorStyle, linkStyle, mutedStyle } from "./shared";
import { LocationRow, useLocations } from "./WhereThingsLive";
import { Button } from "../Button";

/** `/api/catalog-sources`: where each built-in section reads its models from. */
interface CatalogSources {
  references?: string | null;
  demos?: string | null;
  library?: string | null;
  examples?: string | null;
  pnl?: PsyNeuLinkInfo | null;
}

function useCatalogSources(): CatalogSources | null {
  const [sources, setSources] = useState<CatalogSources | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/catalog-sources")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => alive && setSources(data || {}))
      .catch(() => alive && setSources({}));
    return () => {
      alive = false;
    };
  }, []);
  return sources;
}

export function FoldersSection() {
  const catalogs = useCatalogStore((s) => s.catalogs);
  const refresh = useCatalogStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const sources = useCatalogSources();
  const developerMode = useUIStore((s) => s.developerMode);
  const tourRunning = useTourStore((s) => s.activeTourId !== null);

  // The Open menu's order, kept in step with it.
  const catalogIds = useMemo(() => catalogs.map((c) => catalogSectionId(c.id)), [catalogs]);
  const [order, setOrder] = useState<string[]>(() => getSectionOrder(catalogIds));
  useEffect(() => setOrder(getSectionOrder(catalogIds)), [catalogIds]);
  useEffect(() => {
    const refreshOrder = () => setOrder(getSectionOrder(catalogIds));
    window.addEventListener(SECTION_ORDER_CHANGED, refreshOrder);
    return () => window.removeEventListener(SECTION_ORDER_CHANGED, refreshOrder);
  }, [catalogIds]);

  const pnlName = pnlSourceName(sources?.pnl);
  const fromPnl = (
    <>
      From the PsyNeuLink you've selected{pnlName ? `: ${pnlName}` : ""}.{" "}
      <Button onClick={() => openSettings("developer")} kind="link">
        Change in Developer
      </Button>
    </>
  );
  const badgeFor = (id: SectionId) =>
    isShownOnlyByDeveloperMode(id, { developerMode, tourRunning, shown: getShownDevSections() }) ? <DeveloperBadge /> : undefined;

  const rowFor = (id: string): ReactNode => {
    switch (id) {
      case "myModels":
        return <ProjectFolderRow key={id} />;
      case "library":
        return <LocationRow key={id} id="library" name={SECTION_LABELS.library} path={sources?.library ?? null} editable={false} detail={fromPnl} compact />;
      case "examples":
        return <LocationRow key={id} id="examples" name={SECTION_LABELS.examples} badge={badgeFor("examples")} path={sources?.examples ?? null} editable={false} detail={fromPnl} compact />;
      case "references":
        return <LocationRow key={id} id="references" name={SECTION_LABELS.references} badge={badgeFor("references")} path={sources?.references ?? null} editable={false} detail="Included with PsyNeuView." compact />;
      case "demos":
        return <LocationRow key={id} id="demos" name={SECTION_LABELS.demos} badge={badgeFor("demos")} path={sources?.demos ?? null} editable={false} detail="Included with PsyNeuView." compact />;
      default: {
        const catalog = catalogs.find((c) => catalogSectionId(c.id) === id);
        return catalog ? <CatalogRow key={id} catalog={catalog} /> : null;
      }
    }
  };

  return (
    <Group id="folders" title="Folders">
      <div data-testid="folders-list" style={{ fontSize: 13 }}>
        <div data-testid="catalog-settings">
          {order.map(rowFor)}
          <AddCatalogRow />
        </div>
        <WorkingCopiesRow />
        <LayoutsRow />
        <div style={{ ...mutedStyle, marginTop: 8 }}>
          App data stays hidden under <code>~/.psyneuview</code> (managed PsyNeuLink copies, working copies, caches) and{" "}
          <code>~/.psynewview.json</code> (settings). Where PsyNeuView and PsyNeuLink are installed, and the
          managed copies: Developer.
        </div>
      </div>
    </Group>
  );
}

/**
 * My Project Folder (#1229, #1295). Change… points PsyNeuView at another
 * folder; Move… moves the folder and everything in it; the one-time offer
 * leads to the same move.
 */
function ProjectFolderRow() {
  const { projectFolder, canEdit, setProjectFolder, dismissMoveOffer } = useCatalogStore();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The Move… dialog, with the folder it suggests (the one-time offer's, or none).
  const [moving, setMoving] = useState<{ suggested: string | null } | null>(null);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const canChange = canEdit && !!projectFolder && !projectFolder.fixed;

  const actions = canChange ? (
    <>
      <Button
        kind="small"
        onClick={() => setProjectPath(projectFolder?.path ?? "")}
        data-testid="setting-project-folder"
        title="Point PsyNeuView at another folder. Nothing is moved."
      >
        Change…
      </Button>
      <Button
        kind="small"
        onClick={() => setMoving({ suggested: null })}
        data-testid="project-folder-move"
        title="Move the folder and everything in it somewhere else"
      >
        Move…
      </Button>
    </>
  ) : null;

  return (
    <div data-testid="project-folder-settings">
      <LocationRow
        id="project-folder"
        name={SECTION_LABELS.myModels}
        path={projectFolder?.path ?? null}
        pathTestId="project-folder-current"
        editable
        compact
        detail="Where new models are saved. Can be moved, not removed."
        actions={projectPath === null ? actions : null}
        below={
          <>
            {projectPath !== null && (
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <input
                  style={{ ...fieldStyle, flex: 1 }}
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="/path/to/folder"
                  data-testid="project-folder-path"
                />
                <Button
                  kind="small"
                  onClick={async () => {
                    const err = await setProjectFolder(projectPath);
                    setError(err);
                    if (!err) setProjectPath(null);
                  }}
                >
                  Set
                </Button>
                <Button kind="small" onClick={() => { setProjectPath(null); setError(null); }}>
                  Cancel
                </Button>
              </div>
            )}
            {projectFolder?.fixed && hasSettingsBridge() && (
              // The Mac app sets the variable itself on launch, so inside the
              // app this is the app's doing, not a developer's.
              <div data-testid="project-folder-fixed" data-fixed-by="mac-app" style={{ fontSize: 11, color: "var(--pnv-text-muted)", marginTop: 2 }}>
                Set by the PsyNeuView app. Moving it from here comes in a later version.
              </div>
            )}
            {projectFolder?.fixed && !hasSettingsBridge() && (
              // Regular users never set this variable; developer setups and the test
              // suite do. Say so, and mark it as developer territory.
              <div data-testid="project-folder-fixed" style={{ fontSize: 11, color: "var(--pnv-text-muted)", marginTop: 2 }}>
                Fixed by the <code>{projectFolder.fixedBy ?? "PSYNEWVIEW_MODELS_DIR"}</code> environment
                variable, which developers and the test suite set. Regular users never need it.
                <DeveloperBadge audience="developers" />
              </div>
            )}
            {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
            {canChange && projectFolder.moveOffer && (
              // The one-time offer (#1295): models sit in a hidden legacy folder.
              // Nothing moves without a yes; "Not now" is remembered.
              <div
                data-testid="project-folder-move-offer"
                role="note"
                style={{ marginTop: 6, padding: "6px 10px", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)", borderRadius: 4, fontSize: 12, display: "flex", gap: 8 }}
              >
                <span aria-hidden="true" style={{ color: "var(--pnv-warning)", fontSize: 14, lineHeight: "18px" }}>⚠</span>
                <span>
                  <strong>Hidden folder:</strong> your models are in <code>{abbreviateHome(projectFolder.moveOffer.from)}</code>,
                  which Finder doesn't show. Move them to <code>{abbreviateHome(projectFolder.moveOffer.to)}</code>, where
                  Finder, backups and iCloud can see them? Everything moves together, nothing is deleted until the copy is
                  checked, and you can move it back later.
                  <span style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <Button
                      kind="small"
                      onClick={() => setMoving({ suggested: projectFolder.moveOffer!.to })}
                      data-testid="project-folder-move-offer-accept"
                    >
                      Move…
                    </Button>
                    <Button kind="small" onClick={() => void dismissMoveOffer()} data-testid="project-folder-move-offer-dismiss">
                      Not now
                    </Button>
                  </span>
                </span>
              </div>
            )}
          </>
        }
      />
      {moving && projectFolder && (
        <MoveProjectFolderDialog
          from={projectFolder.path}
          suggested={moving.suggested}
          onClose={() => setMoving(null)}
          onMoved={(record) => {
            setMoving(null);
            addNotification(
              "success",
              `Moved My Project Folder to ${abbreviateHome(record.to)} (${record.files} files).` +
                (record.warning ? ` ${record.warning}` : ""),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Where edits to included models are kept (#1319). Opening a Reference Model
 * (or a Demo, or a PsyNeuLink Example from a managed install) copies it here
 * and the copy is what you edit; the bundled original is never changed. The
 * folder is outside every install, so the edits survive an app update. Read
 * only: there is nothing to change about it from here.
 */
function WorkingCopiesRow() {
  const { locations } = useLocations();
  const path = locations?.appData.workingCopies;
  if (!path) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <LocationRow
        id="working-copies"
        name="Working copies of included models"
        path={path}
        editable
        compact
        detail="Where your edits to Reference Models and PsyNeuLink Examples are kept; the included originals are never changed. Demo models start fresh each time they're opened. Kept outside the app, so an update doesn't lose them."
        below={
          locations?.appData.workingCopiesFixedBy ? (
            <div style={{ fontSize: 11, color: "var(--pnv-text-muted)", marginTop: 2 }}>
              Fixed by the <code>{locations.appData.workingCopiesFixedBy}</code> environment variable, which developers
              and the test suite set.
              <DeveloperBadge audience="developers" />
            </div>
          ) : null
        }
      />
    </div>
  );
}

/**
 * Where layouts and labels for read-only PsyNeuLink files are kept (#1321).
 * A library model from a PsyNeuLink that PsyNeuView manages (a GitHub copy,
 * a git+ install, an official release) can't be edited, but moving its nodes
 * is still recorded — here, keyed by where the PsyNeuLink came from, outside
 * the install, so a reinstall or a switch of release doesn't lose them. Read
 * only: there is nothing to change about it from here.
 */
function LayoutsRow() {
  const { locations } = useLocations();
  const path = locations?.appData.layouts;
  if (!path) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <LocationRow
        id="layouts"
        name="Layouts for read-only PsyNeuLink files"
        path={path}
        editable
        compact
        detail="Where the node positions and labels you set on a PsyNeuLink Library model are kept when that PsyNeuLink is one PsyNeuView manages (its files are read only). Kept by source, outside the install, so switching or updating PsyNeuLink doesn't lose them."
        below={
          locations?.appData.layoutsFixedBy ? (
            <div style={{ fontSize: 11, color: "var(--pnv-text-muted)", marginTop: 2 }}>
              Fixed by the <code>{locations.appData.layoutsFixedBy}</code> environment variable, which developers
              and the test suite set.
              <DeveloperBadge audience="developers" />
            </div>
          ) : null
        }
      />
    </div>
  );
}

/** One of the user's own catalogs (#1229): rename it, or take it off the menu. */
function CatalogRow({ catalog }: { catalog: { id: string; name: string; path: string; exists: boolean } }) {
  const { canEdit, rename, remove } = useCatalogStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (p: Promise<string | null>, after?: () => void) => {
    const err = await p;
    setError(err);
    if (!err) after?.();
  };
  return (
    <LocationRow
      id={`catalog-${catalog.id}`}
      name={catalog.name}
      path={catalog.path}
      editable
      compact
      detail={catalog.exists ? "A catalog of yours." : "A catalog of yours. Its folder is missing."}
      actions={
        canEdit && renaming === null ? (
          <>
            <Button kind="small" onClick={() => setRenaming(catalog.name)} data-testid={`rename-catalog-${catalog.id}`}>
              Rename
            </Button>
            <Button
              kind="danger"
              onClick={() => run(remove(catalog.id))}
              title="Take it off the Open menu. The folder and its files are left alone."
              data-testid={`remove-catalog-${catalog.id}`}
            >
              Remove
            </Button>
          </>
        ) : null
      }
      below={
        <>
          {renaming !== null && (
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                aria-label="Catalog name"
                autoFocus
              />
              <Button kind="small" onClick={() => run(rename(catalog.id, renaming), () => setRenaming(null))}>
                Save
              </Button>
              <Button kind="small" onClick={() => setRenaming(null)}>Cancel</Button>
            </div>
          )}
          {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
        </>
      }
    />
  );
}

/** Add another folder of models as a catalog: its own Open-menu section. */
function AddCatalogRow() {
  const { canEdit, add } = useCatalogStore();
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    const picked = await pickOpenPath({ directories: true, message: "Choose a folder of models to add as a catalog" });
    if (picked) setNewPath(picked);
  };
  if (!canEdit) {
    return <div style={{ fontSize: 11, color: "var(--pnv-text-faint)", marginTop: 6 }}>Catalogs can't be changed on the shared hosted PsyNeuView.</div>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...mutedStyle, marginBottom: 4 }}>Add another folder of models as a catalog: its own section of the Open menu.</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          style={{ ...fieldStyle, flex: 2 }}
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="Folder to add, e.g. ~/lab/models"
          data-testid="add-catalog-path"
        />
        {hasFileBridge() && (
          <Button kind="small" onClick={choose}>
            Choose…
          </Button>
        )}
        <input
          style={{ ...fieldStyle, flex: 1 }}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name (optional)"
          data-testid="add-catalog-name"
        />
        <Button
          kind="small"
          disabled={!newPath.trim()}
          onClick={async () => {
            const err = await add(newPath.trim(), newName.trim());
            setError(err);
            if (!err) {
              setNewPath("");
              setNewName("");
            }
          }}
          data-testid="setting-catalogs"
        >
          Add
        </Button>
      </div>
      {error && <div style={{ ...errorStyle, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  fontSize: 12, padding: "2px 6px", border: "1px solid var(--pnv-border-light)", borderRadius: 3, minWidth: 0,
};

/**
 * Move… (#1295): pick where the folder goes, then the backend moves the
 * models with their sidecars, keeps the setting and catalogs pointing at the
 * new place, and this side follows with the recent files and the open file.
 * Inside the Mac app the destination comes from the native folder picker; in
 * a browser it is typed, because the folder is on the machine running the
 * backend, which may not be this one.
 */
function MoveProjectFolderDialog({
  from,
  suggested,
  onClose,
  onMoved,
}: {
  from: string;
  suggested: string | null;
  onClose: () => void;
  onMoved: (record: MoveRecord) => void;
}) {
  const moveProjectFolder = useCatalogStore((s) => s.moveProjectFolder);
  const [to, setTo] = useState(suggested ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDismiss(true, onClose);

  const choose = async () => {
    const picked = await pickOpenPath({ directories: true, message: "Choose where to move My Project Folder" });
    if (picked) setTo(picked);
  };

  const move = async () => {
    setBusy(true);
    setError(null);
    const result = await moveProjectFolder(to.trim());
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // What this browser remembers follows the folder: recent files, and the file open now.
    rewriteRecentPaths(result.record.from, result.record.to);
    announceRecentPathsChanged();
    const open = useModelStore.getState().filePath;
    if (open) {
      const moved = rewriteUnder(open, result.record.from, result.record.to);
      if (moved !== open) useModelStore.setState({ filePath: moved });
    }
    onMoved(result.record);
  };

  const field: React.CSSProperties = { ...fieldStyle, flex: 1, padding: "4px 6px", border: "1px solid var(--pnv-border)", borderRadius: 4, fontFamily: "monospace" };
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--pnv-scrim)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-project-folder-title"
        data-testid="project-folder-move-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--pnv-surface)", borderRadius: 12, width: "92%", maxWidth: 560, display: "flex", flexDirection: "column", boxShadow: "var(--pnv-shadow-dialog)", overflow: "hidden" }}
      >
        <DialogHeader title="Move My Project Folder" titleId="move-project-folder-title" onClose={onClose} />
        <div style={{ padding: "14px 20px", fontSize: 13, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={mutedStyle}>From</div>
            <PathBox path={from} />
          </div>
          <div>
            <div style={mutedStyle}>To</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={hasFileBridge() ? "Choose a folder…" : "/path/to/the/new/folder"}
                data-testid="project-folder-move-to"
                style={field}
                disabled={busy}
                autoFocus
              />
              {hasFileBridge() && (
                <Button kind="small" onClick={choose} disabled={busy}>
                  Choose…
                </Button>
              )}
            </div>
          </div>
          <div style={mutedStyle}>
            The models and their layout and label files move together. Nothing is deleted until the copy is checked; if
            anything fails, the old folder stays as it is. A folder that already has files is fine as long as no names
            clash. Moving back is just another move.
          </div>
          {error && (
            <div data-testid="project-folder-move-error" style={errorStyle}>
              {error}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 20px", borderTop: "1px solid var(--pnv-border-faint)" }}>
          <Button kind="secondary" size="compact" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={move}
            disabled={busy || !to.trim()}
            data-testid="project-folder-move-confirm"
            kind="primary"
            size="compact"
          >
            {busy ? "Moving…" : "Move"}
          </Button>
        </div>
      </div>
    </div>
  );
}
