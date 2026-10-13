/**
 * CodeMirror-based Python code editor.
 * Shows the .py source file. Highlights the selected node's declaration block.
 * Scrolls to specific lines when params are clicked in the Inspector.
 * Ctrl+S / Cmd+S saves the code to the file and re-introspects the model.
 */

import { useEffect, useRef, useCallback, useMemo, useState, type CSSProperties } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import {
  EditorView,
  keymap,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { registerCommand } from "@/shortcuts/commands";
import { useModelStore } from "@/stores/modelStore";
import { useExternalChangeStore } from "@/stores/externalChangeStore";
import { useUIStore } from "@/stores/uiStore";
import type { MechanismData } from "@/stores/modelStore";
import { recordAction, recordSave } from "@/utils/history";
import { useNotificationStore } from "@/stores/notificationStore";
import { useStatusStore } from "@/stores/statusStore";
import { parseYamlMapping, findEntryAtLine, findLineFor } from "@/utils/yamlMapping";
import { SidecarVariantPicker } from "./SidecarVariantPicker";
import { SidecarPlacementPicker } from "./SidecarPlacementPicker";
import { isOwnCheckout, isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { openSettings } from "@/components/common/settings/sections";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Button } from "@/components/common/Button";
import { useAutosaveStore } from "@/stores/autosaveStore";
import { SAVE_EVENT, requestSaveCopy, type SaveRequestDetail, type SaveRequestOptions } from "@/utils/saveRequest";

// ─── Highlight decoration ────────────────────────────────────────

/** Effect to update the highlighted line range (node block) */
// PNL class completions shown after "pnl."
const PNL_COMPLETIONS = [
  // Mechanisms
  { label: "TransferMechanism", type: "class", detail: "Basic processing mechanism", boost: 10 },
  { label: "ProcessingMechanism", type: "class", detail: "Generic processing mechanism", boost: 9 },
  { label: "RecurrentTransferMechanism", type: "class", detail: "Recurrent connections", boost: 7 },
  { label: "IntegratorMechanism", type: "class", detail: "Integrates input over time", boost: 6 },
  { label: "DDM", type: "class", detail: "Drift Diffusion Model", boost: 8 },
  { label: "ObjectiveMechanism", type: "class", detail: "Evaluates output", boost: 5 },
  { label: "ControlMechanism", type: "class", detail: "Controls other mechanisms", boost: 5 },
  { label: "LearningMechanism", type: "class", detail: "Learning rule mechanism", boost: 4 },
  { label: "ComparatorMechanism", type: "class", detail: "Compares inputs", boost: 4 },
  // Projections
  { label: "MappingProjection", type: "class", detail: "Weighted connection", boost: 9 },
  { label: "ControlProjection", type: "class", detail: "Control signal", boost: 5 },
  { label: "LearningProjection", type: "class", detail: "Learning signal", boost: 4 },
  { label: "AutoAssociativeProjection", type: "class", detail: "Self-recurrent projection", boost: 3 },
  // Compositions
  { label: "Composition", type: "class", detail: "Model container", boost: 10 },
  { label: "AutodiffComposition", type: "class", detail: "PyTorch-backed composition", boost: 5 },
  // Functions
  { label: "Linear", type: "function", detail: "f(x) = slope*x + intercept" },
  { label: "Logistic", type: "function", detail: "f(x) = 1/(1+exp(-(gain*x+bias)))" },
  { label: "ReLU", type: "function", detail: "f(x) = max(0, x)" },
  { label: "SoftMax", type: "function", detail: "Softmax normalization" },
  { label: "Exponential", type: "function", detail: "f(x) = rate*e^(bias*x+scale)" },
  // Scheduling
  { label: "EveryNCalls", type: "function", detail: "Run every N calls" },
  { label: "AfterNCalls", type: "function", detail: "Run after N calls" },
  { label: "BeforeNode", type: "function", detail: "Run before a node" },
  { label: "AfterNode", type: "function", detail: "Run after a node" },
  { label: "Always", type: "function", detail: "Always run" },
  { label: "All", type: "function", detail: "All conditions met" },
  { label: "Any", type: "function", detail: "Any condition met" },
  // Constants
  { label: "IDENTITY_MATRIX", type: "constant", detail: "Identity weight matrix" },
  { label: "FULL_CONNECTIVITY_MATRIX", type: "constant", detail: "All-to-all connections" },
  { label: "NodeRole", type: "enum", detail: "INPUT, OUTPUT, INTERNAL, etc." },
];

const setHighlightRange = StateEffect.define<{
  from: number;
  to: number;
} | null>();

/** Effect to highlight a single active param line */
const setActiveParamLine = StateEffect.define<number | null>();

/** Line decoration: subtle amber background for the selected node's code block */
const highlightLineDeco = Decoration.line({
  attributes: {
    style:
      "background-color: var(--pnv-editor-node-tint); border-left: 3px solid var(--pnv-editor-node-accent); padding-left: 4px;",
  },
});

/** Line decoration: blue accent for the active param line (matches Inspector focus) */
const activeParamDeco = Decoration.line({
  attributes: {
    style:
      "background-color: var(--pnv-primary-tint); border-left: 3px solid var(--pnv-primary); padding-left: 4px;",
  },
});

/** StateField for the node block highlight */
const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightRange)) {
        if (!effect.value) return Decoration.none;
        const { from, to } = effect.value;
        const builder: any[] = [];
        for (let line = from; line <= to; line++) {
          if (line >= 1 && line <= tr.state.doc.lines) {
            const lineObj = tr.state.doc.line(line);
            builder.push(highlightLineDeco.range(lineObj.from));
          }
        }
        return Decoration.set(builder);
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** StateField for the active param line highlight (overlays on node block) */
const activeParamField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setActiveParamLine)) {
        if (!effect.value) return Decoration.none;
        const line = effect.value;
        if (line >= 1 && line <= tr.state.doc.lines) {
          const lineObj = tr.state.doc.line(line);
          return Decoration.set([activeParamDeco.range(lineObj.from)]);
        }
        return Decoration.none;
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Effect to highlight an error line */
const setErrorLine = StateEffect.define<number | null>();

/** Line decoration: red background for error line */
const errorLineDeco = Decoration.line({
  attributes: {
    style:
      "background-color: var(--pnv-danger-tint); border-left: 3px solid var(--pnv-danger); padding-left: 4px;",
  },
});

/** StateField for the error line highlight */
const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        if (!effect.value) return Decoration.none;
        const line = effect.value;
        if (line >= 1 && line <= tr.state.doc.lines) {
          const lineObj = tr.state.doc.line(line);
          return Decoration.set([errorLineDeco.range(lineObj.from)]);
        }
        return Decoration.none;
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Return the Python identifier under `col` in `line`, or null if the
 * cursor isn't on one. Used to follow `sender=foo`/`add_node(bar)`
 * references — pointing at a name should resolve to that object,
 * not just the enclosing declaration block.
 */
function extractIdentifierAt(line: string, col: number): string | null {
  if (col < 0 || col > line.length) return null;
  let start = col;
  while (start > 0 && /\w/.test(line[start - 1])) start--;
  let end = col;
  while (end < line.length && /\w/.test(line[end])) end++;
  if (start === end) return null;
  const ident = line.slice(start, end);
  if (!/^[A-Za-z_]\w*$/.test(ident)) return null;
  return ident;
}

/**
 * Given the source and a start line (1-based), find the end line of
 * the declaration block by matching parentheses from the opening `(`.
 */
function findDeclEndLine(source: string, startLine: number): number {
  const lines = source.split("\n");
  let depth = 0;
  let foundOpen = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "(") {
        depth++;
        foundOpen = true;
      } else if (ch === ")") {
        depth--;
        if (foundOpen && depth === 0) {
          return i + 1; // 1-based
        }
      }
    }
  }
  return startLine; // fallback: just the one line
}

// #504 Phase B: human-readable role for each sidecar kind, so the bundle
// picker says what each associated file is *for*, not just its filename.
const SIDECAR_ROLE: Record<string, string> = {
  labels: "Semantics",
  layout: "Layout",
  settings: "Settings",
};
const sidecarRole = (kind: string): string =>
  SIDECAR_ROLE[kind] || kind.charAt(0).toUpperCase() + kind.slice(1);

// #631: stable id for a bundle entry. The source .py is just "source"; a
// sidecar is addressed by kind + variant so multiple variants of the same
// kind (e.g. two layouts) stay distinct selections in the picker.
const bundleEntryId = (b: { kind: string; variant?: string }): string =>
  b.kind === "source" ? "source" : `${b.kind}:${b.variant ?? ""}`;

// ─── Component ───────────────────────────────────────────────────

export function CodeEditor() {
  const source = useModelStore((s) => s.source);
  const savedSource = useModelStore((s) => s.savedSource);
  const setSource = useModelStore((s) => s.setSource);
  const filePath = useModelStore((s) => s.filePath);
  // A PsyNeuLink file that can't be edited opens read only (#1225).
  const pnlProtected = usePnlSourceStore((s) => isProtected(s.status));
  // So does a model locked view only (#1320): the lock covers the code
  // editor, not just the graph and the inspector. The backend refuses the
  // save either way; read only here means the refusal is never met.
  const viewOnly = useEditLockStore((s) => s.mode === "viewOnly");
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const applyPreviewModel = useModelStore((s) => s.applyPreviewModel);
  const cursorTargetLine = useModelStore((s) => s.cursorTargetLine);
  const setCursorTargetLine = useModelStore((s) => s.setCursorTargetLine);
  const storeActiveParamLine = useModelStore((s) => s.activeParamLine);
  const selectedNodeId = useModelStore((s) => s.selectedNodeId);
  const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
  const nodes = useModelStore((s) => s.nodes);
  const edges = useModelStore((s) => s.edges);
  const lineMap = useModelStore((s) => s.lineMap);
  // #407: bundle picker state — which file in the model's "bundle" is
  // currently shown. "source" means the .py (existing behavior); any
  // other kind is a sidecar whose content lives in `sidecarContent`.
  const bundle = useModelStore((s) => s.bundle);
  const selectedBundleKind = useModelStore((s) => s.selectedBundleKind);
  const setSelectedBundleKind = useModelStore((s) => s.setSelectedBundleKind);
  const sidecarContent = useModelStore((s) => s.sidecarContent);
  const sidecarSavedContent = useModelStore((s) => s.sidecarSavedContent);
  // #503: editor font size, shared with the sidecar view. Base 13px scaled
  // by the persisted editor zoom (independent of the Inspector's scale).
  const editorFontScale = useUIStore((s) => s.editorFontScale);
  const editorZoomIn = useUIStore((s) => s.editorZoomIn);
  const editorZoomOut = useUIStore((s) => s.editorZoomOut);
  const editorFontPx = Math.round(13 * editorFontScale);
  const setSidecarContent = useModelStore((s) => s.setSidecarContent);
  const setSidecarSavedContent = useModelStore((s) => s.setSidecarSavedContent);
  // #631: selection is addressed by composite id (kind + variant); resolve
  // it to the concrete entry so the fetch/save target the right variant file.
  const selectedEntry = bundle.find((b) => bundleEntryId(b) === selectedBundleKind);
  const selectedKind = selectedEntry?.kind ?? "source";
  const selectedVariant = selectedEntry?.variant;
  const isSourceView = selectedKind === "source";
  // #504 Phase A: the editor self-identifies with the model's .py basename
  // (full path on hover) instead of a generic "Code Editor" label.
  const sourceName = filePath ? filePath.split("/").pop() || "Code Editor" : "Code Editor";
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const sourceRef = useRef(source);
  const autoRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Previews get their own controller. Sharing one with save meant a preview
  // firing mid-save aborted the save itself, so the buffer never reconciled
  // with disk — invisible locally, where the save always won the race.
  const previewAbortRef = useRef<AbortController | null>(null);
  const cursorSelectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const syncClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 });
  // #630: the header toolbar clips its controls when the editor pane is narrow,
  // so it folds to a compact layout — a clean two-state switch instead of
  // flex-wrap's one-control-at-a-time intermediate states.
  //
  // #1211: fold when the left cluster actually overflows, not below a fixed
  // width. The fixed 480px breakpoint predates the three sidecar pickers (#933),
  // so between ~480px and ~700px the row overflowed instead of folding and
  // + Snippet sat on top of the placement picker. Measuring the whole row would
  // not catch it: the left cluster overlaps the right one *inside* the row.
  //
  // Compact mode doesn't render the pickers, so the full row can't be measured
  // while folded. Remember how wide the header needed to be when it last
  // overflowed, and unfold only once there is that much room — otherwise it
  // would flip between the two layouts. A MutationObserver re-checks when a
  // label changes length, which resizes nothing.
  const headerRef = useRef<HTMLDivElement>(null);
  const headerLeftRef = useRef<HTMLSpanElement>(null);
  const headerFullWidth = useRef(0);
  const headerCompactRef = useRef(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const check = () => {
      const w = el.clientWidth;
      let compact: boolean;
      if (w < 480) {
        compact = true; // #630's floor still applies
      } else if (!headerCompactRef.current) {
        const left = headerLeftRef.current;
        const overflow = left ? left.scrollWidth - left.clientWidth : 0;
        compact = overflow > 1;
        if (compact) headerFullWidth.current = w + overflow;
      } else {
        compact = w < headerFullWidth.current;
      }
      if (compact !== headerCompactRef.current) {
        headerCompactRef.current = compact;
        setHeaderCompact(compact);
      }
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    check();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  const setSyncStatusWithClear = (status: typeof syncStatus) => {
    setSyncStatus(status);
    if (syncClearTimer.current) clearTimeout(syncClearTimer.current);
    if (status === "synced") {
      syncClearTimer.current = setTimeout(() => setSyncStatus("idle"), 3000);
    }
  };

  // Keep sourceRef in sync
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const addNotification = useNotificationStore((s) => s.addNotification);

  // #407: fetch the selected sidecar's raw content whenever the user
  // changes the bundle picker (or the labels store updates externally —
  // e.g., Inspector port-label edit hits /api/model/save-labels and the
  // user has labels.yaml open in the editor). For "source" the editor
  // already shows `source`, no fetch needed.
  const modelLabels = useModelStore((s) => s.modelLabels);
  useEffect(() => {
    if (isSourceView || !filePath) return;
    const ctl = new AbortController();
    (async () => {
      try {
        const resp = await fetch("/api/model/sidecar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: filePath, kind: selectedKind, variant: selectedVariant }),
          signal: ctl.signal,
        });
        if (!resp.ok) {
          addNotification("error", `Failed to load sidecar: ${resp.statusText}`);
          return;
        }
        const data = await resp.json();
        setSidecarContent(data.content ?? "", data.language ?? null);
        setSidecarSavedContent(data.content ?? "");
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          addNotification("error", `Failed to load sidecar: ${e.message}`);
        }
      }
    })();
    return () => ctl.abort();
    // modelLabels in deps so we auto-refresh labels.yaml when Inspector
    // saves a port display_name (#409 sync).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, selectedKind, selectedVariant, modelLabels]);

  /**
   * Rebuild the canvas from the buffer without writing the user's file (#1029).
   *
   * The graph is produced by executing a model file, so this still writes the
   * text somewhere — to a private preview file the backend owns, never to
   * `filePath`. That is what lets the canvas keep up with your typing while an
   * external editor has the same model open.
   */
  const previewAndRefresh = useCallback(async () => {
    // Read the path from the store rather than the closure. This callback is
    // reachable from a CodeMirror extension, whose closures are only as fresh
    // as the last reconfiguration — reading current state avoids depending on
    // that.
    const filePath = useModelStore.getState().filePath;
    if (!filePath) return;
    const currentSource = sourceRef.current;
    const savedAtSend = useModelStore.getState().savedSource;
    if (currentSource === savedAtSend) return;
    if (useExternalChangeStore.getState().pending) return;

    if (previewAbortRef.current) previewAbortRef.current.abort();
    previewAbortRef.current = new AbortController();
    const { signal } = previewAbortRef.current;
    setSyncStatusWithClear("syncing");

    try {
      const resp = await fetch("/api/model/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, source: currentSource }),
        signal,
      });
      if (!resp.ok) {
        setSyncStatusWithClear("error");
        return;
      }
      const data = await resp.json();
      // A different model opened (or this one reloaded) while the preview was
      // out. Its answer describes the buffer we had then; adopting it would put
      // the old graph under the new file's source.
      const now = useModelStore.getState();
      if (now.filePath !== filePath || now.savedSource !== savedAtSend) {
        setSyncStatusWithClear("idle");
        return;
      }
      const built = applyPreviewModel(data.model, data.preview_path, currentSource);
      setSyncStatusWithClear(built ? "synced" : "error");
    } catch (e: any) {
      if (e.name === "AbortError") return; // superseded by a newer keystroke
      setSyncStatusWithClear("error");
    }
  }, [applyPreviewModel, setSyncStatusWithClear]);

  const saveAndRefresh = useCallback(async (silent = false, opts: SaveRequestOptions = {}) => {
    // Read the path from the store, not the closure. This callback is embedded
    // in the Cmd-S keymap, and an extension's closures are only as fresh as the
    // last reconfiguration; reading current state removes that dependency.
    const filePath = useModelStore.getState().filePath;
    if (!filePath) return;
    // A revert (#1349) names the text to write; it has just been put in the
    // store, and the ref follows the store only after the next render.
    if (opts.source !== undefined) sourceRef.current = opts.source;
    const currentSource = sourceRef.current;
    if (currentSource === useModelStore.getState().savedSource && silent) return;

    // A conflict prompt is open: the file on disk holds an external editor's
    // version the user has not decided about yet. The 1.5s autosave firing here
    // would write our buffer straight over it — the exact loss the prompt is
    // there to prevent (#926). An explicit Save still goes through: that is the
    // user choosing.
    if (silent && useExternalChangeStore.getState().pending) return;

    // Record the edit being saved as a step, if it isn't one yet. The save
    // itself is a mark on that step (#1349), added once the file is written.
    if (!silent) recordAction("Edited the code");

    // Stand down the preview machinery first: a queued or in-flight preview
    // must not race the write. Without this the 1.5s timer could fire mid-save
    // and (previously, via a shared controller) abort the save outright.
    if (autoRefreshTimer.current) {
      clearTimeout(autoRefreshTimer.current);
      autoRefreshTimer.current = null;
    }
    if (previewAbortRef.current) previewAbortRef.current.abort();

    // Cancel any in-flight request
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    const { setStatus, clearStatus } = useStatusStore.getState();
    if (!silent) setStatus("Saving code and re-introspecting model...");
    if (silent) setSyncStatusWithClear("syncing");
    // When the model was opened from a .pnlproject (#348), save-project writes
    // the working file AND re-zips it back into the origin bundle. Otherwise
    // save-source just writes the .py.
    const bundleOrigin = useModelStore.getState().bundleOrigin;
    const endpoint = bundleOrigin ? "/api/model/save-project" : "/api/model/save-source";
    // Send what we believe is on disk so the server can refuse to overwrite a
    // change that landed after we loaded (#926). savedSource is exactly that:
    // the text we last loaded or wrote.
    const baseSource = useModelStore.getState().savedSource;
    const body = bundleOrigin
      ? { file_path: filePath, source: currentSource, bundle_path: bundleOrigin }
      : { file_path: filePath, source: currentSource, base_source: baseSource };
    // Counted so autosave never starts a second save over this one (#1347).
    const endSave = useAutosaveStore.getState().beginSave();
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (resp.status === 409) {
        // Someone else wrote to this file after we loaded it. Hand it to the
        // same prompt an external edit raises, so the choice — keep mine, take
        // theirs — is one the user already knows (#926). Nothing was written:
        // the buffer is intact and so is the file.
        const err = await resp.json();
        if (err?.reason === "psyneulink_source_protected") {
          // Not a conflict: this PsyNeuLink file can't be edited here (#1225).
          if (!silent) addNotification("error", err.detail);
          void usePnlSourceStore.getState().refresh(filePath);
          setSyncStatusWithClear("error");
          return;
        }
        if (
          err?.reason === "model_view_only" ||
          // #1346: a protection line in the file ("# PsyNeuView: protected",
          // or "… protected permanently") refuses the same way.
          err?.reason === "model_protected" ||
          err?.reason === "model_protected_permanently"
        ) {
          // Not a conflict either: the model is locked (#1320). The editor
          // is read only while it is, so this is reached only when the lock
          // was set after typing began, or by another client; say so and
          // re-read the lock so the banner and the tag catch up.
          if (!silent) addNotification("error", err.detail);
          void useEditLockStore.getState().refresh(filePath);
          setSyncStatusWithClear("error");
          return;
        }
        const detail = err?.detail ?? {};
        if (typeof detail.disk_source === "string") {
          useExternalChangeStore.getState().setPending({
            filePath,
            source: detail.disk_source,
            model: detail.disk_model,
          });
        } else if (!silent) {
          addNotification("error", "This file changed on disk since it was opened here.");
        }
        setSyncStatusWithClear("error");
        return;
      }
      if (!resp.ok) {
        const err = await resp.json();
        if (!silent) addNotification("error", `Save failed: ${err.detail}`);
        setSyncStatusWithClear("error");
        return;
      }
      const data = await resp.json();
      // Always load model (even with errors, so error state is in the store)
      loadModelFromServer(data.model, data.layout);
      // Written: mark it in History, on the step that holds this text (#1349).
      recordSave(currentSource, {
        at: Date.now(),
        kind: opts.revertedTo !== undefined ? "revert" : opts.automatic ? "auto" : "manual",
        ...(opts.revertedTo !== undefined ? { revertedTo: opts.revertedTo } : {}),
      });
      if (data.model?.error) {
        if (!silent) addNotification("error", `Model error: ${data.model.error}`);
        setSyncStatusWithClear("error");
      } else {
        setSyncStatusWithClear("synced");
      }
      if (!silent && data.mdfWarning) {
        addNotification(
          "warning",
          `Saved to bundle, but the MDF mirror was skipped: ${data.mdfWarning}`,
        );
      }
    } catch (e: any) {
      if (e.name === "AbortError") return; // Cancelled by new keystroke, ignore
      if (!silent) {
        addNotification("error", `Save failed: ${e}`);
      }
      setSyncStatusWithClear("error");
    } finally {
      endSave();
      if (!silent) clearStatus();
    }
  }, [loadModelFromServer]);

  // Toolbar Save button triggers the editor's save (single source of save logic).
  // Autosave (#1347) sends the same request, with a detail to hear when it ends.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SaveRequestDetail | undefined>).detail;
      if (detail) detail.accepted = true;
      const opts = detail ? { automatic: detail.automatic, source: detail.source, revertedTo: detail.revertedTo } : {};
      void saveAndRefresh(false, opts).finally(() => detail?.done?.());
    };
    window.addEventListener(SAVE_EVENT, handler);
    return () => window.removeEventListener(SAVE_EVENT, handler);
  }, [saveAndRefresh]);

  // Ctrl+S / Cmd+S keybinding
  // Save is registered as a command rather than bound here (#1112). The
  // shortcut registry owns Mod+S now, so there is one place that knows which
  // key saves and one place that knows how — and Settings can show it.
  useEffect(
    () => registerCommand("model.save", saveAndRefresh),
    [saveAndRefresh]
  );

  // Highlight (not select) the canvas element whose declaration block contains
  // the editor cursor. Highlight is independent of Inspector selection so the
  // user keeps their inspected node while scanning the source.
  const cursorNodeHighlight = useCallback(
    () =>
      EditorView.updateListener.of((update) => {
        // Only react to user cursor movements, not programmatic source changes
        if (!update.selectionSet || update.docChanged) return;
        const cursorPos = update.state.selection.main.head;
        const cursorLineObj = update.state.doc.lineAt(cursorPos);
        const cursorLine = cursorLineObj.number;
        const colInLine = cursorPos - cursorLineObj.from;
        const identAtCursor = extractIdentifierAt(cursorLineObj.text, colInLine);

        if (cursorSelectTimer.current) clearTimeout(cursorSelectTimer.current);
        cursorSelectTimer.current = setTimeout(() => {
          const { nodes: currentNodes, edges: currentEdges, lineMap: currentLineMap, source: currentSource } =
            useModelStore.getState();
          let bestId: string | null = null;
          let bestType: "node" | "edge" = "node";
          let bestStart = 0;
          let pinned = false;

          // Token-under-cursor wins over the enclosing block, so pointing
          // at `colors_input` inside `sender=colors_input` highlights the
          // colors_input node rather than the surrounding MappingProjection.
          if (identAtCursor && currentLineMap[identAtCursor]) {
            const targetNode = currentNodes.find(
              (n) => (n.data as any)?.varName === identAtCursor
            );
            if (targetNode) {
              bestId = targetNode.id;
              bestType = "node";
              pinned = true;
            } else {
              const targetEdge = currentEdges.find(
                (e) => (e.data as any)?.varName === identAtCursor
              );
              if (targetEdge) {
                bestId = targetEdge.id;
                bestType = "edge";
                pinned = true;
              }
            }
          }

          // Enclosing-block fallback: cursor sits inside foo's declaration
          // but not on any known identifier (whitespace, commas, kwargs).
          if (!pinned) {
            for (const node of currentNodes) {
              const varName = (node.data as any)?.varName;
              if (!varName || !currentLineMap[varName]) continue;
              const startLine = currentLineMap[varName];
              const endLine = findDeclEndLine(currentSource, startLine);
              if (cursorLine >= startLine && cursorLine <= endLine && startLine > bestStart) {
                bestId = node.id;
                bestType = "node";
                bestStart = startLine;
              }
            }

            for (const edge of currentEdges) {
              const varName = (edge.data as any)?.varName;
              if (!varName || !currentLineMap[varName]) continue;
              const startLine = currentLineMap[varName];
              const endLine = findDeclEndLine(currentSource, startLine);
              if (cursorLine >= startLine && cursorLine <= endLine && startLine > bestStart) {
                bestId = edge.id;
                bestType = "edge";
                bestStart = startLine;
              }
            }
          }

          const store = useModelStore.getState();
          if (bestId && bestType === "node") {
            if (bestId !== store.cursorHighlightedNodeId) {
              store.setCursorHighlightedNodeId(bestId);
            }
          } else if (bestId && bestType === "edge") {
            if (bestId !== store.cursorHighlightedEdgeId) {
              store.setCursorHighlightedEdgeId(bestId);
            }
          } else {
            // Cursor is outside every known declaration block — clear the highlight
            if (store.cursorHighlightedNodeId || store.cursorHighlightedEdgeId) {
              store.setCursorHighlightedNodeId(null);
            }
          }
        }, 150);
      }),
    []
  );

  // Extensions: stable reference so CodeMirror doesn't re-init
  const cursorTracker = useCallback(
    () => EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        setCursorInfo({ line: line.number, col: pos - line.from + 1 });
      }
    }),
    []
  );

  // Block file drops in CodeMirror — forward to app-level import handler instead
  const blockFileDrop = useMemo(
    () => EditorView.domEventHandlers({
      drop(event) {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          // Prevent CodeMirror from inserting file contents as text
          event.preventDefault();
          event.stopPropagation();
          // Dispatch a custom event so App.tsx can handle the file import
          const customEvent = new CustomEvent("psynewview:file-drop", {
            detail: { files: Array.from(files) },
          });
          window.dispatchEvent(customEvent);
          return true; // handled
        }
        return false;
      },
    }),
    []
  );

  // Lint diagnostics from model errors
  const pnlLinter = useMemo(() => linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const { modelError, modelErrorLine } = useModelStore.getState();
    if (modelError && modelErrorLine && modelErrorLine >= 1 && modelErrorLine <= view.state.doc.lines) {
      const line = view.state.doc.line(modelErrorLine);
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "error",
        message: modelError,
      });
    }
    return diagnostics;
  }, { delay: 500 }), []);

  const pnlCompletion = useMemo(() => autocompletion({
    override: [(ctx: CompletionContext) => {
      // Trigger after "pnl."
      const word = ctx.matchBefore(/pnl\.\w*/);
      if (!word) return null;
      const prefix = word.text.slice(4); // after "pnl."
      const items = PNL_COMPLETIONS.filter((c) =>
        c.label.toLowerCase().startsWith(prefix.toLowerCase())
      );
      if (items.length === 0) return null;
      return { from: word.from + 4, options: items };
    }],
  }), []);

  // #503: theme extension that pins the editor font size. Rebuilt only when
  // the zoom changes so CodeMirror reconfigures just the font.
  const fontThemeExt = useMemo(
    () => EditorView.theme({ "&": { fontSize: `${editorFontPx}px` } }),
    [editorFontPx],
  );
  const editorZoomBtnStyle: CSSProperties = {
    fontSize: 11,
    padding: "1px 5px",
    border: "1px solid var(--pnv-border)",
    borderRadius: 3,
    background: "var(--pnv-surface-sunken)",
    cursor: "pointer",
    color: "var(--pnv-text-secondary)",
  };
  // #630: borderless buttons inside the compact −A+ group (the group itself
  // carries the border, so the two buttons read as one control).
  const editorZoomCompactBtnStyle: CSSProperties = {
    fontSize: 12,
    lineHeight: 1,
    padding: "1px 5px",
    border: "none",
    background: "var(--pnv-surface-sunken)",
    cursor: "pointer",
    color: "var(--pnv-text-secondary)",
  };

  const extensions = useMemo(
    () => [python(), EditorView.lineWrapping, cursorNodeHighlight(), cursorTracker(), pnlCompletion, pnlLinter, blockFileDrop, highlightField, activeParamField, errorLineField, fontThemeExt],
    [cursorNodeHighlight, cursorTracker, pnlCompletion, pnlLinter, blockFileDrop, fontThemeExt]
  );

  // ─── On node/edge selection change: highlight code block, scroll ──

  const prevSelectionKey = useRef<string | null>(null);

  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;

    // Determine which item is selected (node or edge)
    let varName: string | null = null;
    let selectionKey: string | null = null;

    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      varName = node ? (node.data as any)?.varName : null;
      selectionKey = `node:${selectedNodeId}`;
    } else if (selectedEdgeId) {
      const edge = edges.find((e) => e.id === selectedEdgeId);
      if (edge && (edge.data as any)?.gscType) {
        // GSC edge: find the scheduler.add_condition line in source
        const gscOwner = (edge.data as any)?.owner;
        const gscType = (edge.data as any)?.gscType;
        if (gscOwner && gscType) {
          const sourceLines = source.split("\n");
          const pattern = new RegExp(
            `\\.scheduler\\.add_condition\\(\\s*${gscOwner}\\b.*\\b${gscType}\\b`
          );
          for (let i = 0; i < sourceLines.length; i++) {
            if (pattern.test(sourceLines[i])) {
              const lineNum = i + 1;
              const changed = `gsc:${selectedEdgeId}` !== prevSelectionKey.current;
              prevSelectionKey.current = `gsc:${selectedEdgeId}`;
              view.dispatch({
                effects: setHighlightRange.of({ from: lineNum, to: lineNum }),
              });
              if (changed) {
                useModelStore.getState().setActiveParamLine(null);
                const lineObj = view.state.doc.line(Math.min(lineNum, view.state.doc.lines));
                view.dispatch({
                  effects: EditorView.scrollIntoView(lineObj.from, { y: "center" }),
                });
              }
              return;
            }
          }
        }
        // GSC line not found in source — clear highlight
        view.dispatch({ effects: setHighlightRange.of(null) });
        return;
      }
      varName = edge ? (edge.data as any)?.varName : null;
      selectionKey = `edge:${selectedEdgeId}`;
    }

    if (!varName) {
      view.dispatch({ effects: setHighlightRange.of(null) });
      useModelStore.getState().setActiveParamLine(null);
      prevSelectionKey.current = null;
      return;
    }

    const changed = selectionKey !== prevSelectionKey.current;
    prevSelectionKey.current = selectionKey;

    if (changed) {
      useModelStore.getState().setActiveParamLine(null);
    }

    const startLine = lineMap[varName];
    if (!startLine) {
      view.dispatch({ effects: setHighlightRange.of(null) });
      return;
    }

    const endLine = findDeclEndLine(source, startLine);
    view.dispatch({
      effects: setHighlightRange.of({ from: startLine, to: endLine }),
    });

    if (changed) {
      const lineObj = view.state.doc.line(Math.min(startLine, view.state.doc.lines));
      view.dispatch({
        effects: EditorView.scrollIntoView(lineObj.from, { y: "center" }),
      });
    }
  }, [selectedNodeId, selectedEdgeId, nodes, edges, lineMap, source]);

  // ─── Scroll to specific line (from Inspector param clicks) ─────

  useEffect(() => {
    if (cursorTargetLine == null) return;
    const view = editorRef.current?.view;
    if (!view) return;

    const lineNum = Math.min(cursorTargetLine, view.state.doc.lines);
    const line = view.state.doc.line(lineNum);

    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });

    setCursorTargetLine(null);
  }, [cursorTargetLine, setCursorTargetLine]);

  // ─── Blue param line highlight (synced with Inspector focus) ───

  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;

    view.dispatch({
      effects: setActiveParamLine.of(storeActiveParamLine),
    });
  }, [storeActiveParamLine]);

  // ─── Red error line highlight (synced with model error) ───

  const modelErrorLine = useModelStore((s) => s.modelErrorLine);
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    view.dispatch({
      effects: setErrorLine.of(modelErrorLine),
    });
    // Auto-scroll to error line
    if (modelErrorLine && modelErrorLine >= 1 && modelErrorLine <= view.state.doc.lines) {
      const lineObj = view.state.doc.line(modelErrorLine);
      view.dispatch({
        selection: { anchor: lineObj.from },
        scrollIntoView: true,
      });
    }
  }, [modelErrorLine]);

  // #1103: take the user to the error when they ask, not only when the error
  // first appears. The effect above fires on modelErrorLine changing, so once
  // someone scrolls away — or anything else moves the cursor — there was no way
  // back except hunting for the line by hand. A user's banner said line 241
  // while their editor sat at 203, in a 514-line file.
  const errorRevealNonce = useModelStore((s) => s.errorRevealNonce);
  useEffect(() => {
    if (!errorRevealNonce) return; // 0 is "never asked", not a request
    const view = editorRef.current?.view;
    if (!view || !modelErrorLine) return;
    if (modelErrorLine < 1 || modelErrorLine > view.state.doc.lines) return;
    const lineObj = view.state.doc.line(modelErrorLine);
    view.dispatch({
      selection: { anchor: lineObj.from, head: lineObj.to },
      scrollIntoView: true,
    });
    view.focus();
  }, [errorRevealNonce, modelErrorLine]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        ref={headerRef}
        style={{
          padding: "4px 12px",
          background: "var(--pnv-surface-sunken)",
          borderBottom: "1px solid var(--pnv-border-faint)",
          fontSize: 11,
          color: "var(--pnv-text-hint)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span ref={headerLeftRef} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          {/* #407: bundle picker. When the model has sidecars next to its
              .py (labels.yaml, pnlview.json), show a dropdown so the user
              can switch the editor to those files. #504 Phase A: the source
              entry is labeled with the .py basename. #504 Phase B: source +
              sidecars are grouped as one bundle, sidecars tagged with their
              role, and a "+N files" cue shows the bundle size at a glance. */}
          {bundle.length > 1 ? (
            <>
              <select
                value={selectedBundleKind}
                onChange={(e) => setSelectedBundleKind(e.target.value)}
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  padding: "2px 4px",
                  border: "1px solid var(--pnv-border)",
                  borderRadius: 3,
                  background: "var(--pnv-surface)",
                  color: "var(--pnv-text-body)",
                  cursor: "pointer",
                }}
                title={filePath ? `Editing ${filePath} and its ${bundle.length - 1} associated file(s)` : "Switch between the model source and its sidecar files"}
              >
                <optgroup label="Source">
                  {bundle.filter((b) => b.kind === "source").map((b) => (
                    <option key={bundleEntryId(b)} value={bundleEntryId(b)}>{sourceName}</option>
                  ))}
                </optgroup>
                <optgroup label="Associated files">
                  {bundle.filter((b) => b.kind !== "source").map((b) => (
                    <option key={bundleEntryId(b)} value={bundleEntryId(b)}>
                      {b.name} — {sidecarRole(b.kind)}
                      {b.variant && b.variant !== "Default" ? ` · ${b.variant}` : ""}
                    </option>
                  ))}
                </optgroup>
              </select>
              <span
                style={{ color: "var(--pnv-text-faint)", fontSize: 10 }}
                title={`This model is one .py source plus ${bundle.length - 1} associated sidecar file(s)`}
              >
                +{bundle.length - 1} file{bundle.length - 1 === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <span title={filePath || undefined} style={{ fontFamily: filePath ? "monospace" : undefined }}>
              {sourceName}
            </span>
          )}
          {/* #483: named layout / settings-profile variant pickers. Each
              shows the active variant and offers switch + add / duplicate /
              rename / delete / reorder. Hidden until a model is loaded. */}
          {filePath && !headerCompact && (
            <>
              <SidecarVariantPicker kind="layout" />
              <SidecarVariantPicker kind="settings" />
              {/* #933: where those sidecar files live on disk — a separate
                  model-level axis from the variant pickers above. */}
              <SidecarPlacementPicker />
            </>
          )}
          {isSourceView && source !== savedSource && filePath && (
            <span style={{ color: "var(--pnv-unsaved)", fontSize: 16, lineHeight: 1 }} title="Unsaved changes">*</span>
          )}
          {!isSourceView && sidecarContent !== null && sidecarContent !== sidecarSavedContent && (
            <span style={{ color: "var(--pnv-unsaved)", fontSize: 16, lineHeight: 1 }} title="Unsaved changes">*</span>
          )}
          {filePath && isSourceView && (
            <span style={{ color: "var(--pnv-text-faint)", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap" }}>
              {headerCompact
                ? `L${cursorInfo.line}·C${cursorInfo.col}${source ? ` · ${source.split("\n").length}L` : ""}`
                : `Ln ${cursorInfo.line}, Col ${cursorInfo.col}${source ? ` / ${source.split("\n").length} lines` : ""}`}
            </span>
          )}
          {filePath && !isSourceView && sidecarContent !== null && (
            <span style={{ color: "var(--pnv-text-faint)", fontFamily: "monospace", fontSize: 10, whiteSpace: "nowrap" }}>
              {sidecarContent.split("\n").length}{headerCompact ? "L" : " lines · editable"}
            </span>
          )}
        </span>
        <span>
          {filePath ? (
            <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {/* #503: editor font-size control. Mirrors the Inspector's
                  A-/A+ pair; scales both the source and sidecar editors.
                  #630: at narrow widths the pair collapses into a single
                  bordered −A+ group so the right cluster stops clipping. */}
              {headerCompact ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    border: "1px solid var(--pnv-border)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                  title="Editor font size"
                >
                  <button onClick={editorZoomOut} style={editorZoomCompactBtnStyle} title="Decrease editor font size">−</button>
                  <span style={{ fontSize: 11, color: "var(--pnv-text-secondary)", padding: "0 1px" }}>A</span>
                  <button onClick={editorZoomIn} style={editorZoomCompactBtnStyle} title="Increase editor font size">+</button>
                </span>
              ) : (
                <span style={{ display: "flex", gap: 2, alignItems: "center" }} title="Editor font size">
                  <button
                    onClick={editorZoomOut}
                    style={editorZoomBtnStyle}
                    title="Decrease editor font size"
                  >
                    A-
                  </button>
                  <button
                    onClick={editorZoomIn}
                    style={editorZoomBtnStyle}
                    title="Increase editor font size"
                  >
                    A+
                  </button>
                </span>
              )}
              <SnippetDropdown editorRef={editorRef} compact={headerCompact} />
              {syncStatus !== "idle" && (
                <span style={{
                  fontSize: 10,
                  color: syncStatus === "syncing" ? "var(--pnv-primary)" : syncStatus === "synced" ? "var(--pnv-success)" : "var(--pnv-danger)",
                  marginLeft: 4,
                }}>
                  {syncStatus === "syncing" ? "syncing..." : syncStatus === "synced" ? "synced" : "sync error"}
                </span>
              )}
            </span>
          ) : (
            "No file loaded"
          )}
        </span>
        </div>
        {/* #630: when narrow, the sidecar pickers drop to a second row as a
            unit (instead of clipping the top row), and snap back inline when
            there's room. #1211: the placement picker comes too — it used to be
            left out, so in compact mode it vanished entirely. The row wraps:
            with a long placement label (`.psyneuview/ (default)`) the three
            pickers don't fit a 450px pane, and a picker running off the pane's
            edge is clipped by the divider, which is the overflow this row
            exists to avoid. */}
        {headerCompact && filePath && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "center" }}>
            <SidecarVariantPicker kind="layout" />
            <SidecarVariantPicker kind="settings" />
            <SidecarPlacementPicker />
          </div>
        )}
      </div>
      <ModelErrorBanner />
      {isSourceView && <PnlProtectedBanner />}
      {isSourceView && !pnlProtected && <ViewOnlyBanner />}
      <div style={{ flex: 1, overflow: "auto" }}>
        {isSourceView ? (
          <CodeMirror
            ref={editorRef}
            value={source}
            height="100%"
            extensions={extensions}
            readOnly={pnlProtected || viewOnly}
            onChange={(value, viewUpdate) => {
              setSource(value);
              // Only auto-refresh on user-initiated edits (typing), not programmatic updates
              const isUserEdit = viewUpdate.transactions.some(
                (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move")
              );
              if (isUserEdit) {
                if (autoRefreshTimer.current) clearTimeout(autoRefreshTimer.current);
                setSyncStatus("idle");
                // #1029: preview, don't save. Typing must not write a file an
                // external editor has open; ⌘S is what writes.
                autoRefreshTimer.current = setTimeout(() => previewAndRefresh(), 1500);
              }
            }}
            theme="light"
            style={{ height: "100%" }}
          />
        ) : (
          /* #408 / #410: sidecar view. CodeMirror without the python
             extension renders as plain monospace text with line numbers
             and CodeMirror's standard editing affordances. Direct
             editing saves back via /api/model/save-sidecar with a
             short debounce. */
          <SidecarEditor
            filePath={filePath}
            kind={selectedKind}
            variant={selectedVariant}
            content={sidecarContent ?? ""}
            fontPx={editorFontPx}
            onContentChange={(v) => setSidecarContent(v)}
            onSaved={(v) => setSidecarSavedContent(v)}
          />
        )}
      </div>
    </div>
  );
}

// #409: brief background flash on the line the Inspector just jumped to.
// `flashLineEffect.of(N)` sets the decoration; the caller schedules a
// follow-up `clearFlashEffect` dispatch via setTimeout. Keeping clear
// separate (rather than auto-clearing inside the StateField) avoids
// touching `view` from within update() and makes the timeout cancelable.
const FLASH_DURATION_MS = 1200;
const flashLineEffect = StateEffect.define<number | null>();
const clearFlashEffect = StateEffect.define<null>();
const flashLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLineEffect) && e.value !== null) {
        const line = tr.state.doc.line(e.value);
        next = Decoration.set([
          Decoration.line({ attributes: { class: "psynewview-yaml-flash" } }).range(line.from),
        ]);
      } else if (e.is(clearFlashEffect)) {
        next = Decoration.none;
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// #408 / #410: minimal CodeMirror-backed editor for YAML/JSON sidecars.
// Reuses CodeMirror with no language extension (plain monospace) so we
// avoid bundling additional language packages for v1. On user edit it
// debounces a POST to /api/model/save-sidecar; on success it updates
// `sidecarSavedContent` so the dirty indicator clears.
function SidecarEditor({
  filePath,
  kind,
  variant,
  content,
  fontPx,
  onContentChange,
  onSaved,
}: {
  filePath: string | null;
  kind: string;
  variant?: string;
  content: string;
  fontPx: number;
  onContentChange: (v: string) => void;
  onSaved: (v: string) => void;
}) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setModelLabels = useModelStore((s) => s.setModelLabels);
  const sidecarEditorRef = useRef<ReactCodeMirrorRef>(null);

  // #409: line-mapping for the current YAML content, recomputed only when
  // content changes. Used by both sync directions — cursor watcher
  // (editor → Inspector) and scroll-intent (Inspector → editor).
  const yamlMappings = useMemo(
    () => (kind === "labels" ? parseYamlMapping(content) : []),
    [kind, content],
  );

  // editor → Inspector: report the (node, port) under the cursor.
  const setYamlCursorContext = useModelStore((s) => s.setYamlCursorContext);
  const cursorListenerExt = useMemo(() => {
    if (kind !== "labels") return [];
    return [
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const head = update.state.selection.main.head;
        const lineNum = update.state.doc.lineAt(head).number;
        const entry = findEntryAtLine(yamlMappings, lineNum);
        setYamlCursorContext(
          entry ? { node: entry.node, port: entry.port, kind: entry.kind } : null,
        );
      }),
    ];
  }, [kind, yamlMappings, setYamlCursorContext]);

  // Clear cursor context on unmount or when leaving the labels view —
  // otherwise the Inspector keeps highlighting a row whose source
  // location is no longer visible to the user.
  useEffect(() => {
    return () => setYamlCursorContext(null);
  }, [setYamlCursorContext]);

  // Inspector → editor: scroll to + briefly flash the line for a
  // requested (node, port) whenever yamlScrollIntent updates. Cleared
  // after handling so a re-emit of the same intent (e.g. user edits the
  // same port twice) re-triggers the flash.
  const yamlScrollIntent = useModelStore((s) => s.yamlScrollIntent);
  const setYamlScrollIntent = useModelStore((s) => s.setYamlScrollIntent);
  useEffect(() => {
    if (kind !== "labels" || !yamlScrollIntent) return;
    const view = sidecarEditorRef.current?.view;
    if (!view) return;
    const line = findLineFor(
      yamlMappings,
      yamlScrollIntent.node,
      yamlScrollIntent.port,
      yamlScrollIntent.kind,
    );
    if (line === null || line < 1 || line > view.state.doc.lines) {
      // Line not found (port hasn't been written to YAML yet, etc.) —
      // just clear the intent so a later refetch can retry.
      setYamlScrollIntent(null);
      return;
    }
    const lineObj = view.state.doc.line(line);
    view.dispatch({
      effects: [
        EditorView.scrollIntoView(lineObj.from, { y: "center" }),
        flashLineEffect.of(line),
      ],
      selection: { anchor: lineObj.from },
    });
    // Two timers: one to clear the visual flash on the editor side,
    // one to clear the store intent so the same target can be flashed
    // again later.
    const flashTimer = setTimeout(() => {
      view.dispatch({ effects: clearFlashEffect.of(null) });
    }, FLASH_DURATION_MS);
    const intentTimer = setTimeout(() => setYamlScrollIntent(null), 50);
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(intentTimer);
    };
  }, [kind, yamlScrollIntent, yamlMappings, setYamlScrollIntent]);

  const save = useCallback(
    async (v: string) => {
      if (!filePath) return;
      try {
        const resp = await fetch("/api/model/save-sidecar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_path: filePath, kind, variant, content: v }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          addNotification("error", `Sidecar save failed: ${err.detail ?? resp.statusText}`);
          return;
        }
        const data = await resp.json();
        // For the labels kind, refresh the resolver-facing dict in the
        // store so the pill / Run State / Inspector pick up the change.
        if (kind === "labels" && "labels" in data) {
          setModelLabels(data.labels ?? null);
        }
        onSaved(v);
      } catch (e: any) {
        addNotification("error", `Sidecar save failed: ${e.message}`);
      }
    },
    [filePath, kind, variant, addNotification, setModelLabels, onSaved],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // #409: combined extensions for the labels view. Empty for non-labels
  // sidecars so we don't pay the cursor-tracking cost for layout JSON.
  // #503: theme extension pinning the sidecar font size, mirroring the
  // source editor so both views scale together.
  const fontThemeExt = useMemo(
    () => EditorView.theme({ "&": { fontSize: `${fontPx}px` } }),
    [fontPx],
  );
  const extensions = useMemo(
    () => (kind === "labels" ? [flashLineField, ...cursorListenerExt, fontThemeExt] : [fontThemeExt]),
    [kind, cursorListenerExt, fontThemeExt],
  );

  return (
    <CodeMirror
      ref={sidecarEditorRef}
      value={content}
      height="100%"
      extensions={extensions}
      onChange={(v) => {
        onContentChange(v);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => save(v), 800);
      }}
      theme="light"
      style={{ height: "100%" }}
    />
  );
}

const CODE_SNIPPETS = [
  {
    label: "Transfer Mechanism",
    code: `my_mech = pnl.TransferMechanism(\n    input_shapes=[1],\n    function=pnl.Linear(),\n    name='my_mech'\n)\n`,
  },
  {
    label: "Recurrent Mechanism",
    code: `my_recurrent = pnl.RecurrentTransferMechanism(\n    input_shapes=[2],\n    function=pnl.Logistic(),\n    name='my_recurrent'\n)\n`,
  },
  {
    label: "DDM",
    code: `my_ddm = pnl.DDM(\n    name='my_ddm'\n)\n`,
  },
  {
    label: "Projection",
    code: `my_proj = pnl.MappingProjection(\n    sender=sender_mech,\n    receiver=receiver_mech,\n    name='my_proj'\n)\n`,
  },
  {
    label: "Composition",
    code: `my_comp = pnl.Composition(name='my_comp')\nmy_comp.add_node(my_mech)\n`,
  },
  {
    label: "Linear Pathway",
    code: `my_comp.add_linear_processing_pathway(\n    pathway=[input_mech, hidden_mech, output_mech]\n)\n`,
  },
  {
    label: "Learning Pathway",
    code: `my_comp.add_backpropagation_learning_pathway(\n    pathway=[input_mech, hidden_mech, output_mech]\n)\n`,
  },
  {
    label: "Scheduling Condition",
    code: `my_comp.scheduler.add_condition(\n    my_mech,\n    pnl.EveryNCalls(other_mech, 2)\n)\n`,
  },
  {
    label: "Logistic Function",
    code: `function=pnl.Logistic(gain=1.0, bias=0.0)`,
  },
];

function SnippetDropdown({ editorRef, compact = false }: { editorRef: React.RefObject<ReactCodeMirrorRef | null>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Closes like every other menu (#1289): Escape through the shared stack,
  // and a click anywhere else.
  useDismiss(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        data-testid="snippet-menu-button"
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 11,
          padding: compact ? "2px 6px" : "2px 8px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 3,
          background: "var(--pnv-surface)",
          color: "var(--pnv-text-secondary)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        title="Insert a code snippet at the cursor position"
      >
        {compact ? "+" : "+ Snippet"}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="snippet-menu"
          style={{
            position: "absolute",
            top: "100%",
            // Anchor to the button's right edge so the menu opens leftward into
            // the editor pane; the button sits at the toolbar's right end, so a
            // left-anchored menu overflowed under the graph panel (#473).
            right: 0,
            marginTop: 2,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            zIndex: 1000,
            minWidth: 160,
            padding: "4px 0",
          }}
        >
          {CODE_SNIPPETS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                const view = editorRef.current?.view;
                if (view) {
                  const cursor = view.state.selection.main.head;
                  view.dispatch({
                    changes: { from: cursor, insert: s.code },
                    selection: { anchor: cursor + s.code.length },
                  });
                  view.focus();
                  // The unified undo system (useUndoRedo) routes Cmd+Z to the
                  // history-store snapshots and disables CodeMirror's native
                  // undo, so the insert is only undoable if we record it here
                  // (the dispatch's onChange has already synced store.source).
                  recordAction(`Inserted snippet: ${s.label}`);
                }
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "5px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--pnv-text-body)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-primary-tint)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Why the open file can't be edited, at the top of the file (#1305).
 *
 * A protected PsyNeuLink file used to look merely read-only: the only
 * explanation was a small toolbar badge. The editor itself now says why, with
 * the way out: for a PsyNeuLink that PsyNeuView manages, your own checkout,
 * chosen in Settings ▸ Developer; for your own checkout you protected, the
 * toolbar badge allows edits again.
 *
 * A model locked inside a checkout you then protected (#1346) is read only for
 * the checkout first; the banner says the lock is there too, so allowing edits
 * to the checkout and still finding the model read only isn't a surprise.
 */
function PnlProtectedBanner() {
  const status = usePnlSourceStore((s) => s.status);
  const locked = useEditLockStore((s) => s.mode === "viewOnly");
  const rule = useEditLockStore((s) => s.rule);
  if (!isProtected(status) || !status?.message) return null;
  // What stays read only after allowing edits to the checkout (#1346).
  const modelNote =
    rule === "protectedPermanently"
      ? " This model's file also says \"# PsyNeuView: protected permanently\", so it stays read only after allowing edits; only removing that line outside PsyNeuView changes it."
      : rule === "protected"
        ? " This model's file also says \"# PsyNeuView: protected\": after allowing edits, unlock it too with Layout ▸ Unlock this model."
        : " This model is also locked (view only): after allowing edits, unlock it too with Layout ▸ Unlock this model.";

  const managed = status.kind !== "local";
  return (
    <div
      data-testid="pnl-protected-banner"
      role="note"
      style={{
        padding: "6px 12px",
        background: "var(--pnv-warning-tint)",
        borderBottom: "2px solid var(--pnv-warning-tag-border)",
        fontSize: 12,
        color: "var(--pnv-warning-tag-text)",
        display: "flex",
        gap: 8,
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
    >
      <span>
        {status.message}
        {!managed && locked && modelNote}
      </span>
      {managed && (
        <Button kind="link" onClick={() => openSettings("developer")} style={{ whiteSpace: "nowrap" }}>
          Open Settings ▸ Developer
        </Button>
      )}
    </div>
  );
}

/**
 * The model is locked view only, so the code can't be edited either (#1320).
 *
 * Same shape as the protected-file banner, since it answers the same
 * question ("why can't I type?"), and names both ways out: the "view only"
 * tag in the toolbar and Layout ▸ Unlock this model. The button here is a
 * third, for whoever is already looking at the code. Not shown for a
 * protected PsyNeuLink file: that banner already covers it, and the lock
 * items are hidden there too.
 */
function ViewOnlyBanner() {
  const viewOnly = useEditLockStore((s) => s.mode === "viewOnly");
  // Which rule (#1346): the protection line in the file, or the lock.
  const rule = useEditLockStore((s) => s.rule);
  // Inside your own editable checkout the lock covers this model only (#1346).
  const inCheckout = usePnlSourceStore((s) => isOwnCheckout(s.status));
  const setMode = useEditLockStore((s) => s.setMode);
  const addNotification = useNotificationStore((s) => s.addNotification);
  if (!viewOnly) return null;

  const unlock = async () => {
    if (!(await setMode("editable"))) addNotification("error", "Couldn't unlock this model.");
  };

  // "# PsyNeuView: protected permanently": no unlock here, so the way out the
  // banner offers is a copy, and it says how the file itself can change.
  const permanent = rule === "protectedPermanently";

  return (
    <div
      data-testid="view-only-banner"
      data-rule={rule ?? "lock"}
      role="note"
      style={{
        padding: "6px 12px",
        background: "var(--pnv-warning-tint)",
        borderBottom: "2px solid var(--pnv-warning-tag-border)",
        fontSize: 12,
        color: "var(--pnv-warning-tag-text)",
        display: "flex",
        gap: 8,
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
    >
      <span>
        {permanent ? (
          <>
            This model&rsquo;s file says &ldquo;# PsyNeuView: protected permanently&rdquo;, so PsyNeuView won&rsquo;t
            change it and offers no unlock. To work on it, save a copy (the copy starts unprotected). To make this
            file editable, remove that line in another editor or with git.
          </>
        ) : rule === "protected" ? (
          <>
            This model&rsquo;s file says &ldquo;# PsyNeuView: protected&rdquo;, so it opens view only. Click the
            &lsquo;view only&rsquo; tag or use Layout ▸ Unlock this model to edit it; the unlock is remembered on this
            computer and the line stays in the file.
          </>
        ) : (
          <>This model is view only. Click the &lsquo;view only&rsquo; tag or use Layout ▸ Unlock this model to edit it.</>
        )}
        {inCheckout && !permanent && " The other files in your PsyNeuLink checkout stay editable."}
      </span>
      {permanent ? (
        <Button kind="link" data-testid="view-only-banner-save-copy" onClick={requestSaveCopy} style={{ whiteSpace: "nowrap" }}>
          Save a copy as…
        </Button>
      ) : (
        <Button kind="link" data-testid="view-only-banner-unlock" onClick={() => void unlock()} style={{ whiteSpace: "nowrap" }}>
          Unlock this model
        </Button>
      )}
    </div>
  );
}

function ModelErrorBanner() {
  const modelError = useModelStore((s) => s.modelError);
  const modelErrorLine = useModelStore((s) => s.modelErrorLine);
  const partialExecution = useModelStore((s) => s.partialExecution);
  const revealModelError = useModelStore((s) => s.revealModelError);

  if (!modelError) return null;

  // #1103: with a line to go to, the banner is a control, not a caption.
  // A user was told the error was on line 241 while looking at line 203 of a
  // 514-line file, with no way to get there.
  const canJump = Boolean(modelErrorLine);

  return (
    <div
      onClick={canJump ? revealModelError : undefined}
      onKeyDown={
        canJump
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                revealModelError();
              }
            }
          : undefined
      }
      role={canJump ? "button" : undefined}
      tabIndex={canJump ? 0 : undefined}
      title={canJump ? `Go to line ${modelErrorLine}` : undefined}
      style={{
        padding: "6px 12px",
        background: partialExecution ? "var(--pnv-warning-tint)" : "var(--pnv-danger-tint)",
        borderBottom: `2px solid ${partialExecution ? "var(--pnv-warning-tag-border)" : "var(--pnv-danger)"}`,
        fontSize: 12,
        color: partialExecution ? "var(--pnv-warning-tag-text)" : "var(--pnv-danger)",
        display: "flex",
        gap: 8,
        alignItems: "center",
        cursor: canJump ? "pointer" : undefined,
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {partialExecution ? "Partial execution" : "Error"}
        {modelErrorLine ? ` (line ${modelErrorLine})` : ""}:
      </span>
      <span>{modelError}</span>
      {canJump && (
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}>
          Go to line {modelErrorLine} →
        </span>
      )}
    </div>
  );
}
