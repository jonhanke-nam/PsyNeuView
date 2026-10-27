/**
 * Top toolbar with file operations, model browser, and demo models.
 */

import { BusyIndicator } from "@/components/common/BusyIndicator";
import { Z_MENU } from "@/constants/zLayers";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { errorDetail } from "@/utils/errorDetail";
import { Button } from "@/components/common/Button";
import { MENU_ROW_HOVER, menuRowColours, toggleColours } from "@/components/common/toolbarStyles";
import { useModelStore } from "@/stores/modelStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { useTourStore } from "@/stores/tourStore";
import { useCatalogOpener } from "@/stores/catalogOpenerStore";
import { menuGroups, orientationWalkthroughs } from "@/utils/tourStep";
import { loadFoldedSections, saveFoldedSections, toggleFolded, unfoldActive } from "@/utils/tutorialsMenuFold";
import { readOfferChoice, shouldRemindFromMenu, writeOfferChoice } from "@/utils/orientationOffer";
import { useNotificationStore } from "@/stores/notificationStore";
import { PresenceIndicator } from "@/components/common/PresenceIndicator";
import { AppUpdateNotice } from "@/components/common/AppUpdateNotice";
import { importModelFiles, IMPORT_ACCEPT_ATTR } from "@/utils/importModelFiles";
import { useStatusStore } from "@/stores/statusStore";
import { useLayoutStore, type LayoutPreset } from "@/stores/layoutStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { focusComposition } from "@/utils/nodeActions";
import { hasFileBridge, pickOpenPath, pickSavePath } from "@/utils/fileBridge";
import { logLoadPerf } from "@/utils/loadPerf";
import { PromptModal } from "@/components/common/PromptModal";
import { DialogCloseButton, DialogHeader } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { FileBrowserModal } from "@/components/common/FileBrowserModal";
import {
  SAVE_FORMATS,
  getFormatById,
  describeDestinations,
  type SaveDestination,
} from "@/components/common/exportFormats";
import { SettingsPanel } from "@/components/common/SettingsPanel";
import { DeveloperBadge } from "@/components/common/DeveloperBadge";
import { DeveloperModeIndicator } from "./DeveloperModeIndicator";
import { onOpenSettings, type SettingsSectionId } from "@/components/common/settings/sections";
import { onOpenSettingsRequest } from "@/utils/macAppSettings";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_ORDER_CHANGED,
  getCollapsedSectionsDefaultingToFolded,
  SECTION_LABELS,
  canMoveSection,
  catalogSectionId,
  getSectionOrder,
  getShownDevSections,
  isSectionVisible,
  isShownOnlyByDeveloperMode,
  type SectionId,
  persistCollapsedSections,
  persistSectionOrder,
} from "@/stores/openMenuOrder";
import { useCatalogStore } from "@/stores/catalogStore";
import { UndoRedoButtons } from "@/components/common/UndoRedoButtons";
import { HistoryPanel } from "@/components/common/HistoryPanel";
import { useChangesSinceSaveStore } from "@/stores/changesSinceSaveStore";
import { GithubFileLoaderModal } from "@/components/common/GithubFileLoaderModal";
import {
  DeveloperTestsModal,
  type ExtractedTest,
} from "@/components/common/DeveloperTestsModal";
import { useUIStore } from "@/stores/uiStore";
import { isManaged, isOwnCheckout, isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { onPnlSourceChanged } from "@/utils/pnlSourceEvents";
import { RECENT_PATHS_CHANGED, addRecentPath, getRecentPaths } from "@/utils/recentPaths";
import { pnlSourceLabel, sourceSwitchNote, type PsyNeuLinkInfo } from "@/utils/pnlSources";
import { abbreviateHome } from "@/components/common/settings/shared";
import { record as recordActivity, recordMenuClick } from "@/utils/activityLog";
import { noteModelOrigin } from "@/utils/diagnostics";
import { SAVE_COPY_EVENT, requestSaveCopy } from "@/utils/saveRequest";
import { stripProtectionLine } from "@/utils/protectionLine";
import { AutosaveStatus } from "./AutosaveStatus";
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";

function newModelTemplate(pnlVersion: string) {
  return `# PsyNeuLink Model File
# Format Version: 1.0
# PsyNeuLink: ${pnlVersion}
# Model: my_model

import psyneulink as pnl

# ==============================================================
# Mechanisms
# ==============================================================

input_node = pnl.TransferMechanism(
    input_shapes=[1],
    function=pnl.Linear(),
    name='input_node'
)

output_node = pnl.TransferMechanism(
    input_shapes=[1],
    function=pnl.Linear(),
    name='output_node'
)

# ==============================================================
# Projections
# ==============================================================

input_to_output = pnl.MappingProjection(
    sender=input_node,
    receiver=output_node,
    name='input_to_output'
)

# ==============================================================
# Compositions
# ==============================================================

my_model = pnl.Composition(name='my_model')
my_model.add_node(input_node)
my_model.add_node(output_node)
my_model.add_projection(input_to_output)
`;
}

const EXPANDED_FOLDERS_KEY = "psyneuview.loadModelDropdown.expandedFolders";
const REFERENCE_ORDER_KEY = "psyneuview.referenceModels.order";

interface DemoModel {
  name: string;
  label: string;
  pristine_path: string;
}

interface UserModel {
  name: string;
  label: string;
  path: string;
  relative: string;
  directory: string;
  folder: string | null;
}

interface LibraryModel {
  name: string;
  label: string;
  path: string;
}

interface ReferenceModel {
  name: string;
  label: string;
  pristine_path: string;
}

function getExpandedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function persistExpandedFolders(folders: Set<string>) {
  localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(Array.from(folders)));
}

function getReferenceOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REFERENCE_ORDER_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistReferenceOrder(names: string[]) {
  localStorage.setItem(REFERENCE_ORDER_KEY, JSON.stringify(names));
}

// Apply the user's saved order to the curated reference-model list. Known
// names sort by saved rank; names not in the saved order (e.g. newly added
// reference models) keep their curated position at the end.
function applyReferenceOrder(models: ReferenceModel[]): ReferenceModel[] {
  const order = getReferenceOrder();
  if (order.length === 0) return models;
  const rank = new Map(order.map((n, i) => [n, i]));
  return [...models].sort((a, b) => {
    const ra = rank.has(a.name) ? (rank.get(a.name) as number) : Number.POSITIVE_INFINITY;
    const rb = rank.has(b.name) ? (rank.get(b.name) as number) : Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  border: "none",
  background: "none",
  cursor: "pointer",
  fontSize: "var(--pnv-fs-13)",
  borderBottom: "1px solid var(--pnv-surface-sunken)",
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: "var(--pnv-fs-11)",
  color: "var(--pnv-text-secondary)",
  background: "var(--pnv-surface-sunken)",
  borderTop: "1px solid var(--pnv-border-light)",
  borderBottom: "1px solid var(--pnv-border-light)",
  fontWeight: 700,
};

// Top-level zone divider in the Open menu (#350): separates "do an action"
// from "pick from a catalog" from "go back to something recent". Visually
// dominant over sectionHeaderStyle (the catalog sub-headers nested under it).
const zoneHeaderStyle: React.CSSProperties = {
  padding: "8px 12px 6px",
  fontSize: "var(--pnv-fs-10)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--pnv-text-body)",
  background: "var(--pnv-surface-band)",
  borderTop: "2px solid var(--pnv-border)",
  borderBottom: "1px solid var(--pnv-border-light)",
  fontWeight: 800,
};

/** One known MDF round-trip gap in the model, from /api/model/mdf-gaps. */
interface MdfGap {
  issue: number;
  upstream: string | null;
  severity: "warning" | "info";
  title: string;
  detail: string;
  items: string[];
}

export function Toolbar() {
  const filePath = useModelStore((s) => s.filePath);
  const source = useModelStore((s) => s.source);
  const savedSource = useModelStore((s) => s.savedSource);
  const setFilePath = useModelStore((s) => s.setFilePath);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const setSource = useModelStore((s) => s.setSource);
  const bundleOrigin = useModelStore((s) => s.bundleOrigin);
  const setBundleOrigin = useModelStore((s) => s.setBundleOrigin);
  const currentReference = useModelStore((s) => s.currentReference);
  const setCurrentReference = useModelStore((s) => s.setCurrentReference);
  const gscConditions = useModelStore((s) => s.gscConditions);
  const compositionOptions = useModelStore((s) => s.compositionOptions);
  // #717: the Flatten / PyTorch view modes live in the composition selector.
  const flatView = useGraphSettings((s) => s.flat);
  const pytorchView = useGraphSettings((s) => s.pytorch);
  const activeCompForView = useModelStore((s) => s.activeComposition);
  const compositionMetaForView = useModelStore((s) => s.compositionMeta);
  const activeIsAutodiff = !!(
    activeCompForView && compositionMetaForView[activeCompForView]?.isAutodiff
  );
  const addNotification = useNotificationStore((s) => s.addNotification);
  const clearNotifications = useNotificationStore((s) => s.clearAll);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>(getRecentPaths());
  const [demos, setDemos] = useState<DemoModel[]>([]);
  const [referenceModels, setReferenceModels] = useState<ReferenceModel[]>([]);
  // How many of the two bundled lists (demos, reference models) have answered.
  // A walkthrough looks its model up by name in both, so it waits for both.
  const [bundledListsSettled, setBundledListsSettled] = useState(0);
  const [reorderReference, setReorderReference] = useState(false);
  const [refDragIndex, setRefDragIndex] = useState<number | null>(null);
  const [libraryModels, setLibraryModels] = useState<LibraryModel[]>([]);
  // PsyNeuLink's own examples, live from the active source's Scripts/ (#843).
  const [pnlExamples, setPnlExamples] = useState<LibraryModel[]>([]);
  // Per-example load status for the live-section badges (#843/#839), fetched
  // lazily the first time the menu opens (the probe runs the whole corpus).
  const [pnlStatus, setPnlStatus] = useState<
    Record<
      string,
      { load: string; run?: string; error?: string; runError?: string; nodes?: number }
    >
  >({});
  const pnlStatusFetched = useRef(false);
  const [userModels, setUserModels] = useState<UserModel[]>([]);
  const [currentDemo, setCurrentDemo] = useState<string | null>(null);
  const [pristineSource, setPristineSource] = useState<string | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  // The open model's file has a protection line (#1346): a .py copy is
  // written without it, and the dialog says so.
  const copyStartsUnprotected = useEditLockStore(
    (st) => st.rule === "protected" || st.rule === "protectedPermanently" || st.unlockedHere,
  );
  // "Save a copy as…" asks two independent questions (#1067): which format,
  // and where it goes. They used to be one — .py meant server, anything else
  // meant download — which reads fine locally and misleads badly in a
  // container, where "saved" means "in a container you cannot browse".
  const [saveAsFormat, setSaveAsFormat] = useState("py");
  const [saveAsDest, setSaveAsDest] = useState<SaveDestination>("server");
  // Undefined on a backend predating the deployment block; the destination
  // labels fall back to wording that is true either way.
  const [deploymentMode, setDeploymentMode] = useState<string | undefined>();
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which section Settings opens on: the one asked for, or null for the last
  // one shown (#1290). The Mac app's Settings… (⌘,) opens this same Settings
  // (PsyNeuView-MacApp#200), on the last section.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const openSettingsAt = useCallback((section: SettingsSectionId | null) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);
  useEffect(() => onOpenSettingsRequest(() => openSettingsAt(null)), [openSettingsAt]);
  useEffect(() => onOpenSettings(openSettingsAt), [openSettingsAt]);
  const [githubLoaderOpen, setGithubLoaderOpen] = useState(false);
  const [devTestsOpen, setDevTestsOpen] = useState(false);
  const developerMode = useUIStore((s) => s.developerMode);
  const [promptState, setPromptState] = useState<{
    title: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void;
  } | null>(null);
  // Plain-web file navigator for "Open from path" (#618).
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  // Native-picker destination override (#347); "" = backend default dir.
  const [saveAsDir, setSaveAsDir] = useState("");
  const [defaultSaveDir, setDefaultSaveDir] = useState<string>("");
  // Resolved on-disk source dir per catalog, for the header tooltips (#853).
  const [catalogSources, setCatalogSources] = useState<{
    references?: string;
    demos?: string;
    library?: string | null;
    examples?: string | null;
    myModels?: string;
    pnlGit?: {
      repo?: string | null;
      branch?: string | null;
      commit?: string | null;
      behind?: number | null;
    } | null;
    /** The installed PsyNeuLink, which the Library and Examples come from (#1295). */
    pnl?: PsyNeuLinkInfo | null;
  }>({});
  // #1295: right after a PsyNeuLink switch, the menu says once what changed.
  // Armed by the switch announcement, written when the new source arrives,
  // shown until dismissed; the next switch starts over.
  const [switchNoteArmed, setSwitchNoteArmed] = useState(false);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  // The source known when the switch was announced: the note waits for the
  // refetched one, not for what the menu still held from before.
  const pnlBeforeSwitchRef = useRef<PsyNeuLinkInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!switchNoteArmed || !catalogSources.pnl || catalogSources.pnl === pnlBeforeSwitchRef.current) return;
    setSwitchNoteArmed(false);
    setSwitchNote(sourceSwitchNote(catalogSources.pnl));
  }, [switchNoteArmed, catalogSources.pnl]);
  const catalogSourcesRef = useRef(catalogSources);
  catalogSourcesRef.current = catalogSources;
  const projectFolder = useCatalogStore((s) => s.projectFolder);
  // What each Open menu section's heading says about where it comes from.
  const pnlSectionSource = pnlSourceLabel(catalogSources.pnl);
  const INCLUDED_SOURCE = "included with PsyNeuView";
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    getExpandedFolders()
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      persistExpandedFolders(next);
      return next;
    });
  };

  // Collapsible top-level catalog sections in the Open menu (#845).
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() =>
    getCollapsedSectionsDefaultingToFolded()
  );
  // #1135: the order of the four top-level sections, draggable by their headers.
  // #1229: the user's own catalogs are sections too, ordered and folded alike.
  const catalogs = useCatalogStore((s) => s.catalogs);
  const refreshCatalogs = useCatalogStore((s) => s.refresh);
  const catalogIds = useMemo(() => catalogs.map((c) => catalogSectionId(c.id)), [catalogs]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => getSectionOrder());
  const [sectionDragId, setSectionDragId] = useState<string | null>(null);
  useEffect(() => setSectionOrder(getSectionOrder(catalogIds)), [catalogIds]);

  // The order can also be changed from Settings (#1135). Without this, the menu
  // keeps rendering whatever it read at mount and only catches up on reload —
  // so a move in Settings appeared to do nothing until the page was refreshed.
  // Catalogs still under development show only when asked for (#1228).
  const [shownDevSections, setShownDevSections] = useState<Set<string>>(getShownDevSections);
  const tourRunning = useTourStore((s) => s.activeTourId !== null);
  const sectionVisible = (id: string) =>
    isSectionVisible(id, { developerMode, tourRunning, shown: shownDevSections });
  // #1291: a section on the menu only because of developer mode says so.
  const sectionLabel = (id: SectionId) => (
    <>
      {SECTION_LABELS[id]}
      {isShownOnlyByDeveloperMode(id, { developerMode, tourRunning, shown: shownDevSections }) && (
        <DeveloperBadge />
      )}
    </>
  );

  useEffect(() => {
    const refresh = () => {
      setSectionOrder(getSectionOrder(catalogIds));
      setShownDevSections(getShownDevSections());
    };
    window.addEventListener(SECTION_ORDER_CHANGED, refresh);
    return () => window.removeEventListener(SECTION_ORDER_CHANGED, refresh);
  }, [catalogIds]);

  const moveSection = (from: string, to: string) => {
    // Only sections in the order move; "Recent" has a header but no place in it.
    if (from === to || !sectionOrder.includes(from) || !sectionOrder.includes(to)) return;
    // The catalogs under development stay below the everyday sections (#1295).
    if (!canMoveSection(sectionOrder, sectionOrder.indexOf(from), sectionOrder.indexOf(to))) return;
    setSectionOrder((prev) => {
      const next = prev.filter((id) => id !== from);
      next.splice(next.indexOf(to), 0, from);
      persistSectionOrder(next);
      return next;
    });
  };
  const isSectionCollapsed = (id: string) => collapsedSections.has(id);
  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistCollapsedSections(next);
      return next;
    });
  };
  // Catalog header tooltip: the section's lineage plus the exact on-disk source
  // directory it's read from (#853), e.g. so you can see whether "PsyNeuLink
  // Library" points into the installed package vs your vendored Reference Models.
  const withPath = (desc: string, path?: string | null) =>
    path ? `${desc}\n\nSource: ${path}` : desc;

  // For PsyNeuLink-sourced catalogs (Library / Examples), append the active
  // clone's repo/branch/commit and freshness. `behind` is vs the last-fetched
  // origin ref (not a live remote check) — clone_manager fetches on source
  // re-select, so a non-zero count means the local clone is pinned behind that
  // last sync (#853).
  const gitSuffix = (g?: typeof catalogSources.pnlGit) => {
    if (!g || !g.commit) return "";
    let line = `${g.repo ?? ""} ${g.branch ?? "(detached)"} @ ${g.commit}`.trim();
    if (g.behind != null) {
      line +=
        g.behind > 0
          ? ` · ${g.behind} behind origin (as of last fetch — re-select the source to update)`
          : " · up to date with origin (as of last fetch)";
    }
    return `\n${line}`;
  };

  // Clickable catalog-section header with a fold chevron. `right` renders extra
  // controls (e.g. the reference reorder toggle) that must not trigger the fold.
  const renderSectionHeader = (
    id: string,
    label: React.ReactNode,
    opts?: {
      style?: React.CSSProperties;
      title?: string;
      right?: React.ReactNode;
      /** Where the section's models come from, in a few quiet words (#1295). */
      source?: string | null;
    },
  ) => (
    <div
      // #1135: drag a header to reorder the sections. The whole header is the
      // handle, but the toggle button inside it stays clickable — a drag has to
      // start with a movement, so a plain click still folds.
      // Stable handle per section, for the guided walkthroughs (#1310).
      data-testid={`open-menu-section-${id}`}
      draggable
      onDragStart={(e) => {
        setSectionDragId(id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (sectionDragId && sectionDragId !== id) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (sectionDragId) moveSection(sectionDragId, id);
        setSectionDragId(null);
      }}
      onDragEnd={() => setSectionDragId(null)}
      style={{
        ...sectionHeaderStyle,
        ...opts?.style,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        cursor: "grab",
        // Show where a drop would land, rather than leaving the drag unanswered.
        opacity: sectionDragId === id ? 0.4 : 1,
        borderTop:
          sectionDragId && sectionDragId !== id
            ? "2px solid transparent"
            : undefined,
      }}
      title={opts?.title ?? "Drag to reorder this section"}
    >
      <button
        onClick={() => toggleSection(id)}
        aria-expanded={!isSectionCollapsed(id)}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: 0,
          font: "inherit",
          color: "inherit",
          fontWeight: "inherit",
          textAlign: "left",
        }}
      >
        {/*
          Same glyph and size as the Components palette, so the two fold
          controls read as the same control. The small ▸/▾ pair sits well
          inside its em box, so bumping its size alone still left a speck —
          ▶/▼ fills the box and is legible at the same 11px.
        */}
        <span aria-hidden="true" style={{ fontSize: "var(--pnv-fs-11)", width: 13, color: "var(--pnv-text-hint)" }}>
          {isSectionCollapsed(id) ? "▶" : "▼"}
        </span>
        <span>{label}</span>
        {opts?.source && (
          <span
            data-testid="open-menu-section-source"
            style={{
              marginLeft: "auto",
              paddingLeft: 10,
              fontSize: "var(--pnv-fs-10)",
              fontWeight: 400,
              color: "var(--pnv-text-faint)",
              textTransform: "none",
              letterSpacing: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 300,
            }}
          >
            {opts.source}
          </span>
        )}
      </button>
      {opts?.right}
    </div>
  );

  // Fetch demos and user models on mount
  useEffect(() => {
    fetch("/api/demos")
      .then((r) => r.json())
      .then((data) => setDemos(data.demos || []))
      .catch(() => {})
      .finally(() => setBundledListsSettled((n) => n + 1));
    fetch("/api/reference-models")
      .then((r) => r.json())
      .then((data) => setReferenceModels(applyReferenceOrder(data.models || [])))
      .catch(() => {})
      .finally(() => setBundledListsSettled((n) => n + 1));
    refreshPnlCatalogs();
    refreshUserModels();
    void useCatalogStore.getState().refresh();
    fetch("/api/models/dirs")
      .then((r) => r.json())
      .then((data) => setDefaultSaveDir(data.default_save_dir || ""))
      .catch(() => {});
  }, []);

  // What the Open menu got from the installed PsyNeuLink: the Library, the
  // examples, and where each catalog lives. Fetched again after a source
  // switch in Settings, which replaces those files (#1253).
  const refreshPnlCatalogs = () => {
    fetch("/api/library-models")
      .then((r) => r.json())
      .then((data) => setLibraryModels(data.models || []))
      .catch(() => {});
    fetch("/api/psyneulink-examples")
      .then((r) => r.json())
      .then((data) => setPnlExamples(data.models || []))
      .catch(() => {});
    fetch("/api/catalog-sources")
      .then((r) => r.json())
      .then((data) => setCatalogSources(data || {}))
      .catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      onPnlSourceChanged(() => {
        pnlBeforeSwitchRef.current = catalogSourcesRef.current.pnl;
        setSwitchNoteArmed(true);
        refreshPnlCatalogs();
      }),
    [],
  );
  // And whenever the menu opens (#1395): the announcement above can come
  // while the server is restarting, and a failed fetch kept the old install's
  // label and paths until the window was reloaded. The Library header and its
  // tooltip only show with the menu open, so this is when they need to be right.
  useEffect(() => {
    if (dropdownOpen) refreshPnlCatalogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen]);
  // Settings rewrites the recent paths when the project folder moves (#1295).
  useEffect(() => {
    const refresh = () => setRecentPaths(getRecentPaths());
    window.addEventListener(RECENT_PATHS_CHANGED, refresh);
    return () => window.removeEventListener(RECENT_PATHS_CHANGED, refresh);
  }, []);

  const refreshUserModels = () => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => setUserModels(data.models || []))
      .catch(() => {});
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as HTMLElement) &&
        // A walkthrough explaining the menu uses the bar's own buttons (Next,
        // Replay) while the menu is open; those are not "elsewhere" (#1310).
        !(e.target as HTMLElement).closest?.('[data-testid="tour-bar"]')
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  // Escape closes the menu — the innermost open thing first (#1289).
  useDismiss(dropdownOpen, () => setDropdownOpen(false));
  // Save a copy as… closes the same ways, but not while it is saving.
  useDismiss(saveAsOpen && !exporting, () => setSaveAsOpen(false));

  // Leave reference-model reorder mode whenever the dropdown closes.
  useEffect(() => {
    if (!dropdownOpen) {
      setReorderReference(false);
      setRefDragIndex(null);
    }
  }, [dropdownOpen]);

  // Lazily probe live-example load status the first time the menu opens with
  // examples present — the probe runs the whole corpus, so don't do it on mount
  // or on every open. Backend caches by source commit (#843/#839).
  useEffect(() => {
    if (!dropdownOpen || pnlStatusFetched.current || pnlExamples.length === 0) return;
    pnlStatusFetched.current = true;
    fetch("/api/psyneulink-examples/status")
      .then((r) => r.json())
      .then((data) => setPnlStatus(data.status || {}))
      .catch(() => {});
  }, [dropdownOpen, pnlExamples.length]);

  const moveReference = (from: number, to: number) => {
    setReferenceModels((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      persistReferenceOrder(next.map((m) => m.name));
      return next;
    });
  };

  // Suggest a filename for Save As based on current file
  const suggestSaveAsName = useCallback(() => {
    const currentPath = useModelStore.getState().filePath;
    if (!currentPath) return "";
    const basename = currentPath.split("/").pop() || "";
    const name = basename.replace(/\.py$/, "");
    // If the file is already in the models dir, suggest _copy
    if (currentPath.includes("/models/")) {
      return name + "_copy.py";
    }
    return name + ".py";
  }, []);

  const openSaveAs = useCallback(() => {
    setSaveAsOpen(true);
    setSaveAsFormat("py");
    setExporting(false);
    setSaveAsName(suggestSaveAsName());
    setSaveAsDir("");
  }, [suggestSaveAsName]);

  // The code editor's banner for a permanently protected model points here
  // (#1346): its way out is a copy.
  useEffect(() => {
    window.addEventListener(SAVE_COPY_EVENT, openSaveAs);
    return () => window.removeEventListener(SAVE_COPY_EVENT, openSaveAs);
  }, [openSaveAs]);

  // GraphStructureConditions don't yet serialize to MDF (PsyNeuLink#7); warn
  // before an MDF copy that the backend will likely reject.
  const gscTypesInModel = useMemo(() => {
    const types = new Set<string>();
    for (const gsc of gscConditions) types.add(gsc.type);
    return Array.from(types).sort();
  }, [gscConditions]);

  // Nested Compositions don't survive PsyNeuLink's MDF round-trip (#82): the
  // inner Composition serializes as an opaque node, boundary projections are
  // dropped, and re-import crashes. Warn before an MDF copy.
  const nestedCompsInModel = useMemo(
    () => compositionOptions.filter((o) => o.nested).map((o) => o.label),
    [compositionOptions]
  );

  // The other known MDF round-trip gaps (#83 shared components, #84 2D
  // projection variables, #85 conditions that don't survive, #87 random
  // noise) need the live Composition, so the backend checks them when the
  // dialog is about to write MDF.
  const [mdfGaps, setMdfGaps] = useState<MdfGap[]>([]);
  const wantsMdf = saveAsOpen && !!getFormatById(saveAsFormat)?.mdfBased;
  useEffect(() => {
    if (!wantsMdf || !filePath) {
      setMdfGaps([]);
      return;
    }
    let cancelled = false;
    fetch("/api/model/mdf-gaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
    })
      .then((r) => (r.ok ? r.json() : { gaps: [] }))
      .then((data) => { if (!cancelled) setMdfGaps(Array.isArray(data.gaps) ? data.gaps : []); })
      .catch(() => { if (!cancelled) setMdfGaps([]); });
    return () => { cancelled = true; };
  }, [wantsMdf, filePath]);

  const handleSave = useCallback(() => {
    if (!filePath || source === savedSource) return;
    window.dispatchEvent(new CustomEvent("psynewview:save"));
  }, [filePath, source, savedSource]);

  // Guard against silently discarding unsaved edits when switching models (#345).
  const confirmDiscard = useCallback(() => {
    const s = useModelStore.getState();
    if (!s.filePath || s.source === s.savedSource) return true;
    return window.confirm(
      "You have unsaved changes that will be lost. Load anyway?"
    );
  }, []);

  const { setStatus, clearStatus } = useStatusStore();

  // Open a local .pnlproject bundle in place (#348): the backend extracts it
  // to a working dir and reports the origin, so Save re-zips back into it.
  const openBundle = async (bundlePath: string) => {
    setDropdownOpen(false);
    clearNotifications();
    const fileName = bundlePath.split("/").pop() || bundlePath;
    setStatus(`Opening bundle: ${fileName}...`);
    try {
      const resp = await fetch("/api/model/open-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle_path: bundlePath }),
      });
      if (!resp.ok) {
        const detail = await errorDetail(resp);
        addNotification("error", `Failed to open bundle: ${detail}`);
        return;
      }
      const data = await resp.json();
      setFilePath(data.file_path);
      setSource(data.source);
      setBundleOrigin(bundlePath);
      setCurrentDemo(null);
      setPristineSource(null);
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      useModelStore.setState({ starImportConverted: false });
      addRecentPath(bundlePath);
      setRecentPaths(getRecentPaths());
      if (data.model?.error) {
        addNotification("error", `Model error: ${data.model.error}`);
      }
      addNotification("success", `Opened ${fileName}`);
    } catch (e) {
      addNotification("error", `Failed to open bundle: ${e}`);
    } finally {
      clearStatus();
    }
  };

  /**
   * Load a model from a path.
   *
   * `fresh` (default true) marks this as an explicit *Open* — the next load
   * re-derives Auto/Custom from the model's layout sidecar, so re-opening a
   * model you already have open still restores its curated layout (#906).
   *
   * The three view-mode / composition switches that re-load the *current* file
   * pass `fresh: false`: those must keep the layout mode the user is working
   * in rather than snapping it back to the sidecar's.
   *
   * Defaulting to true is deliberate. The first cut of #906 set the flag at
   * each Open call site instead, and missed one — the Open-from-path modal —
   * which is the flow most likely to be used for a deliberate re-open.
   */
  const loadFromPath = async (path: string, { fresh = true }: { fresh?: boolean } = {}) => {
    if (!confirmDiscard()) return;
    if (fresh) useModelStore.getState().markFreshOpen(); // #906
    if (path.endsWith(".pnlproject")) {
      await openBundle(path);
      return;
    }
    // #721: re-loading the already-open file (a view-mode or composition switch)
    // is not a fresh "open" — don't re-pop the standardized-format prompt or the
    // "Loaded" toast each time.
    const isReload = path === filePath;
    setDropdownOpen(false);
    clearNotifications();
    const fileName = path.split("/").pop() || path;
    const t0 = performance.now();
    setStatus(`Loading model: ${fileName}...`);
    try {
      const resp = await fetch("/api/model/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // #717: carry the active view mode so a reload keeps Flatten / PyTorch.
        body: JSON.stringify({
          file_path: path,
          flat: useGraphSettings.getState().flat,
          pytorch: useGraphSettings.getState().pytorch,
        ...showGraphLoadRequest(),
        }),
      });
      const t1 = performance.now();
      if (!resp.ok) {
        const detail = await errorDetail(resp);
        addNotification("error", `Failed to load: ${detail}`);
        return;
      }
      const data = await resp.json();
      const t2 = performance.now();
      setFilePath(path);
      setSource(data.source);
      setStatus(`Building graph for ${fileName}...`);
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      if (data.starImportConverted) {
        useModelStore.setState({ starImportConverted: true });
        addNotification("info", "Auto-converted: from psyneulink import * → import psyneulink as pnl");
      } else {
        useModelStore.setState({ starImportConverted: false });
      }
      const t3 = performance.now();
      logLoadPerf({
        label: fileName,
        t0,
        apiDoneAt: t1,
        parseDoneAt: t2,
        buildDoneAt: t3,
        backend: data.timings,
      });
      addRecentPath(path);
      setRecentPaths(getRecentPaths());

      // If this working copy was derived from a demo (#40), restore the
      // "Reset to Demo" affordance by re-arming currentDemo + pristineSource
      // from the sidecar pointer the backend stamped at reset time.
      const origin = data.layout?.demo_origin;
      if (origin && demos.some((d) => d.name === origin)) {
        try {
          const pr = await fetch(
            `/api/demos/pristine?name=${encodeURIComponent(origin)}`,
          );
          if (pr.ok) {
            const prData = await pr.json();
            setCurrentDemo(origin);
            setPristineSource(prData.source);
          }
        } catch {
          // Tolerate failure — Reset to Demo just won't surface this session.
        }
      }

      // #879: model.warnings (version mismatch) and model.notices (#848
      // module-level driver) are now surfaced persistently in the Model
      // Diagnostics bar (see loadModelFromServer), not as transient toasts that
      // flash for 2s and can't be reviewed. Errors still toast — they're
      // actionable and shouldn't be missed.
      if (data.model?.error) {
        addNotification("error", `Model error: ${data.model.error}`);
      }

      if (!isReload) addNotification("success", `Loaded ${path.split("/").pop()}`);

      // #848: don't auto-prompt "Convert to standardized format" on load —
      // accommodate models (incl. verbatim PsyNeuLink examples) as-is. Conversion
      // stays available opt-in via the Inspector's "Convert to Standard Format".
    } catch (e) {
      addNotification("error", `Failed to load model: ${e}`);
    } finally {
      clearStatus();
    }
  };

  const loadDemo = async (demo: DemoModel) => {
    if (!confirmDiscard()) return;
    setDropdownOpen(false);
    clearNotifications();
    setStatus(`Loading demo: ${demo.label}...`);
    const t0 = performance.now();
    try {
      const resp = await fetch("/api/demos/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo_name: demo.name }),
      });
      const apiDoneAt = performance.now();
      if (!resp.ok) {
        const detail = await errorDetail(resp);
        addNotification("error", `Failed to load demo: ${detail}`);
        return;
      }
      const data = await resp.json();
      const parseDoneAt = performance.now();
      // Use the working path the backend actually wrote to; fall back to the
      // pristine-derived guess only for older backends that don't return it.
      const workingPath =
        data.file_path ?? demo.pristine_path.replace("/demos/", "/");
      noteModelOrigin(workingPath, { kind: "demo", section: "demos" });
      setFilePath(workingPath);
      setSource(data.source);
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      logLoadPerf({
        label: demo.label,
        t0,
        apiDoneAt,
        parseDoneAt,
        buildDoneAt: performance.now(),
        backend: data.timings,
      });
      setCurrentDemo(demo.name);
      setPristineSource(data.source);
      addRecentPath(workingPath);
      setRecentPaths(getRecentPaths());
      addNotification("success", `Loaded demo: ${demo.label}`);
    } catch (e) {
      addNotification("error", `Failed to load demo: ${e}`);
    } finally {
      clearStatus();
    }
  };

  // #1224: let a walkthrough open the model it was written for, through the
  // same loaders (and unsaved-changes prompt) a click in this menu uses. "Is it
  // open" goes by file name, so a working copy opened by path counts too.
  useEffect(() => {
    const baseName = (p: string | null | undefined) => (p ? p.split("/").pop() : null);
    const find = (label: string) => ({
      rm: referenceModels.find((r) => r.label === label),
      demo: demos.find((d) => d.label === label),
    });
    useCatalogOpener.getState().register({
      isOpen: (label) => {
        const { rm, demo } = find(label);
        const open = baseName(useModelStore.getState().filePath);
        const want = baseName(rm?.pristine_path ?? demo?.pristine_path);
        return !!open && !!want && open === want;
      },
      sectionOf: (label) => {
        const { rm, demo } = find(label);
        return rm ? "references" : demo ? "demos" : null;
      },
      open: async (label) => {
        const { rm, demo } = find(label);
        if (rm) await loadReference(rm);
        else if (demo) await loadDemo(demo);
        else return false;
        return useCatalogOpener.getState().isOpen?.(label) ?? false;
      },
      // Both lists, not either: when demos answered first, a walkthrough
      // written for a reference model (Stroop) looked it up too early, found
      // nothing, and said its model "didn't open".
      ready: bundledListsSettled >= 2 && (referenceModels.length > 0 || demos.length > 0),
    });
  });

  const resetCurrentDemo = async () => {
    if (!currentDemo) return;
    const demo = demos.find((d) => d.name === currentDemo);
    if (demo) await loadDemo(demo);
  };

  // #1236: whether the open reference model is an edited working copy, so it
  // can be put back to the bundled version (backend's restore_pristine).
  const [referenceEdited, setReferenceEdited] = useState(false);

  const loadReference = async (rm: ReferenceModel, { restore = false }: { restore?: boolean } = {}) => {
    if (restore) {
      if (!window.confirm(`Put ${rm.label} back to the bundled version? Your edits to it will be lost.`)) return;
    } else if (!confirmDiscard()) return;
    setDropdownOpen(false);
    clearNotifications();
    setStatus(`Loading reference model: ${rm.label}...`);
    const t0 = performance.now();
    try {
      const resp = await fetch("/api/reference-models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: rm.name, restore_pristine: restore }),
      });
      const apiDoneAt = performance.now();
      if (!resp.ok) {
        const detail = await errorDetail(resp);
        addNotification("error", `Failed to load reference model: ${detail}`);
        return;
      }
      const data = await resp.json();
      const parseDoneAt = performance.now();
      // Use the working path the backend actually wrote to; fall back to the
      // pristine-derived guess only for older backends that don't return it
      // (the guess is wrong when the working dir is isolated, e.g. in CI).
      const workingPath =
        data.file_path ?? rm.pristine_path.replace("/reference_models/", "/");
      noteModelOrigin(workingPath, { kind: "reference", section: "references" });
      setFilePath(workingPath);
      // setFilePath cleared currentReference; re-arm it so the Open dropdown
      // marks this reference as loaded (#830). Must come after setFilePath.
      setCurrentReference(rm.name);
      setSource(data.source);
      // #906: re-opening the same reference must re-pick Auto/Custom from its
      // (curated) sidecar, not keep a stale mode from a prior open.
      useModelStore.getState().markFreshOpen();
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      logLoadPerf({
        label: rm.label,
        t0,
        apiDoneAt,
        parseDoneAt,
        buildDoneAt: performance.now(),
        backend: data.timings,
      });
      // #1010: reopening no longer overwrites an edited working copy, so say
      // which one you got. Silently loading your edited version while the menu
      // says "reference model" is the same class of confusion as the reverse
      // used to be — the difference is now visible rather than implied.
      setReferenceEdited(!!data.workingCopy?.diverged);
      if (data.workingCopy?.diverged) {
        addNotification(
          "info",
          `Loaded your edited copy of ${rm.label} — your changes were kept. The bundled version is unchanged.`,
          8000,
        );
      } else if (data.workingCopy?.restored) {
        addNotification("info", `Restored ${rm.label} to the bundled version.`, 6000);
      }
      setCurrentDemo(null);
      setPristineSource(null);
      addRecentPath(workingPath);
      setRecentPaths(getRecentPaths());
      addNotification("success", `Loaded reference model: ${rm.label}`);
    } catch (e) {
      addNotification("error", `Failed to load reference model: ${e}`);
    } finally {
      clearStatus();
    }
  };

  // Load a live PsyNeuLink example (#843): the backend copies the *current*
  // source file into a working dir before loading, so the open reflects the
  // live source yet edits never mutate the PsyNeuLink source clone.
  const loadPnlExample = async (m: LibraryModel) => {
    if (!confirmDiscard()) return;
    setDropdownOpen(false);
    clearNotifications();
    setStatus(`Loading PsyNeuLink example: ${m.label}...`);
    const t0 = performance.now();
    try {
      const resp = await fetch("/api/psyneulink-examples/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: m.name }),
      });
      const apiDoneAt = performance.now();
      if (!resp.ok) {
        const detail = await errorDetail(resp);
        addNotification("error", `Failed to load example: ${detail}`);
        return;
      }
      const data = await resp.json();
      const parseDoneAt = performance.now();
      noteModelOrigin(data.file_path ?? m.path, { kind: "example", section: "examples" });
      setFilePath(data.file_path ?? m.path);
      // setFilePath clears currentReference; re-arm it so the Open dropdown marks
      // this live example as loaded (#830/#834). Must come after setFilePath.
      setCurrentReference(m.name);
      setSource(data.source);
      useModelStore.getState().markFreshOpen(); // #906
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      logLoadPerf({
        label: m.label,
        t0,
        apiDoneAt,
        parseDoneAt,
        buildDoneAt: performance.now(),
        backend: data.timings,
      });
      setCurrentDemo(null);
      setPristineSource(null);
      addRecentPath(data.file_path ?? m.path);
      setRecentPaths(getRecentPaths());
      addNotification("success", `Loaded PsyNeuLink example: ${m.label}`);
    } catch (e) {
      addNotification("error", `Failed to load example: ${e}`);
    } finally {
      clearStatus();
    }
  };

  const handleLoadCustom = async () => {
    setDropdownOpen(false);
    // In the Mac app, ask the OS for the path (#347); typed-path prompt is
    // the plain-web fallback — WKWebView file inputs can't expose real paths.
    if (hasFileBridge()) {
      const path = await pickOpenPath({
        extensions: ["py", "pnlproject"],
        message: "Choose a .py model or .pnlproject bundle to open",
      });
      if (!path) return;
      setCurrentDemo(null);
      setPristineSource(null);
      loadFromPath(path);
      return;
    }
    // Plain web: browse the backend's model dirs (#618). The modal keeps a
    // typed-path field for manual entry / paths outside the configured roots.
    setFileBrowserOpen(true);
  };

  // Save a GitHub-fetched (repo, ref, path, content) into the user's models
  // dir under a derived name, retrying with _1, _2, … on collision (mirrors the
  // MDF-import strategy). Then load it like any other local file.
  const handleGithubFileLoaded = async (file: {
    repo: string;
    ref: string;
    path: string;
    content: string;
  }) => {
    if (!confirmDiscard()) return;
    setGithubLoaderOpen(false);
    clearNotifications();
    const basename = file.path.split("/").pop() || "github_file.py";
    const stem = basename.replace(/\.py$/, "") || "github_file";
    setStatus(`Loading ${basename} from ${file.repo}@${file.ref}…`);
    try {
      let attempt = 0;
      let saved: { file_path: string; source: string; model: any } | null = null;
      while (attempt < 50 && !saved) {
        const name = attempt === 0 ? `${stem}.py` : `${stem}_${attempt}.py`;
        const resp = await fetch("/api/models/save-as", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: file.content, file_name: name }),
        });
        if (resp.ok) {
          saved = await resp.json();
          break;
        }
        if (resp.status === 409) {
          attempt += 1;
          continue;
        }
        const err = await resp.json().catch(() => ({}));
        addNotification("error", `Failed to save GitHub file: ${err.detail ?? resp.statusText}`);
        return;
      }
      if (!saved) {
        addNotification("error", `Couldn't find an unused filename for ${stem}.py`);
        return;
      }
      setCurrentDemo(null);
      setPristineSource(null);
      setFilePath(saved.file_path);
      setSource(saved.source);
      loadModelFromServer(saved.model);
      addRecentPath(saved.file_path);
      setRecentPaths(getRecentPaths());
      refreshUserModels();
      if (saved.model?.error) {
        addNotification("error", `Model error: ${saved.model.error}`);
      }
      addNotification(
        "success",
        `Loaded ${file.path} from ${file.repo}@${file.ref}`,
      );
    } catch (e) {
      addNotification("error", `Failed to load GitHub file: ${e}`);
    } finally {
      clearStatus();
    }
  };

  // Save extracted pytest content to the user models dir with _1/_2/…
  // collision handling, then load it like any other local file (mirrors
  // handleGithubFileLoaded). The suggested_filename already encodes the
  // source stem + qualified name so the listing stays readable.
  const handleDevTestExtracted = async (extracted: ExtractedTest) => {
    setDevTestsOpen(false);
    clearNotifications();
    const baseName = extracted.suggested_filename;
    const stem = baseName.replace(/\.py$/, "") || "extracted_test";
    setStatus(`Extracting ${extracted.qualified_name}…`);
    try {
      let attempt = 0;
      let saved: { file_path: string; source: string; model: any } | null = null;
      while (attempt < 50 && !saved) {
        const name = attempt === 0 ? `${stem}.py` : `${stem}_${attempt}.py`;
        const resp = await fetch("/api/models/save-as", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: extracted.content,
            file_name: name,
            // Extracted pytest tests need their .run/.learn calls to
            // actually execute (#273); the default save-as path patches
            // those to no-ops, which would surface as "NoneType is not
            // iterable" on any test that consumes its own results.
            developer_mode: true,
          }),
        });
        if (resp.ok) {
          saved = await resp.json();
          break;
        }
        if (resp.status === 409) {
          attempt += 1;
          continue;
        }
        const err = await resp.json().catch(() => ({}));
        addNotification("error", `Failed to save extracted test: ${err.detail ?? resp.statusText}`);
        return;
      }
      if (!saved) {
        addNotification("error", `Couldn't find an unused filename for ${stem}.py`);
        return;
      }
      setCurrentDemo(null);
      setPristineSource(null);
      setFilePath(saved.file_path);
      setSource(saved.source);
      loadModelFromServer(saved.model);
      addRecentPath(saved.file_path);
      setRecentPaths(getRecentPaths());
      refreshUserModels();
      if (saved.model?.error) {
        addNotification("error", `Model error: ${saved.model.error}`);
      }
      addNotification(
        "success",
        `Loaded ${extracted.qualified_name} (${saved.file_path.split("/").pop()})`,
      );
    } catch (e) {
      addNotification("error", `Failed to load extracted test: ${e}`);
    } finally {
      clearStatus();
    }
  };

  // Importing a .py / .pnlproject was drag-and-drop only, with nothing in the
  // UI to say so (#1068). Mirrors the MDF import pattern below.
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const handleImportModelClick = () => {
    setDropdownOpen(false);
    importFileInputRef.current?.click();
  };

  const handleImportModelSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Reset so the same file can be picked again later.
    e.target.value = "";
    await importModelFiles(files, "choose");
  };

  const mdfFileInputRef = useRef<HTMLInputElement>(null);

  const handleImportMdfClick = () => {
    setDropdownOpen(false);
    mdfFileInputRef.current?.click();
  };

  const handleMdfFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be picked again later.
    e.target.value = "";
    if (!file) return;

    clearNotifications();
    setStatus(`Importing MDF: ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/model/import-mdf", {
        method: "POST",
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Import failed" }));
        addNotification("error", `MDF import failed: ${err.detail}`);
        return;
      }
      const data = await resp.json();
      setCurrentDemo(null);
      setPristineSource(null);
      setFilePath(data.file_path);
      setSource(data.source);
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      addRecentPath(data.file_path);
      setRecentPaths(getRecentPaths());
      refreshUserModels();
      for (const w of (data.warnings || [])) {
        addNotification("warning", w);
      }
      addNotification(
        "success",
        `Imported MDF: ${data.projectName || file.name} → ${(data.file_path || "").split("/").pop()}`
      );
    } catch (err) {
      addNotification("error", `MDF import failed: ${err}`);
    } finally {
      clearStatus();
    }
  };

  const handleSaveAs = async (overwrite = false) => {
    if (!saveAsName.trim()) return;
    const currentSource = useModelStore.getState().source;
    const { setStatus, clearStatus } = useStatusStore.getState();
    setStatus("Saving model...");
    try {
      const resp = await fetch("/api/models/save-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: currentSource,
          file_name: saveAsName.trim(),
          directory: saveAsDir || defaultSaveDir || null,
          overwrite,
          // #1244: the copy takes this model's layout, labels and index.
          source_path: filePath || null,
        }),
      });
      if (!resp.ok) {
        // Name collision (#301): offer an explicit overwrite instead of failing.
        // The backend names what is there — the .py, or a layout or labels
        // file the copy would replace (#1244) — so the question says so.
        if (resp.status === 409 && !overwrite) {
          clearStatus();
          const err = await resp.json().catch(() => ({ detail: `"${saveAsName.trim()}" already exists` }));
          if (window.confirm(`${err.detail}. Overwrite?`)) {
            return handleSaveAs(true);
          }
          return;
        }
        const detail = await errorDetail(resp);
        addNotification("error", `Save failed: ${detail}`);
        return;
      }
      const data = await resp.json();
      const newPath = data.file_path;
      recordActivity("model", `Saved as ${newPath}`, { path: newPath, saveAs: true });
      setFilePath(newPath);
      setSource(data.source);
      // The copy opens with its own sidecars — copies of this model's (#1244).
      loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      setCurrentDemo(null);
      setPristineSource(null);
      addRecentPath(newPath);
      setRecentPaths(getRecentPaths());
      refreshUserModels();
      addNotification("success", `Saved as ${saveAsName.trim()}`);
      setSaveAsOpen(false);
      setSaveAsName("");
    } catch (e) {
      addNotification("error", `Save failed: ${e}`);
    } finally {
      clearStatus();
    }
  };

  // Hand a blob to the browser as a download.
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Where the backend lives decides how the destinations are worded, so the
  // dialog needs it before it can describe the choice honestly.
  useEffect(() => {
    if (!saveAsOpen || deploymentMode !== undefined) return;
    let cancelled = false;
    fetch("/api/settings/info")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        // Absent on older backends — leave undefined and use neutral wording.
        if (d?.deployment?.mode) setDeploymentMode(d.deployment.mode);
      })
      .catch(() => {
        /* Non-fatal: the dialog still works, just with neutral wording. */
      });
    return () => { cancelled = true; };
  }, [saveAsOpen, deploymentMode]);

  // Default the destination to whichever is less surprising: on a remote
  // deployment that is a download, because "save" there puts the file
  // somewhere the user cannot reach.
  useEffect(() => {
    if (deploymentMode === "container" || deploymentMode === "hosted") {
      setSaveAsDest("download");
    }
  }, [deploymentMode]);

  // Download a copy. Never changes the active file — unlike saving one.
  const runDownload = async (fmt: string) => {
    const format = getFormatById(fmt);
    if (!format || !filePath) return;
    const fname = format.buildFilename(filePath);
    setExporting(true);
    try {
      // `.py` needs no round trip: the editor buffer is already here, and
      // downloading it matches what saving `.py` writes.
      if (!format.downloadEndpoint) {
        // A copy starts unprotected (#1346), as a copy saved to a folder does.
        const source = stripProtectionLine(useModelStore.getState().source);
        triggerDownload(new Blob([source], { type: "text/x-python" }), fname);
        addNotification("success", `Downloaded ${fname}`);
        setSaveAsOpen(false);
        return;
      }
      const resp = await fetch(format.downloadEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, ...(format.extraBody || {}) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        addNotification("error", `Download failed: ${err.detail}`);
        return;
      }
      triggerDownload(await resp.blob(), fname);
      addNotification("success", `Downloaded ${fname}`);
      setSaveAsOpen(false);
    } catch (e) {
      addNotification("error", `Download failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  // Write a copy on the server in any format (#1067). Only `.py` becomes the
  // active file; saving a bundle or MDF is an artefact, not a working file.
  const runServerSave = async (fmt: string) => {
    const format = getFormatById(fmt);
    if (!format || !filePath) return;
    if (fmt === "py") return handleSaveAs();
    setExporting(true);
    try {
      const resp = await fetch("/api/model/save-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: filePath,
          fmt,
          file_name: saveAsName.trim() || format.buildFilename(filePath),
          directory: saveAsDir || defaultSaveDir || null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        addNotification("error", `Save failed: ${err.detail}`);
        return;
      }
      const data = await resp.json();
      recordActivity("model", `Saved a copy as ${fmt}: ${data.file_path}`, { path: data.file_path, format: fmt });
      addNotification("success", `Saved ${data.file_path}`);
      setSaveAsOpen(false);
    } catch (e) {
      addNotification("error", `Save failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  // Group user models by folder
  const modelsByFolder = userModels.reduce<Record<string, UserModel[]>>((acc, m) => {
    const key = m.folder || "";
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <div
      data-testid="app-toolbar"
      role="toolbar"
      aria-label="Main toolbar"
      // #6: no control breaks onto two lines (index.css); when the row is
      // full, whole controls move to a second row instead.
      className="app-toolbar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderBottom: "1px solid var(--pnv-border-faint)",
        background: "var(--pnv-surface-muted)",
        position: "relative",
      }}
    >
      <strong style={{ fontSize: "var(--pnv-fs-14)", flexShrink: 0 }}>PsyNeuView</strong>
      <BusyIndicator placement="toolbar" />

      {/* Settings (gear icon) — opens sectioned settings panel (#119). Next to
          the name, where nothing a model adds to the toolbar can push it off
          the edge; Layout ▸ Settings… and the Mac app's ⌘, open it too (#1279). */}
      <button
        onClick={() => openSettingsAt(null)}
        data-testid="settings-button"
        style={{
          fontSize: "var(--pnv-fs-14)",
          padding: "2px 8px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: "var(--pnv-surface)",
          color: "var(--pnv-text-secondary)",
          cursor: "pointer",
          lineHeight: 1,
          flexShrink: 0,
        }}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>

      {/* Developer mode, visible whenever it is on (#1291). */}
      <DeveloperModeIndicator />

      <LayoutMenu onOpenSettings={() => openSettingsAt(null)} />

      <WalkthroughMenu />

      <UndoRedoButtons />
      <HistoryPanel />

      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          onClick={() => {
            setDropdownOpen(!dropdownOpen);
            if (!dropdownOpen) {
              refreshUserModels();
              void refreshCatalogs();
            }
          }}
          // Stable handle for the entry point to every model: specs and guided
          // walkthroughs both start here, and "Open ▾" is free to be reworded.
          data-testid="open-menu"
          style={{
            fontSize: "var(--pnv-fs-13)",
            padding: "4px 12px",
            cursor: "pointer",
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 4,
          }}
        >
          Open ▾
        </button>

        {dropdownOpen && (
          <div
            className="open-menu-dropdown"
            role="menu"
            data-testid="open-menu-list"
            onClickCapture={(e) => recordMenuClick("Open", e)}
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
              background: "var(--pnv-surface)",
              border: "1px solid var(--pnv-border-light)",
              borderRadius: 6,
              boxShadow: "var(--pnv-shadow-popover)",
              zIndex: Z_MENU,
              minWidth: 380,
              maxWidth: 600,
              maxHeight: 500,
              overflowY: "auto",
            }}
          >
            {/* ACTIONS — "do something" entrypoints (#350) */}
            <div style={zoneHeaderStyle}>Actions</div>

            {/* New Model */}
            <button
              onClick={() => {
                setDropdownOpen(false);
                setPromptState({
                  title: "New model",
                  message: "Name for new model:",
                  placeholder: "my_model",
                  onSubmit: async (name) => {
                    setPromptState(null);
                    const varName = name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
                    if (!varName) return;
                try {
                  // Fetch PNL version for the template header
                  let pnlVer = "unknown";
                  try {
                    const vr = await fetch("/api/pnl-version");
                    if (vr.ok) { const vd = await vr.json(); pnlVer = vd.version || "unknown"; }
                  } catch { /* use default */ }

                  const resp = await fetch("/api/models/save-as", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      source: newModelTemplate(pnlVer).replace(/my_model/g, varName),
                      file_name: `${varName}.py`,
                    }),
                  });
                  if (!resp.ok) {
                    const detail = await errorDetail(resp);
                    addNotification("error", `Failed: ${detail}`);
                    return;
                  }
                  const data = await resp.json();
                  setFilePath(data.file_path);
                  setSource(data.source);
                  loadModelFromServer(data.model);
                  setCurrentDemo(null);
                  setPristineSource(null);
                  addNotification("success", `Created new model: ${varName}.py`);
                } catch (e) {
                  addNotification("error", `Failed to create model: ${e}`);
                }
                  },
                });
              }}
              data-testid="open-menu-new-model"
              style={{
                ...itemStyle,
                color: "var(--pnv-primary)",
                fontWeight: 500,
              }}
            >
              + New Model...
            </button>

            <button
              onClick={handleLoadCustom}
              data-testid="open-menu-open-from-path"
              style={{
                ...itemStyle,
                color: "var(--pnv-primary)",
              }}
            >
              Open from path...
            </button>
            <button
              onClick={handleImportModelClick}
              style={{
                ...itemStyle,
                color: "var(--pnv-primary)",
              }}
              title="Import a .py model or .pnlproject bundle from your computer (you can also drag one onto the window)"
            >
              Import model or project...
            </button>
            <button
              onClick={handleImportMdfClick}
              style={{
                ...itemStyle,
                color: "var(--pnv-primary)",
              }}
              title="Import a ModECI MDF file (.mdf.json, .mdf.yaml, or sniffed bare .json/.yaml)"
            >
              Import MDF...
            </button>
            <button
              onClick={() => { setDropdownOpen(false); setGithubLoaderOpen(true); }}
              style={{
                ...itemStyle,
                color: "var(--pnv-primary)",
              }}
              title="Browse and load a .py file from a public GitHub repo (#258)"
            >
              From GitHub repo...
            </button>
            {developerMode && (
              <button
                onClick={() => { setDropdownOpen(false); setDevTestsOpen(true); }}
                data-testid="open-menu-dev-tests"
                style={{
                  ...itemStyle,
                  color: "var(--pnv-developer)",
                }}
                title="Browse PsyNeuLink pytest tests and open one as a standalone model (#274)"
              >
                Developer / Tests...
                <DeveloperBadge />
                {pnlSectionSource && (
                  <span
                    data-testid="open-menu-section-source"
                    style={{ marginLeft: 8, fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", fontWeight: 400 }}
                  >
                    {pnlSectionSource}
                  </span>
                )}
              </button>
            )}

            {/* CATALOGS — "pick from a curated set" (#350) */}
            <div style={zoneHeaderStyle}>Catalogs</div>
            {switchNote && (
              <div
                data-testid="open-menu-source-switch-note"
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "4px 8px 6px",
                  padding: "5px 8px",
                  fontSize: "var(--pnv-fs-11)",
                  color: "var(--pnv-primary-text-on-tint)",
                  background: "var(--pnv-primary-tint)",
                  border: "1px solid var(--pnv-primary-tint-border)",
                  borderRadius: 4,
                }}
              >
                <span style={{ flex: 1 }}>{switchNote}</span>
                <DialogCloseButton
                  onClick={() => setSwitchNote(null)}
                  label="Dismiss"
                  title="Dismiss"
                  color="var(--pnv-primary-text-on-tint)"
                  inline
                  testId="open-menu-source-switch-note-dismiss"
                />
              </div>
            )}

              {/* #1135: catalog sections in the order the user dragged them
                  into. A flex column so each wrapper can carry a CSS `order`.
                  Recent is not here — it belongs to the History zone (#350). */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ order: sectionOrder.indexOf("references"), display: sectionVisible("references") ? undefined : "none" }}>

            {/* Reference models (#321 ego, #322 stroop) — distinguished
                quick-access set for testing and debugging. */}
            {referenceModels.length > 0 && (
              <>
                {renderSectionHeader("references", sectionLabel("references"), {
                  source: INCLUDED_SOURCE,
                  title: withPath(
                    "Known reference models kept handy for testing and debugging — your vendored, version-pinned copies",
                    catalogSources.references,
                  ),
                  style: { borderTop: "none", color: "var(--pnv-primary-text-on-tint)", background: "var(--pnv-primary-tint)" },
                  right:
                    referenceModels.length > 1 ? (
                      <button
                        onClick={() => setReorderReference((v) => !v)}
                        title={reorderReference ? "Done reordering" : "Reorder reference models"}
                        aria-label={reorderReference ? "Done reordering" : "Reorder reference models"}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          color: "var(--pnv-primary-text-on-tint)",
                          fontSize: "var(--pnv-fs-12)",
                          fontWeight: 700,
                          padding: "0 2px",
                          lineHeight: 1,
                        }}
                      >
                        {reorderReference ? "Done" : "⇅"}
                      </button>
                    ) : undefined,
                })}
                {!isSectionCollapsed("references") &&
                  referenceModels.map((rm, idx) => {
                  const isLoaded = !reorderReference && rm.name === currentReference;
                  return (
                  <button
                    key={rm.name}
                    onClick={() => {
                      if (!reorderReference) loadReference(rm);
                    }}
                    aria-current={isLoaded ? "true" : undefined}
                    data-catalog-label={rm.label}
                    draggable={reorderReference}
                    onDragStart={
                      reorderReference
                        ? (e) => {
                            setRefDragIndex(idx);
                            e.dataTransfer.effectAllowed = "move";
                          }
                        : undefined
                    }
                    onDragOver={reorderReference ? (e) => e.preventDefault() : undefined}
                    onDrop={
                      reorderReference
                        ? (e) => {
                            e.preventDefault();
                            if (refDragIndex !== null) moveReference(refDragIndex, idx);
                            setRefDragIndex(null);
                          }
                        : undefined
                    }
                    onDragEnd={reorderReference ? () => setRefDragIndex(null) : undefined}
                    style={{
                      ...itemStyle,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: reorderReference ? "grab" : "pointer",
                      background:
                        reorderReference && refDragIndex === idx ? "var(--pnv-primary-tint)" : "none",
                    }}
                    title={
                      reorderReference
                        ? "Drag to reorder"
                        : isLoaded
                          ? `Currently loaded — ${rm.pristine_path}`
                          : rm.pristine_path
                    }
                  >
                    {reorderReference && (
                      <span
                        aria-hidden="true"
                        style={{ color: "var(--pnv-text-faint)", userSelect: "none" }}
                      >
                        ⠿
                      </span>
                    )}
                    {isLoaded && (
                      <span
                        aria-hidden="true"
                        title="Currently loaded"
                        style={{ color: "var(--pnv-primary)", fontWeight: 700, userSelect: "none" }}
                      >
                        ✓
                      </span>
                    )}
                    <span style={{ fontWeight: isLoaded ? 600 : undefined }}>{rm.label}</span>
                  </button>
                  );
                })}
              </>
            )}
                </div>
                <div style={{ order: sectionOrder.indexOf("demos"), display: sectionVisible("demos") ? undefined : "none" }}>

            {/* Demo models */}
            {renderSectionHeader("demos", sectionLabel("demos"), {
              source: INCLUDED_SOURCE,
              style: referenceModels.length > 0 ? {} : { borderTop: "none" },
              title: withPath(
                "Built-in demo models bundled with PsyNeuView",
                catalogSources.demos,
              ),
            })}
            {!isSectionCollapsed("demos") && (
              <>
                {demos.length === 0 && (
                  <div style={{ padding: "8px 12px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-faint)" }}>No demos found</div>
                )}
                {demos.map((demo) => (
                  <button
                    key={demo.name}
                    data-catalog-label={demo.label}
                    onClick={() => loadDemo(demo)}
                    style={itemStyle}
                  >
                    {demo.label}
                  </button>
                ))}
              </>
            )}
                </div>
                <div style={{ order: sectionOrder.indexOf("library"), display: sectionVisible("library") ? undefined : "none" }}>

            {/* PsyNeuLink library models (#20) */}
            {libraryModels.length > 0 && (
              <>
                {renderSectionHeader("library", "PsyNeuLink Library", {
                  source: pnlSectionSource,
                  title:
                    withPath(
                      "Read-only models shipped inside the installed PsyNeuLink package (moves with the PsyNeuLink version)",
                      catalogSources.library,
                    ) + gitSuffix(catalogSources.pnlGit),
                })}
                {!isSectionCollapsed("library") &&
                  libraryModels.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => {
                        setCurrentDemo(null);
                        setPristineSource(null);
                        loadFromPath(m.path);
                      }}
                      style={itemStyle}
                      title={m.path}
                    >
                      {m.label}
                    </button>
                  ))}
              </>
            )}
                </div>
                <div style={{ order: sectionOrder.indexOf("examples"), display: sectionVisible("examples") ? undefined : "none" }}>

            {/* PsyNeuLink examples — live from the active source's Scripts/ (#843) */}
            {pnlExamples.length > 0 && (
              <>
                {renderSectionHeader("examples", sectionLabel("examples"), {
                  source: pnlSectionSource,
                  title:
                    withPath(
                      "PsyNeuLink's own example models, read live from the active source's Scripts/Examples — not copied",
                      catalogSources.examples,
                    ) + gitSuffix(catalogSources.pnlGit),
                })}
                {!isSectionCollapsed("examples") &&
                  pnlExamples.map((m) => {
                  const isLoaded = m.name === currentReference;
                  const status = pnlStatus[m.name];
                  return (
                    <button
                      key={m.name}
                      onClick={() => loadPnlExample(m)}
                      style={{
                        ...itemStyle,
                        background: isLoaded ? "var(--pnv-primary-tint)" : undefined,
                        display: "flex",
                        alignItems: "center",
                      }}
                      title={isLoaded ? `Currently loaded — ${m.path}` : m.path}
                      aria-current={isLoaded ? "true" : undefined}
                    >
                      {isLoaded && (
                        <span
                          aria-hidden="true"
                          title="Currently loaded"
                          style={{ color: "var(--pnv-primary)", fontWeight: 700, marginRight: 6, userSelect: "none" }}
                        >
                          ✓
                        </span>
                      )}
                      <span style={{ fontWeight: isLoaded ? 600 : undefined }}>{m.label}</span>
                      {status && (
                        <span
                          title={
                            status.load !== "ok"
                              ? `Fails to load: ${status.error ?? "error"}`
                              : status.run === "ok"
                                ? `Loads (${status.nodes} nodes) + runs`
                                : `Loads (${status.nodes} nodes) but did not run with zero inputs: ${status.runError ?? "—"}`
                          }
                          style={{
                            marginLeft: "auto",
                            paddingLeft: 8,
                            fontSize: "var(--pnv-fs-11)",
                            fontWeight: 600,
                            color:
                              status.load !== "ok"
                                ? "var(--pnv-danger)"
                                : status.run === "ok"
                                  ? "var(--pnv-success)"
                                  : "var(--pnv-warning)",
                            userSelect: "none",
                          }}
                        >
                          {status.load !== "ok"
                            ? "fails"
                            : status.run === "ok"
                              ? "runs"
                              : "loads"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}
                </div>
                <div style={{ order: sectionOrder.indexOf("myModels"), display: sectionVisible("myModels") ? undefined : "none" }}>

            {/* My Project Folder (#1229) */}
            {renderSectionHeader("myModels", SECTION_LABELS.myModels, {
              source: abbreviateHome(projectFolder?.path || catalogSources.myModels || defaultSaveDir),
              title: withPath("Models you've saved", catalogSources.myModels || defaultSaveDir),
            })}
            {!isSectionCollapsed("myModels") && (
              <>
            {userModels.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-faint)" }}>
                No models yet — use Save As to create one
              </div>
            )}
            {Object.entries(modelsByFolder).map(([folder, models]) => {
              const isRoot = !folder;
              const isExpanded = isRoot || expandedFolders.has(folder);
              return (
                <div key={folder || "__root__"}>
                  {!isRoot && (
                    <button
                      onClick={() => toggleFolder(folder)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        textAlign: "left",
                        padding: "4px 12px 2px",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: "var(--pnv-fs-11)",
                        color: "var(--pnv-text-muted)",
                        fontWeight: 600,
                      }}
                      title={isExpanded ? "Collapse folder" : "Expand folder"}
                    >
                      <span style={{ width: 10, display: "inline-block", color: "var(--pnv-text-faint)" }}>
                        {isExpanded ? "▾" : "▸"}
                      </span>
                      <span>{folder}/</span>
                      <span style={{ marginLeft: "auto", fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", fontWeight: 400 }}>
                        {models.length}
                      </span>
                    </button>
                  )}
                  {isExpanded && models.map((m) => (
                    <button
                      key={m.path}
                      onClick={() => {
                        setCurrentDemo(null);
                        setPristineSource(null);
                        loadFromPath(m.path);
                      }}
                      style={{ ...itemStyle, paddingLeft: isRoot ? 12 : 28 }}
                      title={m.path}
                    >
                      {m.label}
                      <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginLeft: 8 }}>{m.name}.py</span>
                    </button>
                  ))}
                </div>
              );
            })}
              </>
            )}
                </div>
                {/* The user's own catalogs (#1229), each a section like the rest. */}
                {catalogs.map((c) => {
                  const sid = catalogSectionId(c.id);
                  return (
                    <div key={sid} style={{ order: sectionOrder.indexOf(sid) }}>
                      {renderSectionHeader(sid, c.name, { source: abbreviateHome(c.path), title: withPath(c.name, c.path) })}
                      {!isSectionCollapsed(sid) && (
                        <>
                          {!c.exists && (
                            <div style={{ padding: "8px 12px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-danger)" }}>
                              Folder not found: {c.path}
                            </div>
                          )}
                          {c.exists && c.models.length === 0 && (
                            <div style={{ padding: "8px 12px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-faint)" }}>
                              No models in this folder
                            </div>
                          )}
                          {c.models.map((m) => (
                            <button
                              key={m.path}
                              onClick={() => {
                                setCurrentDemo(null);
                                setPristineSource(null);
                                loadFromPath(m.path);
                              }}
                              style={itemStyle}
                              title={m.path}
                            >
                              {m.label}
                              <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginLeft: 8 }}>{m.relative}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

            {/* HISTORY — "go back to something recent" (#350). Bookmarks land
                here too once #253 ships its persistent-sources model. */}
            {recentPaths.length > 0 && (
              <>
                <div style={zoneHeaderStyle}>History</div>
                {renderSectionHeader("recent", "Recent", {
                  style: { borderTop: "none" },
                })}
                {!isSectionCollapsed("recent") &&
                  recentPaths.map((path) => (
                  <button
                    key={path}
                    onClick={() => {
                      setCurrentDemo(null);
                      setPristineSource(null);
                      loadFromPath(path);
                    }}
                    style={{
                      ...itemStyle,
                      fontSize: "var(--pnv-fs-12)",
                      color: "var(--pnv-text-body)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={path}
                  >
                    {path.split("/").pop()}
                    <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginLeft: 8 }}>
                      {path.split("/").slice(-3, -1).join("/")}
                    </span>
                  </button>
                ))}
              </>
            )}

          </div>
        )}
        <input
          ref={importFileInputRef}
          type="file"
          accept={IMPORT_ACCEPT_ATTR}
          onChange={handleImportModelSelected}
          style={{ display: "none" }}
        />
        <input
          ref={mdfFileInputRef}
          type="file"
          accept=".json,.yaml,.yml"
          onChange={handleMdfFileSelected}
          style={{ display: "none" }}
        />
      </div>

      {/* File cluster — Save / Save As, grouped with Load Model */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={handleSave}
          data-testid="toolbar-save"
          disabled={!filePath || source === savedSource}
          style={{
            fontSize: "var(--pnv-fs-13)",
            padding: "4px 12px",
            cursor: !filePath || source === savedSource ? "default" : "pointer",
            background: !filePath || source === savedSource ? "var(--pnv-surface-sunken)" : "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 4,
            color: !filePath || source === savedSource ? "var(--pnv-text-faint)" : "inherit",
          }}
          title={
            !filePath
              ? "No file loaded"
              : source === savedSource
              ? "No unsaved changes"
              : "Save changes to the current file (Ctrl+S)"
          }
        >
          Save
        </button>
        <button
          onClick={openSaveAs}
          data-testid="toolbar-save-copy"
          disabled={!filePath}
          style={{
            fontSize: "var(--pnv-fs-13)",
            padding: "4px 12px",
            cursor: !filePath ? "default" : "pointer",
            background: !filePath ? "var(--pnv-surface-sunken)" : "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 4,
            color: !filePath ? "var(--pnv-text-faint)" : "inherit",
          }}
          title="Save a copy as .py, a .pnlproject bundle, or MDF"
        >
          Save a copy as…
        </button>
      </div>

      {/* Composition selector — lists top-level AND nested compositions (#426).
          Picking a nested one focuses it full-canvas (with breadcrumb to climb
          back out); picking a top-level one activates it and clears focus. */}
      {(compositionOptions.length > 1 || activeIsAutodiff) && (
        <select
          value={
            pytorchView
              ? "__pytorch__"
              : flatView
              ? "__flat__"
              : useModelStore.getState().focusedComposition ||
                useModelStore.getState().activeComposition ||
                ""
          }
          onChange={(e) => {
            const val = e.target.value;
            const gs = useGraphSettings.getState();
            if (val === "__flat__") {
              gs.setPytorch(false);
              gs.setFlat(true);
              // Same file, different view — keep the user's layout mode (#906).
              if (filePath) loadFromPath(filePath, { fresh: false });
              return;
            }
            if (val === "__pytorch__") {
              gs.setFlat(false);
              gs.setPytorch(true);
              if (filePath) loadFromPath(filePath, { fresh: false });
              return;
            }
            // A specific composition — leave the flattened views.
            gs.setFlat(false);
            gs.setPytorch(false);
            const opt = useModelStore
              .getState()
              .compositionOptions.find((o) => o.value === val);
            if (opt?.nested) {
              void focusComposition(val);
            } else {
              useModelStore.getState().setFocusedComposition(null);
              useModelStore.getState().setActiveComposition(val);
              if (filePath) loadFromPath(filePath, { fresh: false });
            }
          }}
          title="View a composition — nested ones open in focus mode"
          style={{
            fontSize: "var(--pnv-fs-12)",
            padding: "3px 6px",
            border: "1px solid var(--pnv-border)",
            borderRadius: 4,
          }}
        >
          <optgroup label="View">
            <option value="__flat__">Flatten (all compositions)</option>
            {activeIsAutodiff && <option value="__pytorch__">PyTorch view</option>}
          </optgroup>
          <optgroup label="Composition">
          {compositionOptions.map((opt) => (
            <option key={`${opt.depth}:${opt.value}`} value={opt.value}>
              {"  ".repeat(opt.depth) + (opt.depth > 0 ? "↳ " : "") + opt.label}
            </option>
          ))}
          </optgroup>
        </select>
      )}

      {filePath && (
        <FilePathChip
          filePath={filePath}
          bundleOrigin={bundleOrigin}
          dirty={source !== savedSource}
          onCopy={() => {
            const toCopy = bundleOrigin || filePath || "";
            navigator.clipboard.writeText(toCopy);
            addNotification("info", "File path copied to clipboard");
          }}
        />
      )}

      {currentDemo && pristineSource && source !== pristineSource && (
        <button
          onClick={resetCurrentDemo}
          style={{
            fontSize: "var(--pnv-fs-11)",
            padding: "3px 10px",
            border: "1px solid var(--pnv-warning-tag-border)",
            borderRadius: 4,
            background: "var(--pnv-warning-tint)",
            color: "var(--pnv-warning-tag-text)",
            cursor: "pointer",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
          title="Reset this demo model to its original state"
        >
          Reset to Original
        </button>
      )}

      {/* #1236: a reference model's edited copy can be put back. Before this the
          backend could restore it but nothing asked, so a copy broken by an
          edit stayed broken on every reopen. */}
      {currentReference && referenceEdited && (
        <button
          onClick={() => {
            const rm = referenceModels.find((r) => r.name === currentReference);
            if (rm) void loadReference(rm, { restore: true });
          }}
          data-testid="reference-reset"
          style={{
            fontSize: "var(--pnv-fs-11)",
            padding: "3px 10px",
            border: "1px solid var(--pnv-warning-tag-border)",
            borderRadius: 4,
            background: "var(--pnv-warning-tint)",
            color: "var(--pnv-warning-tag-text)",
            cursor: "pointer",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
          title="Put this reference model back to the bundled version, discarding your edits to it"
        >
          Reset to Original
        </button>
      )}

      {/* An app update is waiting (PsyNeuView-MacApp#6). Inside the Mac app
          only; renders nothing otherwise. */}
      <AppUpdateNotice />

      {/* Who else is on this instance (#1082). Renders nothing when alone or
          when presence can't be determined, which is every local run. */}
      <PresenceIndicator />

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        section={settingsSection}
      />

      {githubLoaderOpen && (
        <GithubFileLoaderModal
          onCancel={() => setGithubLoaderOpen(false)}
          onLoaded={handleGithubFileLoaded}
        />
      )}

      {devTestsOpen && (
        <DeveloperTestsModal
          onCancel={() => setDevTestsOpen(false)}
          onExtracted={handleDevTestExtracted}
        />
      )}

      {/* Save a copy as… modal — one gesture for .py / bundle / MDF (#351) */}
      {saveAsOpen && (() => {
        const format = getFormatById(saveAsFormat);
        const toServer = saveAsDest === "server";
        // Only a server-side .py takes a name from the user; everything else
        // derives one from the model, so there is nothing to require.
        const needsName = toServer && saveAsFormat === "py";
        const exportFilename = format ? format.buildFilename(filePath || "") : "";
        const showGscWarning = !!format?.mdfBased && gscTypesInModel.length > 0;
        const showNestedWarning = !!format?.mdfBased && nestedCompsInModel.length > 0;
        const saveDisabled = needsName ? !saveAsName.trim() : exporting;
        const dest = describeDestinations(deploymentMode);
        const onSave = () => (toServer ? runServerSave(saveAsFormat) : runDownload(saveAsFormat));
        return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--pnv-scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => { if (!exporting) setSaveAsOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-copy-title"
            data-testid="save-copy-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--pnv-surface)",
              borderRadius: 12,
              maxWidth: 480,
              width: "90%",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "var(--pnv-shadow-dialog)",
            }}
          >
            <DialogHeader title="Save a copy as…" titleId="save-copy-title" onClose={() => { if (!exporting) setSaveAsOpen(false); }} />
            <div style={{ padding: "16px 28px 24px" }}>

            <label style={{ display: "block", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", marginBottom: 4 }}>
              Where
            </label>
            <select
              value={saveAsDest}
              onChange={(e) => setSaveAsDest(e.target.value as SaveDestination)}
              disabled={exporting}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "var(--pnv-fs-14)",
                border: "1px solid var(--pnv-border)",
                borderRadius: 6,
                background: "var(--pnv-surface)",
                boxSizing: "border-box",
                marginBottom: 6,
              }}
            >
              <option value="server">{dest.server.label}</option>
              <option value="download">{dest.download.label}</option>
            </select>
            <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", marginBottom: 16, lineHeight: 1.4 }}>
              {toServer ? dest.server.hint : dest.download.hint}
            </div>
            {copyStartsUnprotected && saveAsFormat === "py" && (
              <div data-testid="save-copy-unprotected-note" style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", marginTop: -8, marginBottom: 16, lineHeight: 1.4 }}>
                The copy starts unprotected: this model&rsquo;s &ldquo;# PsyNeuView: protected&rdquo; line stays with the original.
              </div>
            )}

            <label style={{ display: "block", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", marginBottom: 4 }}>
              Format
            </label>
            <select
              value={saveAsFormat}
              onChange={(e) => setSaveAsFormat(e.target.value)}
              disabled={exporting}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "var(--pnv-fs-14)",
                border: "1px solid var(--pnv-border)",
                borderRadius: 6,
                background: "var(--pnv-surface)",
                boxSizing: "border-box",
                marginBottom: 16,
              }}
            >
              {SAVE_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>

            {needsName ? (
              <>
                <div
                  style={{
                    fontSize: "var(--pnv-fs-12)",
                    color: "var(--pnv-text-hint)",
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    Save to: {saveAsDir || defaultSaveDir}/
                    {saveAsName && !saveAsName.endsWith(".py") && (
                      <span style={{ color: "var(--pnv-text-faint)" }}> (.py will be added)</span>
                    )}
                  </span>
                  {hasFileBridge() && (
                    <Button
                      kind="small"
                      onClick={async () => {
                        const picked = await pickSavePath({
                          defaultName: saveAsName.trim() || "my_model.py",
                          extensions: ["py"],
                          message: "Choose where to save the model copy",
                          defaultDir: saveAsDir || defaultSaveDir || undefined,
                        });
                        if (!picked) return;
                        const cut = picked.lastIndexOf("/");
                        setSaveAsDir(picked.slice(0, cut));
                        setSaveAsName(picked.slice(cut + 1));
                      }}
                      style={{ flexShrink: 0 }}
                    >
                      Choose…
                    </Button>
                  )}
                </div>
                <input
                  autoFocus
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveAs(); }}
                  placeholder="my_model.py"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "var(--pnv-fs-14)",
                    border: "1px solid var(--pnv-border)",
                    borderRadius: 6,
                    marginBottom: 16,
                    boxSizing: "border-box",
                  }}
                />
              </>
            ) : (
              <>
                {format?.description && (
                  <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
                    {format.description}
                  </div>
                )}
                {showGscWarning && (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "10px 12px",
                      border: "1px solid var(--pnv-warning-border)",
                      background: "var(--pnv-warning-tint)",
                      borderRadius: 6,
                      fontSize: "var(--pnv-fs-12)",
                      color: "var(--pnv-warning-text-on-tint)",
                      lineHeight: 1.45,
                    }}
                    role="alert"
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      MDF export will likely fail
                    </div>
                    <div>
                      This model uses{" "}
                      <span style={{ fontFamily: "monospace" }}>GraphStructureCondition</span>{" "}
                      ({gscTypesInModel.join(", ")}). PsyNeuLink does not yet serialize
                      these to MDF — see{" "}
                      <a
                        href="https://github.com/jonhanke-nam/PsyNeuLink/issues/7"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--pnv-primary-deep)" }}
                      >
                        jonhanke-nam/PsyNeuLink#7
                      </a>
                      . You can still attempt it; the backend will report a
                      "MDF support not yet implemented" error.
                    </div>
                  </div>
                )}
                {showNestedWarning && (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "10px 12px",
                      border: "1px solid var(--pnv-warning-border)",
                      background: "var(--pnv-warning-tint)",
                      borderRadius: 6,
                      fontSize: "var(--pnv-fs-12)",
                      color: "var(--pnv-warning-text-on-tint)",
                      lineHeight: 1.45,
                    }}
                    role="alert"
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      MDF export will lose nested structure
                    </div>
                    <div>
                      This model contains nested Composition
                      {nestedCompsInModel.length > 1 ? "s" : ""} (
                      <span style={{ fontFamily: "monospace" }}>
                        {nestedCompsInModel.join(", ")}
                      </span>
                      ). PsyNeuLink's MDF export does not yet support nesting —
                      the inner Composition is written as an opaque node, its
                      boundary projections are dropped, and the file cannot be
                      re-imported. See{" "}
                      <a
                        href="https://github.com/jonhanke-nam/PsyNeuLink/issues/3"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--pnv-primary-deep)" }}
                      >
                        jonhanke-nam/PsyNeuLink#3
                      </a>
                      . You can still export, but the file will be incomplete.
                    </div>
                  </div>
                )}
                {!!format?.mdfBased && mdfGaps.map((gap) => {
                  const info = gap.severity === "info";
                  return (
                    <div
                      key={gap.issue}
                      data-testid={`mdf-gap-${gap.issue}`}
                      role={info ? "status" : "alert"}
                      style={{
                        marginBottom: 12,
                        padding: "10px 12px",
                        border: `1px solid ${info ? "var(--pnv-primary-tint-border)" : "var(--pnv-warning-border)"}`,
                        background: info ? "var(--pnv-primary-tint)" : "var(--pnv-warning-tint)",
                        borderRadius: 6,
                        fontSize: "var(--pnv-fs-12)",
                        color: info ? "var(--pnv-primary-text-on-tint)" : "var(--pnv-warning-text-on-tint)",
                        lineHeight: 1.45,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{gap.title}</div>
                      <div>
                        {gap.detail}
                        {gap.upstream && (
                          <>
                            {" "}See{" "}
                            <a href={gap.upstream} target="_blank" rel="noopener noreferrer" style={{ color: "var(--pnv-primary-deep)" }}>
                              {gap.upstream.replace(/^https:\/\/github\.com\/(.+)\/issues\/(\d+)$/, "$1#$2")}
                            </a>
                            .
                          </>
                        )}
                      </div>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                        {gap.items.map((item) => (
                          <li key={item} style={{ fontFamily: "monospace" }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <div style={{ fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-secondary)", marginBottom: 16 }}>
                  {toServer ? "Writes: " : "Downloads: "}
                  <span style={{ fontFamily: "monospace", color: "var(--pnv-text)" }}>
                    {toServer ? `${saveAsDir || defaultSaveDir}/${exportFilename}` : exportFilename}
                  </span>
                </div>
              </>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button kind="secondary" onClick={() => setSaveAsOpen(false)} disabled={exporting}>
                Cancel
              </Button>
              <Button kind="primary" onClick={onSave} disabled={saveDisabled}>
                {exporting
                  ? (toServer ? "Saving…" : "Downloading…")
                  : (toServer ? "Save" : "Download")}
              </Button>
            </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Conversion confirmation modal */}
      {/* Custom prompt modal (replaces browser prompt() for WKWebView compatibility) */}
      {promptState && (
        <PromptModal
          title={promptState.title}
          message={promptState.message}
          placeholder={promptState.placeholder}
          defaultValue={promptState.defaultValue}
          onSubmit={promptState.onSubmit}
          onCancel={() => setPromptState(null)}
        />
      )}

      {/* Plain-web "Open from path" file navigator (#618) */}
      {fileBrowserOpen && (
        <FileBrowserModal
          onSelect={(path) => {
            setFileBrowserOpen(false);
            setCurrentDemo(null);
            setPristineSource(null);
            loadFromPath(path);
          }}
          onCancel={() => setFileBrowserOpen(false)}
        />
      )}
    </div>
  );
}

// Model-identity chip (#504 Phase C; was the file-path chip from #344).
// The editor header owns the filename (#504 Phases A/B), so the toolbar
// shows model-level identity — the composition name — instead of
// duplicating the path. The full path stays one hover away in the
// tooltip and one click away via copy.
function FilePathChip({
  filePath,
  bundleOrigin,
  dirty,
  onCopy,
}: {
  filePath: string;
  bundleOrigin?: string | null;
  dirty: boolean;
  onCopy: () => void;
}) {
  const showChangesSinceSave = useChangesSinceSaveStore((s) => s.show);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const compositionNames = useModelStore((s) => s.compositionNames);
  const compositionDisplayNames = useModelStore((s) => s.compositionDisplayNames);
  // For an opened .pnlproject, the tooltip / copy target is the bundle (not
  // the hashed working dir): Save round-trips into that bundle, so it's the
  // user's real artifact.
  const shownPath = bundleOrigin || filePath;
  const parts = shownPath.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] || shownPath;
  // #515: render the composition's canonical display label (name= attribute),
  // matching the selector/breadcrumb/status bar. Fall back to the .py
  // basename until diagnostics yield a composition.
  const compKey = activeComposition || compositionNames[0];
  const display = (compKey && compositionDisplayNames[compKey]) || compKey || basename;

  return (
    <span
      data-testid="model-name"
      style={{
        fontSize: "var(--pnv-fs-12)",
        color: "var(--pnv-text-hint)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        // Grow into the toolbar's free space so the model name shows in full
        // when there's room, and only ellipsize when genuinely cramped (#471).
        flex: "1 1 auto",
        minWidth: 0,
      }}
    >
      {dirty && (
        // A real button: clicking the dot shows what the unsaved changes are,
        // against the file on disk (#1348).
        <button
          type="button"
          data-testid="unsaved-dot"
          onClick={showChangesSinceSave}
          style={{
            color: "var(--pnv-unsaved)", fontSize: "var(--pnv-fs-14)", lineHeight: 1, flexShrink: 0,
            background: "none", border: "none", padding: "0 2px", cursor: "pointer",
          }}
          title="Unsaved changes: click to see them"
          aria-label="Unsaved changes: click to see them"
        >
          ●
        </button>
      )}
      {bundleOrigin && (
        <span
          style={{
            flexShrink: 0,
            fontSize: "var(--pnv-fs-10)",
            fontWeight: 700,
            color: "var(--pnv-primary-text-on-tint)",
            background: "var(--pnv-primary-tint)",
            border: "1px solid var(--pnv-primary-tint-border)",
            borderRadius: 4,
            padding: "1px 5px",
            letterSpacing: "0.03em",
          }}
          title="Opened from a .pnlproject bundle — Save updates the bundle"
        >
          BUNDLE
        </span>
      )}
      <span
        style={{
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "monospace",
          minWidth: 0,
        }}
        onClick={onCopy}
        title={
          bundleOrigin
            ? `${bundleOrigin}\n(opened in place; working copy: ${filePath})\n(click to copy bundle path)`
            : `${filePath}\n(click to copy full path)`
        }
      >
        {display}
      </span>
      <FormatBadge />
      <EditModeBadge />
      <PnlSourceBadge />
      <AutosaveStatus />
    </span>
  );
}

/**
 * The "view only" tag: shown only while the model is locked. (#1116, #1309)
 *
 * The lock lives in the model's layout file rather than in a user preference,
 * so a curated model can ship locked and stay locked for whoever opens it. The
 * API enforces it; this shows it, and clicking the tag unlocks. Locking lives
 * in the Layout menu ("Lock this model (view only)"), so an unlocked model —
 * the normal case — shows nothing: a status is shown only when it is the
 * exception (docs/settings-etiquette.md).
 *
 * Not shown while the file is a protected PsyNeuLink file (#1305): the
 * PnlSourceBadge and the editor's banner already say why it can't be edited,
 * and the location rule answers the question the lock would. For a model
 * locked inside a checkout you then protect (#1346), the toolbar shows the
 * stricter rule only: the checkout tag says "protected", and its tooltip
 * says the model is locked too, so allowing edits isn't a surprise.
 */
function EditModeBadge() {
  const filePath = useModelStore((s) => s.filePath);
  // The text on disk as last loaded or saved: when it changes, a protection
  // line may have come or gone (#1346), so the rule is asked for again.
  const savedSource = useModelStore((s) => s.savedSource);
  const pnlProtected = usePnlSourceStore((s) => isProtected(s.status));
  const inCheckout = usePnlSourceStore((s) => isOwnCheckout(s.status));
  const mode = useEditLockStore((s) => s.mode);
  const rule = useEditLockStore((s) => s.rule);
  const refresh = useEditLockStore((s) => s.refresh);
  const recheck = useEditLockStore((s) => s.recheck);
  const setMode = useEditLockStore((s) => s.setMode);
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    void refresh(filePath);
  }, [filePath, refresh]);

  useEffect(() => {
    void recheck();
  }, [savedSource, recheck]);

  if (!filePath || mode !== "viewOnly" || pnlProtected) return null;

  const style: React.CSSProperties = {
    marginLeft: 6,
    fontSize: "var(--pnv-fs-10)",
    padding: "1px 6px",
    borderRadius: 3,
    border: "1px solid var(--pnv-warning-tag-border)",
    background: "var(--pnv-warning-tint)",
    color: "var(--pnv-warning-tag-text)",
  };

  // #1346: the file says "# PsyNeuView: protected permanently". PsyNeuView
  // offers no unlock, so the tag is a label, not a button; its tooltip says
  // what does work.
  if (rule === "protectedPermanently") {
    return (
      <span
        data-testid="edit-mode-badge"
        data-rule={rule}
        title={
          "This model's file says \"# PsyNeuView: protected permanently\" near the top, so PsyNeuView " +
          "won't change it: the graph, the inspector and the code editor are read only, and there is no " +
          "unlock here. Moving nodes is still fine. To work on it, use Save a copy as… (the copy starts " +
          "unprotected). To make this file editable, remove that line in another editor or with git."
        }
        style={style}
      >
        protected permanently
      </span>
    );
  }

  const unlock = async () => {
    if (!(await setMode("editable"))) addNotification("error", "Couldn't unlock this model.");
  };

  return (
    <button
      data-testid="edit-mode-badge"
      data-rule={rule ?? "lock"}
      onClick={unlock}
      title={
        rule === "protected"
          ? "This model's file says \"# PsyNeuView: protected\" near the top, so it opens read only: the " +
            "graph, the inspector and the code editor can't change it. Moving nodes is still fine. Click to " +
            "unlock it (also Layout ▸ Unlock this model); PsyNeuView remembers the unlock for this file on " +
            "this computer, and the line stays in the file."
          : (inCheckout
              ? "This model is locked (view only) inside your PsyNeuLink checkout: the graph, the inspector " +
                "and the code editor can't change it, while the checkout's other files stay editable. "
              : "This model is locked: the graph, the inspector and the code editor can't change it. ") +
            "Moving nodes is still fine. Click to unlock it (also Layout ▸ Unlock this model)."
      }
      style={{ ...style, cursor: "pointer" }}
    >
      {rule === "protected" ? "view only · protected" : "view only"}
    </button>
  );
}

/**
 * Lock / Unlock, as a row of the Layout menu (#1309).
 *
 * Hidden when no model is open, and for a PsyNeuLink that PsyNeuView manages
 * (GitHub, PyPI, a kept release, #1305): that file is read only whatever the
 * lock says, so there is nothing for a lock to add.
 *
 * Shown for your own checkout, editable or protected (#1346): there the lock
 * protects one model while the rest of the checkout stays editable, and a
 * lock set while the checkout is protected is still in force after edits are
 * allowed again. It is kept in the model's layout file, which for a checkout
 * sits beside the model in the repo, so it travels with it if committed.
 */
function LockModelMenuItem({ onDone }: { onDone: () => void }) {
  const filePath = useModelStore((s) => s.filePath);
  const managed = usePnlSourceStore((s) => isManaged(s.status));
  const inCheckout = usePnlSourceStore((s) => isOwnCheckout(s.status));
  const mode = useEditLockStore((s) => s.mode);
  const rule = useEditLockStore((s) => s.rule);
  const unlockedHere = useEditLockStore((s) => s.unlockedHere);
  const setMode = useEditLockStore((s) => s.setMode);
  const addNotification = useNotificationStore((s) => s.addNotification);

  if (!filePath || !mode || managed) return null;

  const heading = (
    <div style={{ fontSize: "var(--pnv-fs-10)", fontWeight: 600, color: "var(--pnv-text-faint)", padding: "4px 8px 2px", textTransform: "uppercase", letterSpacing: 0.5 }}>
      This model
    </div>
  );
  const divider = <span style={{ display: "block", height: 1, background: "var(--pnv-border-faint)", margin: "4px 4px" }} />;

  // #1346: "# PsyNeuView: protected permanently" in the file. No unlock is
  // offered anywhere, so the row says why instead of offering one.
  if (rule === "protectedPermanently") {
    return (
      <>
        {heading}
        <div
          data-testid="layout-menu-protected-permanently"
          style={{ ...menuRowStyle(false), cursor: "default", color: "var(--pnv-text-hint)", whiteSpace: "normal", maxWidth: 260 }}
        >
          Protected permanently by a line in its file. Use Save a copy as… to work on a copy.
        </div>
        {divider}
      </>
    );
  }

  const locked = mode === "viewOnly";
  const choose = async () => {
    onDone();
    const ok = await setMode(locked ? "editable" : "viewOnly");
    if (!ok) addNotification("error", locked ? "Couldn't unlock this model." : "Couldn't lock this model.");
  };

  return (
    <>
      {heading}
      <button
        onClick={choose}
        data-testid="layout-menu-lock-model"
        title={
          (locked
            ? rule === "protected"
              ? "Let the graph, the inspector and the code editor change this model again. Its file says \"# PsyNeuView: protected\"; the unlock is remembered for this file on this computer and the line stays."
              : "Let the graph, the inspector and the code editor change this model again"
            : unlockedHere
              ? "Its file says \"# PsyNeuView: protected\" and you unlocked it on this computer. Lock it again so it opens read only, as the file asks."
              : "Keep the graph, the inspector and the code editor from changing this model. Moving nodes is still fine. The lock is saved with the model's layout file.") +
          (inCheckout && !locked ? " The rest of your PsyNeuLink checkout stays as it is." : "")
        }
        style={menuRowStyle(false)}
        onMouseEnter={(e) => (e.currentTarget.style.background = MENU_ROW_HOVER)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {locked ? "Unlock this model" : "Lock this model (view only)"}
      </button>
      {divider}
    </>
  );
}

/**
 * Says when the open file belongs to the active PsyNeuLink (#1225).
 *
 * From GitHub or PyPI it's read only, full stop: no click, just the reason.
 * The user's own local checkout is editable by default (#1305); clicking the
 * badge protects that checkout from edits, or allows them again. The backend
 * enforces both; this shows the state and, for a checkout, flips it.
 */
/**
 * The model's own rule, for the checkout tag's tooltip (#1346): what stays
 * read only after the checkout's own rule is undone, and how to undo that.
 */
function modelRuleNote(rule: string | null, checkoutProtected: boolean): string {
  const also = checkoutProtected ? "also " : "";
  if (rule === "protectedPermanently") {
    return `This model's file ${also}says "# PsyNeuView: protected permanently", so it stays read only whatever this tag says; only removing that line outside PsyNeuView changes it.`;
  }
  if (rule === "protected") {
    return `This model's file ${also}says "# PsyNeuView: protected", so it stays read only until you unlock it${checkoutProtected ? " too" : ""} (Layout ▸ Unlock this model).`;
  }
  return checkoutProtected
    ? "This model is also locked (view only), so it stays read only until you unlock it too (Layout ▸ Unlock this model)."
    : 'This model is locked (view only), so it stays read only: click the "view only" tag to unlock it.';
}

function PnlSourceBadge() {
  const filePath = useModelStore((s) => s.filePath);
  const status = usePnlSourceStore((s) => s.status);
  // The per-model lock, for the tooltip only (#1346): which of the two rules
  // applies to this model, and what allowing edits will and won't undo.
  const locked = useEditLockStore((s) => s.mode === "viewOnly");
  // ...and, since #1346 part 2, whether that is the lock or a protection line.
  const rule = useEditLockStore((s) => s.rule);
  const refresh = usePnlSourceStore((s) => s.refresh);
  const setProtected = usePnlSourceStore((s) => s.setProtected);
  const addNotification = useNotificationStore((s) => s.addNotification);

  useEffect(() => {
    void refresh(filePath);
  }, [filePath, refresh]);

  if (!status?.owned) return null;

  const style = (editable: boolean): React.CSSProperties => ({
    marginLeft: 6,
    fontSize: "var(--pnv-fs-10)",
    padding: "1px 6px",
    borderRadius: 3,
    border: `1px solid ${editable ? "var(--pnv-primary-tint-border)" : "var(--pnv-warning-tag-border)"}`,
    background: editable ? "var(--pnv-primary-tint)" : "var(--pnv-warning-tint)",
    color: editable ? "var(--pnv-primary-deep)" : "var(--pnv-warning-tag-text)",
  });

  if (status.kind !== "local") {
    const from = status.kind === "github" ? "GitHub" : "PyPI";
    return <ManagedSourceBadge from={from} title={status.message} style={style(false)} />;
  }

  const editable = !!status.editable;
  const toggle = async () => {
    if (!(await setProtected(editable))) {
      addNotification("error", "Couldn't change whether your PsyNeuLink checkout can be edited.");
    }
  };
  return (
    <button
      data-testid="pnl-source-badge"
      onClick={toggle}
      title={
        editable
          ? locked
            ? `${status.message} ${modelRuleNote(rule, false)} Click here to protect the whole checkout from edits.`
            : `${status.message} Click to protect this checkout from edits.`
          : locked
            ? `${status.message} Click to allow edits. ${modelRuleNote(rule, true)}`
            : `${status.message} Click to allow edits.`
      }
      style={{ ...style(editable), cursor: "pointer" }}
    >
      {editable ? "your PsyNeuLink checkout · editing" : "your PsyNeuLink checkout · protected"}
    </button>
  );
}

/**
 * The "PsyNeuLink from … · read only" tag, for a PsyNeuLink that PsyNeuView
 * manages (#50). The editor's banner explains it too, but only while the code
 * editor is open; clicking the tag says the same thing from the toolbar and
 * offers the way out, Save a copy as… (the same `requestSaveCopy` the banner
 * of a permanently protected model uses). Escape, the ×, a click outside or
 * the tag again close it.
 */
function ManagedSourceBadge({ from, title, style }: { from: string; title?: string; style: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  useDismiss(open, () => setOpen(false));

  const saveCopy = () => {
    setOpen(false);
    requestSaveCopy();
  };

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        data-testid="pnl-source-badge"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title={`${title ? `${title} ` : ""}Click to see why, and how to work on a copy.`}
        style={{ ...style, cursor: "pointer" }}
      >
        PsyNeuLink from {from} · read only
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby="pnl-read-only-note-title"
          data-testid="pnl-read-only-note"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            // Above the panel dividers (Allotment sashes, z-index 35), like the Open menu (#1391).
            zIndex: Z_MENU,
            width: 320,
            display: "flex",
            flexDirection: "column",
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            whiteSpace: "normal",
            fontFamily: "inherit",
            textAlign: "left",
          }}
        >
          <DialogHeader title="Why this file is read only" titleId="pnl-read-only-note-title" onClose={() => setOpen(false)} compact />
          <div style={{ padding: "10px 12px", fontSize: "var(--pnv-fs-12)", lineHeight: 1.5, color: "var(--pnv-text)" }}>
            <p style={{ margin: "0 0 8px" }}>
              This file is part of the PsyNeuLink that PsyNeuView installed from {from}. PsyNeuView keeps it read
              only, so it stays the same as where it came from and an update can replace it.
            </p>
            <p style={{ margin: 0 }}>
              To change it, save your own copy and work on that. Moving nodes is fine here: the layout is kept
              separately.
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px 12px" }}>
            <Button kind="primary" size="compact" data-testid="pnl-read-only-note-save-copy" onClick={saveCopy}>
              Save a copy as…
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}

function FormatBadge() {
  const source = useModelStore((s) => s.source);
  const starConverted = useModelStore((s) => s.starImportConverted);

  if (!source) return null;

  const isStandard = source.trimStart().startsWith("# PsyNeuLink Model File");
  const label = starConverted ? "converted" : isStandard ? "standard" : "free-form";
  // Free-form is a caution (some editing features may be limited): warning.
  const color = starConverted ? "var(--pnv-primary-deep)" : isStandard ? "var(--pnv-success)" : "var(--pnv-warning)";

  return (
    <span
      style={{
        fontSize: "var(--pnv-fs-9)",
        fontWeight: 600,
        color,
        // The 7% wash and 27% edge the hex alphas 11 and 44 used to give.
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 27%, transparent)`,
        padding: "0px 5px",
        borderRadius: 3,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        flexShrink: 0,
      }}
      title={
        isStandard
          ? "File follows the standardized PsyNeuLink format"
          : starConverted
          ? "Star imports were auto-converted to import psyneulink as pnl"
          : "Free-form file — some editing features may be limited"
      }
    >
      {label}
    </span>
  );
}

const LAYOUT_PRESETS: { id: LayoutPreset; label: string; title: string }[] = [
  { id: "graph", label: "Graph only", title: "Show only the graph canvas" },
  { id: "code-graph", label: "Code + Graph", title: "Python editor beside the graph" },
  { id: "graph-inspector", label: "Graph + Inspector", title: "Graph above the inspector/run tabs" },
  { id: "everything", label: "Everything", title: "Show all panels (code, graph, tabs, palette)" },
];

/**
 * Entry point to the guided walkthroughs (#1181).
 *
 * Until this existed the only way to start one was `?tour=<id>` on the URL,
 * which meant nobody found them without being told. The list comes straight
 * from the walkthrough registry, so adding a YAML file under
 * `src/walkthroughs/` puts it in this menu — no second place to keep in sync.
 */
function WalkthroughMenu() {
  const activeTourId = useTourStore((s) => s.activeTourId);
  const startTour = useTourStore((s) => s.startTour);
  const stopTour = useTourStore((s) => s.stopTour);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  useDismiss(open, () => setOpen(false));

  const groups = menuGroups();
  // #8: section headings fold, like the Open menu's. Remembered; the running
  // walkthrough's section opens whenever the menu does.
  const [folded, setFolded] = useState<Set<string>>(() => loadFoldedSections());
  useEffect(() => {
    if (!open) return;
    setFolded((prev) => {
      const next = unfoldActive(prev, groups, activeTourId);
      if (next !== prev) saveFoldedSections(next);
      return next;
    });
    // Re-checked each time the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTourId]);
  const toggleGroup = (id: string) =>
    setFolded((prev) => {
      const next = toggleFolded(prev, id);
      saveFoldedSections(next);
      return next;
    });
  // #1310: "Maybe later" on the first-launch offer puts a reminder here, until
  // a part of the orientation is started or the reminder is dismissed.
  const [offerChoice, setOfferChoice] = useState(readOfferChoice());
  useEffect(() => {
    if (open) setOfferChoice(readOfferChoice());
  }, [open]);
  const remind = shouldRemindFromMenu(offerChoice);
  const orientationParts = orientationWalkthroughs();
  const firstPart = orientationParts[0];
  const orientationMinutes = orientationParts.reduce((sum, w) => sum + (w.minutes ?? 3), 0);
  const start = (id: string) => {
    // Starting any part of the orientation answers the offer.
    if (orientationWalkthroughs().some((w) => w.id === id) && readOfferChoice() !== "never") {
      writeOfferChoice("started");
      setOfferChoice("started");
    }
    startTour(id);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="walkthrough-menu"
        data-reminder={remind ? "true" : undefined}
        style={{
          fontSize: "var(--pnv-fs-13)",
          padding: "4px 10px",
          cursor: "pointer",
          ...toggleColours(!!(open || activeTourId)),
          borderRadius: 4,
        }}
        title={remind ? "Guided walkthroughs — the orientation is waiting for you" : "Guided walkthroughs"}
      >
        Tutorials {"\u25be"}
        {remind && (
          <span
            aria-hidden="true"
            style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--pnv-warning)", marginLeft: 6, verticalAlign: "middle" }}
          />
        )}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="walkthrough-menu-list"
          onClickCapture={(e) => recordMenuClick("Tutorials", e)}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            // Above the panel dividers (Allotment sashes, z-index 35), like the Open menu (#1391).
            zIndex: Z_MENU,
            minWidth: 340,
            // The list outgrows a short window; scroll inside the window instead of off its bottom.
            maxHeight: "calc(100vh - 56px)",
            overflowY: "auto",
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            padding: 4,
          }}
        >
          {remind && firstPart && (
            <div
              data-testid="walkthrough-offer-reminder"
              style={{ margin: 4, padding: "6px 8px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-warning-text-on-tint)", background: "var(--pnv-warning-tint)", border: "1px solid var(--pnv-warning-border)", borderRadius: 5 }}
            >
              You put off the orientation. It's {orientationParts.length} short parts, about {orientationMinutes} minutes in all.{" "}
              <Button
                kind="link"
                data-testid="walkthrough-offer-reminder-start"
                onClick={() => start(firstPart.id)}
              >
                Start part 1
              </Button>
              {" · "}
              <button
                type="button"
                data-testid="walkthrough-offer-reminder-dismiss"
                onClick={() => {
                  writeOfferChoice("never");
                  setOfferChoice("never");
                }}
                style={{ border: "none", background: "none", color: "var(--pnv-warning-tag-text)", cursor: "pointer", padding: 0, font: "inherit" }}
              >
                Don't remind me
              </button>
            </div>
          )}
          {groups.map((group) => (
            <div
              key={group.title}
              data-testid={`walkthrough-group-${group.id}`}
            >
              <button
                type="button"
                data-testid={`tutorials-section-${group.id}`}
                aria-expanded={!folded.has(group.id)}
                onClick={() => toggleGroup(group.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "var(--pnv-fs-10)",
                  fontWeight: 600,
                  color: "var(--pnv-text-faint)",
                  padding: "4px 8px 2px",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontFamily: "inherit",
                  lineHeight: "inherit",
                }}
              >
                {/* Same fold glyph as the Open menu's section headings. */}
                <span aria-hidden="true" style={{ fontSize: "var(--pnv-fs-9)", width: 10, color: "var(--pnv-text-hint)" }}>
                  {folded.has(group.id) ? "\u25b6" : "\u25bc"}
                </span>
                <span>{group.title}</span>
                {folded.has(group.id) && (
                  <span style={{ marginLeft: "auto", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                    {group.walkthroughs.length}
                  </span>
                )}
              </button>
              {!folded.has(group.id) && group.walkthroughs.map((w) => (
                <button
                  key={w.id}
                  data-testid={`walkthrough-${w.id}`}
                  onClick={() => start(w.id)}
                  title={
                    w.model
                      ? `Runs against ${w.model}`
                      : "Builds its own model — start from anywhere"
                  }
                  style={{
                    ...menuRowStyle(activeTourId === w.id),
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                  onMouseEnter={(e) => {
                    if (activeTourId !== w.id) e.currentTarget.style.background = MENU_ROW_HOVER;
                  }}
                  onMouseLeave={(e) => {
                    if (activeTourId !== w.id) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span>
                    {w.orientation !== undefined ? `${w.orientation}. ` : ""}
                    {w.title}
                  </span>
                  <span style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", whiteSpace: "nowrap" }}>
                    {w.course ? `${w.course} · ` : ""}
                    {w.steps.length} step{w.steps.length === 1 ? "" : "s"}
                    {w.minutes !== undefined ? ` · ~${w.minutes} min` : ""}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {activeTourId && (
            <>
              <span style={{ display: "block", height: 1, background: "var(--pnv-border-faint)", margin: "4px 4px" }} />
              <button
                data-testid="walkthrough-stop"
                onClick={() => {
                  stopTour();
                  setOpen(false);
                }}
                style={menuRowStyle(false)}
                onMouseEnter={(e) => (e.currentTarget.style.background = MENU_ROW_HOVER)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Stop the current walkthrough
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LayoutMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const codeVisible = useLayoutStore((s) => s.codeVisible);
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  const bottomVisible = useLayoutStore((s) => s.bottomVisible);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const applyPreset = useLayoutStore((s) => s.applyPreset);
  const paletteOpen = usePaletteStore((s) => s.isOpen);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  useDismiss(open, () => setOpen(false));

  // Hiding the last visible of code/graph/bottom is blocked by the store, so
  // grey out that row's toggle to signal it can't be turned off right now.
  const lastTopLevel = [codeVisible, graphVisible, bottomVisible].filter(Boolean).length === 1;
  const panels: { label: string; visible: boolean; locked: boolean; onToggle: () => void }[] = [
    { label: "Code editor", visible: codeVisible, locked: lastTopLevel && codeVisible, onToggle: () => setPanelVisible("code", !codeVisible) },
    { label: "Graph canvas", visible: graphVisible, locked: lastTopLevel && graphVisible, onToggle: () => setPanelVisible("graph", !graphVisible) },
    { label: "Inspector / tabs", visible: bottomVisible, locked: lastTopLevel && bottomVisible, onToggle: () => setPanelVisible("bottom", !bottomVisible) },
    { label: "Object palette", visible: paletteOpen, locked: false, onToggle: () => usePaletteStore.getState().setOpen(!paletteOpen) },
  ];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: "var(--pnv-fs-13)",
          padding: "4px 10px",
          cursor: "pointer",
          ...toggleColours(open),
          borderRadius: 4,
        }}
        title="Layout presets, panel visibility, and locking this model"
        data-testid="layout-menu-button"
      >
        Layout {"▾"}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="layout-menu-list"
          onClickCapture={(e) => recordMenuClick("Layout", e)}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            // Above the panel dividers (Allotment sashes, z-index 35), like the Open menu (#1391).
            zIndex: Z_MENU,
            minWidth: 190,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            padding: 4,
          }}
        >
          <div style={{ fontSize: "var(--pnv-fs-10)", fontWeight: 600, color: "var(--pnv-text-faint)", padding: "4px 8px 2px", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Presets
          </div>
          {LAYOUT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                applyPreset(p.id);
                setOpen(false);
              }}
              title={p.title}
              style={menuRowStyle(false)}
              onMouseEnter={(e) => (e.currentTarget.style.background = MENU_ROW_HOVER)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {p.label}
            </button>
          ))}
          <span style={{ display: "block", height: 1, background: "var(--pnv-border-faint)", margin: "4px 4px" }} />
          <div style={{ fontSize: "var(--pnv-fs-10)", fontWeight: 600, color: "var(--pnv-text-faint)", padding: "4px 8px 2px", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Panels
          </div>
          {panels.map((panel) => (
            <button
              key={panel.label}
              onClick={panel.onToggle}
              disabled={panel.locked}
              title={panel.locked ? "Can't hide the last visible panel" : `Show/hide ${panel.label}`}
              style={{
                ...menuRowStyle(panel.visible),
                cursor: panel.locked ? "not-allowed" : "pointer",
                opacity: panel.locked ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!panel.visible && !panel.locked) e.currentTarget.style.background = MENU_ROW_HOVER;
              }}
              onMouseLeave={(e) => {
                if (!panel.visible) e.currentTarget.style.background = "transparent";
              }}
            >
              <span>{panel.label}</span>
              <span style={{ opacity: panel.visible ? 1 : 0.25 }}>{panel.visible ? "✓" : "·"}</span>
            </button>
          ))}
          <span style={{ display: "block", height: 1, background: "var(--pnv-border-faint)", margin: "4px 4px" }} />
          <LockModelMenuItem onDone={() => setOpen(false)} />
          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            data-testid="layout-menu-settings"
            title="Open Settings (also the ⚙ button)"
            style={menuRowStyle(false)}
            onMouseEnter={(e) => (e.currentTarget.style.background = MENU_ROW_HOVER)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Settings…
          </button>
        </div>
      )}
    </div>
  );
}

function menuRowStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    fontSize: "var(--pnv-fs-12)",
    textAlign: "left",
    padding: "5px 8px",
    border: "none",
    borderRadius: 4,
    ...menuRowColours(active),
    cursor: "pointer",
  };
}
