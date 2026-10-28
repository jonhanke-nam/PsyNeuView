/**
 * "Load Model → Developer / Tests…" modal (#274 / Phase 3 of #249).
 *
 * Lists pytest tests discovered under the resolved PsyNeuLink source tree
 * (env override → Mac-app cache → wheel fallback) via GET /api/dev/tests,
 * grouped by file → class → method. Picking a test calls
 * POST /api/dev/extract-test, which returns standalone .py content; the
 * caller is responsible for saving that to disk and loading it (same
 * save-as-with-409-retry shape as #258's GitHub loader).
 *
 * Unextractable rows render greyed out with the reason as a tooltip — we
 * surface 422 details inline instead of as a toast so the user can compare
 * neighboring rows in the same dropdown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";
import { Button } from "./Button";

export interface DevTestRef {
  file: string;
  class_name: string | null;
  method_name: string;
  qualified_name: string;
}

export interface ExtractedTest {
  source_file: string;
  qualified_name: string;
  content: string;
  suggested_filename: string;
}

interface DiscoverResponse {
  tests: DevTestRef[];
  source_tree: string | null;
}

interface ErrorDetail {
  reason?: string;
  message?: string;
}

interface ExtractResponse {
  content: string;
  suggested_filename: string;
}

export interface DeveloperTestsModalProps {
  onCancel: () => void;
  onExtracted: (extracted: ExtractedTest) => void;
}

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
  width: "min(760px, 92vw)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "var(--pnv-shadow-dialog)",
};

// Everything under the fixed header; the test list inside it is what scrolls.
const bodyStyle: React.CSSProperties = {
  padding: "12px 24px 20px",
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const filterRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "var(--pnv-fs-13)",
  marginBottom: 6,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 240,
  maxHeight: 440,
  overflowY: "auto",
  border: "1px solid var(--pnv-border-faint)",
  borderRadius: 6,
  marginTop: 6,
  background: "var(--pnv-surface-muted)",
};

const fileHeaderStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: "var(--pnv-fs-11)",
  textTransform: "uppercase",
  color: "var(--pnv-text-muted)",
  background: "var(--pnv-border-faint)",
  position: "sticky",
  top: 0,
  fontWeight: 600,
  cursor: "pointer",
  userSelect: "none",
};

const classHeaderStyle: React.CSSProperties = {
  padding: "3px 10px 3px 22px",
  fontSize: "var(--pnv-fs-11)",
  color: "var(--pnv-text-body)",
  background: "var(--pnv-surface-sunken)",
  fontWeight: 600,
};

const rowItemStyle = (selected: boolean, disabled: boolean): React.CSSProperties => ({
  padding: "4px 10px 4px 34px",
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "monospace",
  fontSize: "var(--pnv-fs-12)",
  background: selected ? "var(--pnv-primary-tint)" : "transparent",
  color: disabled ? "var(--pnv-text-faint)" : "var(--pnv-text)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});

interface GroupedTests {
  file: string;
  shortFile: string;
  classes: { className: string | null; methods: DevTestRef[] }[];
}

function groupTests(tests: DevTestRef[], sourceTree: string | null): GroupedTests[] {
  const byFile = new Map<string, DevTestRef[]>();
  for (const t of tests) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file)!.push(t);
  }
  const groups: GroupedTests[] = [];
  for (const [file, methods] of byFile) {
    const byClass = new Map<string | null, DevTestRef[]>();
    for (const m of methods) {
      const key = m.class_name;
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key)!.push(m);
    }
    const classes = Array.from(byClass.entries())
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a.localeCompare(b);
      })
      .map(([className, ms]) => ({
        className,
        methods: ms.sort((x, y) => x.method_name.localeCompare(y.method_name)),
      }));
    const shortFile =
      sourceTree && file.startsWith(sourceTree)
        ? file.slice(sourceTree.length).replace(/^\/+/, "")
        : file;
    groups.push({ file, shortFile, classes });
  }
  return groups.sort((a, b) => a.shortFile.localeCompare(b.shortFile));
}

export function DeveloperTestsModal({ onCancel, onExtracted }: DeveloperTestsModalProps) {
  const [tests, setTests] = useState<DevTestRef[] | null>(null);
  const [sourceTree, setSourceTree] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<DevTestRef | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<ErrorDetail | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    filterInputRef.current?.focus();
  }, []);

  // Closes the shared ways (#1289): ×, Escape, click outside, Cancel.
  useDismiss(true, onCancel);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev/tests")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as DiscoverResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setTests(data.tests);
        setSourceTree(data.source_tree);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGroups = useMemo(() => {
    if (!tests) return [];
    const q = filter.trim().toLowerCase();
    const match = (t: DevTestRef) =>
      !q ||
      t.qualified_name.toLowerCase().includes(q) ||
      t.file.toLowerCase().includes(q);
    return groupTests(tests.filter(match), sourceTree);
  }, [tests, sourceTree, filter]);

  const toggleFile = useCallback((file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const handleExtract = async () => {
    if (!selected || extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const resp = await fetch("/api/dev/extract-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: selected.file,
          qualified_name: selected.qualified_name,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const detail: ErrorDetail = body?.detail ?? {
          reason: "network",
          message: `HTTP ${resp.status}`,
        };
        setExtractError(detail);
        if (resp.status === 422 && detail.message) {
          const key = rowKey(selected);
          setRowErrors((prev) => {
            const next = new Map(prev);
            next.set(key, detail.message!);
            return next;
          });
        }
        return;
      }
      const data: ExtractResponse = await resp.json();
      onExtracted({
        source_file: selected.file,
        qualified_name: selected.qualified_name,
        content: data.content,
        suggested_filename: data.suggested_filename,
      });
    } catch (e) {
      setExtractError({ reason: "network", message: String(e) });
    } finally {
      setExtracting(false);
    }
  };

  const canOpen = !!selected && !extracting;
  const totalCount = tests?.length ?? 0;
  const shownCount = filteredGroups.reduce(
    (n, g) => n + g.classes.reduce((m, c) => m + c.methods.length, 0),
    0,
  );

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-tests-title"
        data-testid="developer-tests-modal"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title="Open PsyNeuLink test as model" titleId="developer-tests-title" onClose={onCancel}>
          {sourceTree && (
            <div
              style={{
                fontSize: "var(--pnv-fs-11)",
                color: "var(--pnv-text-hint)",
                fontFamily: "monospace",
                maxWidth: 380,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={sourceTree}
            >
              {sourceTree}
            </div>
          )}
        </DialogHeader>
        <div style={bodyStyle}>

        {tests === null && !loadError && (
          <div style={{ padding: "10px 0", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-hint)" }}>
            Discovering tests…
          </div>
        )}

        {loadError && (
          <div
            style={{
              padding: "8px 10px",
              background: "var(--pnv-danger-tint)",
              color: "var(--pnv-danger)",
              borderRadius: 4,
              fontSize: "var(--pnv-fs-12)",
              marginBottom: 8,
            }}
          >
            Couldn't load tests: {loadError}
          </div>
        )}

        {tests !== null && sourceTree === null && (
          <div
            style={{
              padding: "8px 10px",
              background: "var(--pnv-warning-tint)",
              color: "var(--pnv-warning)",
              borderRadius: 4,
              fontSize: "var(--pnv-fs-12)",
              marginBottom: 8,
            }}
          >
            No PsyNeuLink source tree found. Install PsyNeuLink from source via
            the Mac app or set <code>PSYNEUVIEW_PNL_TESTS_ROOT</code> to enable
            developer tests.
          </div>
        )}

        {tests !== null && sourceTree !== null && (
          <>
            <div style={filterRowStyle}>
              <input
                ref={filterInputRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter (e.g. test_emcomposition, TestExecution)"
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  fontSize: "var(--pnv-fs-13)",
                  fontFamily: "monospace",
                  border: "1px solid var(--pnv-border)",
                  borderRadius: 4,
                }}
              />
              <span style={{ fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-hint)", whiteSpace: "nowrap" }}>
                {shownCount} / {totalCount}
              </span>
            </div>

            <div style={listStyle}>
              {filteredGroups.length === 0 && (
                <div style={{ padding: "10px 12px", fontSize: "var(--pnv-fs-12)", color: "var(--pnv-text-hint)" }}>
                  {filter
                    ? "No tests match this filter."
                    : "No tests discovered under tests/composition."}
                </div>
              )}
              {filteredGroups.map((g) => {
                const collapsed = collapsedFiles.has(g.file);
                return (
                  <div key={g.file}>
                    <div
                      style={fileHeaderStyle}
                      onClick={() => toggleFile(g.file)}
                      title={g.file}
                    >
                      {collapsed ? "▸ " : "▾ "}
                      {g.shortFile}
                    </div>
                    {!collapsed &&
                      g.classes.map((c) => (
                        <div key={`${g.file}::${c.className ?? "__module__"}`}>
                          {c.className && (
                            <div style={classHeaderStyle}>{c.className}</div>
                          )}
                          {c.methods.map((m) => {
                            const key = rowKey(m);
                            const disabledReason = rowErrors.get(key) ?? null;
                            const isSelected =
                              !!selected &&
                              selected.file === m.file &&
                              selected.qualified_name === m.qualified_name;
                            return (
                              <div
                                key={key}
                                onClick={() => {
                                  if (disabledReason) return;
                                  setSelected(m);
                                  setExtractError(null);
                                }}
                                onDoubleClick={() => {
                                  if (disabledReason) return;
                                  setSelected(m);
                                  setExtractError(null);
                                  void handleExtract();
                                }}
                                style={rowItemStyle(isSelected, !!disabledReason)}
                                title={
                                  disabledReason
                                    ? `Can't extract: ${disabledReason}`
                                    : `${g.shortFile}::${m.qualified_name}`
                                }
                              >
                                {m.method_name}
                                {disabledReason && (
                                  <span
                                    style={{ marginLeft: 8, fontSize: "var(--pnv-fs-10)", color: "var(--pnv-danger)" }}
                                  >
                                    (unextractable)
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {extractError && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 10px",
              background: "var(--pnv-danger-tint)",
              color: "var(--pnv-danger)",
              borderRadius: 4,
              fontSize: "var(--pnv-fs-12)",
            }}
          >
            {extractErrorMessage(extractError)}
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
            onClick={handleExtract}
            disabled={!canOpen}
            kind="primary"
          >
            {extracting ? "Extracting…" : "Open"}
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}

function rowKey(t: DevTestRef): string {
  return `${t.file}::${t.qualified_name}`;
}

function extractErrorMessage(err: ErrorDetail): string {
  switch (err.reason) {
    case "not_found":
      return "Source file not found — the test may have been deleted.";
    case "unextractable":
      return err.message ?? "This test can't be extracted as a standalone script.";
    case "network":
      return "Couldn't reach the backend.";
    default:
      return err.message ?? "Couldn't extract the test.";
  }
}
