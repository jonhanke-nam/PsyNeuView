/**
 * Diagnostic panel — shows a summary of what the GUI found in the loaded file.
 * Displays counts, editability status, and warnings.
 * Collapsible, shown after file load.
 */

import { useState, useEffect } from "react";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useLoadTimingStore } from "@/stores/loadTimingStore";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";
import { SyncIndicator } from "./SyncIndicator";

/** Format a load-time total (ms) as seconds: "2.3s" (1 decimal under 10s). */
function fmtLoadSeconds(ms: number): string {
  const sec = ms / 1000;
  return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
}

// Provenance of a vendored model file (#835): which upstream repo/file/commit
// it was vendored from, plus a GitHub permalink. null for user files / raw
// scripts. Shape mirrors backend app/services/lineage.py parse_lineage().
export interface LineageInfo {
  repo: string;
  sourcePath: string | null;
  commit: string | null;
  commitTag: string | null;
  vendoredDate: string | null;
  refs: string[];
  url: string | null;
}

interface Diagnostics {
  mechanismCount: number;
  projectionCount: number;
  compositionCount: number;
  editableVars: string[];
  readOnlyVars: string[];
  generatedVars?: string[];
  importStyle: string;
  isStandardized: boolean;
  pnlVersion: string;
  lineage?: LineageInfo | null;
  warnings: string[];
  notices?: string[];
}

export function DiagnosticPanel() {
  const diagnostics = useModelStore((s) => s.diagnostics) as Diagnostics | null;
  const filePath = useModelStore((s) => s.filePath);
  const source = useModelStore((s) => s.source);
  const starImportConverted = useModelStore((s) => s.starImportConverted);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const compositionNames = useModelStore((s) => s.compositionNames);
  const compositionDisplayNames = useModelStore((s) => s.compositionDisplayNames);
  const [collapsed, setCollapsed] = useState(true);
  const [showTiming, setShowTiming] = useState(false);
  const loadTiming = useLoadTimingStore((s) => s.last);
  // #515: show the composition's canonical display label (name= attribute),
  // not its Python variable name, matching the selector and breadcrumb.
  const compKey = activeComposition || compositionNames[0];
  const compLabel = (compKey && compositionDisplayNames[compKey]) || compKey || "Model";

  if (!filePath || !diagnostics) return null;

  // Notices are informational (e.g. function-scoped nodes are editable but
  // can't be Converted). They render calm/blue and must NOT flip the panel to
  // the yellow "issues" state — that wrongly reads as an error (#423 follow-up).
  const notices = diagnostics.notices ?? [];
  const hasIssues = diagnostics.warnings.length > 0 || diagnostics.readOnlyVars.length > 0;

  if (collapsed) {
    return (
      <div
        className="diagnostics-collapsed-bar"
        onClick={() => setCollapsed(false)}
        style={{
          padding: "3px 12px",
          background: hasIssues ? "var(--pnv-warning-tint)" : "var(--pnv-success-tint)",
          borderBottom: `1px solid ${hasIssues ? "var(--pnv-warning-border)" : "var(--pnv-success-border)"}`,
          fontSize: "var(--pnv-fs-11)",
          color: "var(--pnv-text-muted)",
          cursor: "pointer",
          display: "flex",
          gap: 8,
        }}
      >
        <span>
          {compLabel}: {diagnostics.mechanismCount} mechanisms, {diagnostics.projectionCount} projections
        </span>
        {loadTiming && (
          <span style={{ color: "var(--pnv-text-faint)", fontVariantNumeric: "tabular-nums" }}>
            · loaded in {fmtLoadSeconds(loadTiming.total)}
          </span>
        )}
        {hasIssues && (
          <span style={{
            color: "var(--pnv-on-primary)",
            background: "var(--pnv-warning)",
            fontSize: "var(--pnv-fs-10)",
            fontWeight: 700,
            padding: "0 5px",
            borderRadius: 8,
            minWidth: 16,
            textAlign: "center",
            lineHeight: "16px",
          }}>
            {diagnostics.warnings.length}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--pnv-text-faint)" }}>click to expand</span>
        {/* #103: the file-watch status lives here, not in a row of its own. */}
        <SyncIndicator />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "8px 12px",
        background: hasIssues ? "var(--pnv-warning-tint)" : "var(--pnv-success-tint)",
        borderBottom: `1px solid ${hasIssues ? "var(--pnv-warning-border)" : "var(--pnv-success-border)"}`,
        fontSize: "var(--pnv-fs-12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: "var(--pnv-text-body)" }}>Model Diagnostics</span>
        <span style={{ marginLeft: "auto" }}>
          <SyncIndicator />
        </span>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            fontSize: "var(--pnv-fs-10)", border: "none", background: "none",
            color: "var(--pnv-text-faint)", cursor: "pointer",
          }}
        >
          collapse
        </button>
      </div>

      {/* Summary */}
      <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-secondary)", marginBottom: 4 }}>
        <span>
          {diagnostics.mechanismCount} mechanisms, {diagnostics.projectionCount} projections, {diagnostics.compositionCount} composition(s)
        </span>
        {diagnostics.editableVars.length > 0 && (
          <span style={{ color: "var(--pnv-success)" }}> — {diagnostics.editableVars.length} editable</span>
        )}
        {diagnostics.readOnlyVars.length > 0 && (
          <span style={{ color: "var(--pnv-warning)" }}> — {diagnostics.readOnlyVars.length} view-only</span>
        )}
      </div>
      <div style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginBottom: 4, display: "flex", gap: 12 }}>
        {diagnostics.importStyle && (
          <span>Import: <strong>{diagnostics.importStyle}</strong></span>
        )}
        {diagnostics.pnlVersion && (
          <span>PsyNeuLink: <strong>{diagnostics.pnlVersion}</strong></span>
        )}
      </div>

      {/* Load time (#874): persistent record of how long this model took to
          open, with an expandable breakdown from the #867 timing instrumentation. */}
      {loadTiming && (
        <div style={{ fontSize: "var(--pnv-fs-10)", color: "var(--pnv-text-faint)", marginBottom: 4 }}>
          <span>
            Load time: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{fmtLoadSeconds(loadTiming.total)}</strong>
          </span>
          <Button kind="link" onClick={() => setShowTiming((v) => !v)} style={{ marginLeft: 6 }}>
            {showTiming ? "hide breakdown" : "breakdown"}
          </Button>
          {showTiming && (
            <span style={{ marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>
              {loadTiming.backend?.introspect_ms != null && (
                <>backend {Math.round(loadTiming.backend.introspect_ms)}ms · </>
              )}
              network {Math.round(loadTiming.api)}ms · build {Math.round(loadTiming.build)}ms · paint {Math.round(loadTiming.paint)}ms
            </span>
          )}
        </div>
      )}

      {/* Star import conversion notice */}
      {starImportConverted && (
        <div style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-primary-deep)", marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}>
          <span>Auto-converted: <code>from psyneulink import *</code> → <code>import psyneulink as pnl</code></span>
          <button
            onClick={async () => {
              if (!filePath) return;
              try {
                const resp = await fetch("/api/model/undo-star-convert", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ file_path: filePath }),
                });
                if (resp.ok) {
                  const data = await resp.json();
                  useModelStore.getState().setSource(data.source);
                  useModelStore.getState().loadModelFromServer(data.model, data.layout);
                  useModelStore.setState({ starImportConverted: false });
                  useNotificationStore.getState().addNotification("info", "Reverted to original star import style");
                }
              } catch { /* ignore */ }
            }}
            style={{
              fontSize: "var(--pnv-fs-10)", padding: "1px 6px", border: "1px solid var(--pnv-primary-tint-border)",
              borderRadius: 3, background: "var(--pnv-primary-tint)", color: "var(--pnv-primary-deep)",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Informational notices — calm/blue, not an error */}
      {notices.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {notices.map((n, i) => (
            <div
              key={i}
              style={{
                fontSize: "var(--pnv-fs-11)", color: "var(--pnv-primary-deep)", paddingLeft: 4, marginBottom: 2,
                display: "flex", gap: 6, alignItems: "baseline",
              }}
            >
              <span aria-hidden style={{ flexShrink: 0 }}>ℹ</span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings. Structural ones (a variable name) are clickable — jump to
          the code. Load-time warnings (e.g. version mismatch, #879) reference
          no variable, so they render plainly without a misleading jump cue. */}
      {diagnostics.warnings.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {diagnostics.warnings.map((w, i) => {
            const lineMap = useModelStore.getState().lineMap;
            const allVars = [...diagnostics.editableVars, ...diagnostics.readOnlyVars];
            const jumpVar = allVars.find((v) => w.includes(v) && lineMap[v]);
            return (
              <div
                key={i}
                style={{
                  fontSize: "var(--pnv-fs-11)", color: "var(--pnv-warning)", paddingLeft: 4, marginBottom: 2,
                  cursor: jumpVar ? "pointer" : "default",
                }}
                onClick={
                  jumpVar
                    ? () => useModelStore.getState().setCursorTargetLine(lineMap[jumpVar])
                    : undefined
                }
                title={jumpVar ? "Click to jump to relevant code" : undefined}
              >
                {w}
              </div>
            );
          })}
        </div>
      )}

      {/* Convert / Revert buttons */}
      {!source.trimStart().startsWith("# PsyNeuLink Model File") && filePath && (
        <ConvertButton filePath={filePath} />
      )}
      {source.trimStart().startsWith("# PsyNeuLink Model File") && filePath && (
        <RevertButton filePath={filePath} />
      )}
    </div>
  );
}

function RevertButton({ filePath }: { filePath: string }) {
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [backupExists, setBackupExists] = useState<boolean | null>(null);

  const backupPath = filePath.replace(/\.py$/, ".original.py");

  // Check if a backup file actually exists before showing the button
  useEffect(() => {
    fetch("/api/model/file-exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: backupPath }),
    })
      .then((r) => r.json())
      .then((data) => setBackupExists(data.exists))
      .catch(() => setBackupExists(false));
  }, [backupPath]);

  if (!backupExists) return null;

  return (
    <Button
      kind="secondary"
      size="tall"
      onClick={async () => {
        try {
          // Try to load the backup file
          const resp = await fetch("/api/model/load", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: backupPath }),
          });
          if (!resp.ok) {
            addNotification("warning", "No backup found (.original.py). The original was not preserved.");
            return;
          }
          const backupData = await resp.json();

          // Copy backup over the current file
          const copyResp = await fetch("/api/model/save-source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: filePath, source: backupData.source }),
          });
          if (copyResp.ok) {
            const data = await copyResp.json();
            useModelStore.getState().setSource(backupData.source);
            useModelStore.getState().loadModelFromServer(data.model, data.layout);
            addNotification("success", "Reverted to original format");
          }
        } catch (e) {
          addNotification("error", `Revert failed: ${e}`);
        }
      }}
      style={{ marginTop: 6 }}
      title="Restore the original file from before conversion (.original.py backup)"
    >
      Revert to Original
    </Button>
  );
}

function ConvertButton({ filePath }: { filePath: string }) {
  const [converting, setConverting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The confirmation closes the shared ways (#1289): ×, Escape, click outside, Cancel.
  useDismiss(confirmOpen, () => setConfirmOpen(false));
  const addNotification = useNotificationStore((s) => s.addNotification);

  const doConvert = async () => {
    setConfirmOpen(false);
    setConverting(true);
    try {
      const resp = await fetch("/api/model/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: filePath, backup: true }),
      });
      if (resp.ok) {
        const data = await resp.json();
        useModelStore.getState().setSource(data.source);
        useModelStore.getState().loadModelFromServer(data.model, data.layout);
        addNotification("success", "Converted to standard format. Original backed up as .original.py — use 'Revert to Original' to undo.");
      } else {
        const err = await resp.json();
        addNotification("error", `Conversion failed: ${err.detail}`);
      }
    } catch (e) {
      addNotification("error", `Conversion failed: ${e}`);
    } finally {
      setConverting(false);
    }
  };

  return (
    <>
      <Button
        kind="secondary"
        size="tall"
        onClick={() => setConfirmOpen(true)}
        disabled={converting}
        style={{ marginTop: 6 }}
      >
        {converting ? "Converting..." : "Convert to Standard Format"}
      </Button>

      {/* Confirmation modal */}
      {confirmOpen && (
        <div
          style={{
            position: "fixed", inset: 0, background: "var(--pnv-scrim)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
          }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="convert-confirm-title"
            data-testid="convert-confirm-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--pnv-surface)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden",
              maxWidth: 440, width: "90%", boxShadow: "var(--pnv-shadow-dialog)",
            }}
          >
            <DialogHeader title="Convert to Standard Format?" titleId="convert-confirm-title" onClose={() => setConfirmOpen(false)} />
            <div style={{ padding: "14px 28px 24px" }}>
            <div style={{ fontSize: "var(--pnv-fs-13)", color: "var(--pnv-text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
              This will restructure the file with section headers and clean formatting.
              Your original file will be backed up as <code>.original.py</code> and
              you can revert at any time using the "Revert to Original" button.
              <br /><br />
              <strong>Note:</strong> Comments and custom code structure may change.
              The graph and all parameters will be preserved.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button kind="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button kind="primary" onClick={doConvert}>
                Convert
              </Button>
            </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
