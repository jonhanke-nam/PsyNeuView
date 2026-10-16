/**
 * History Panel — shows the full undo/redo action history.
 * Displays as a small dropdown from the undo/redo buttons.
 *
 * #1093: each entry expands to show how that action changed the .py source.
 * A graph edit rewrites the file, but the user never saw what it wrote — which
 * is a trust problem and, as a tester put it, a learning one: doing something
 * visually and reading back the code is how you find out how to do it
 * programmatically. Snapshots already carry `source`, so the diff is derived
 * from state that was there all along.
 *
 * At the top, "Changes since save…" opens the comparison of the editor with
 * the file on disk (#1348), the other question History is asked.
 *
 * #1349: saves are drawn as markers under the step they wrote ("Saved 14:32",
 * "Autosaved 14:32" tagged automatic), and the step whose text is on disk now
 * is tagged "on disk". Click a marker to select it: for a save the file no
 * longer holds, it offers "Revert the file to this save…", which asks first,
 * showing the change (RevertToSaveDialog). When undo has brought you to such
 * a save, the top of the panel says so and offers the same. The counts line
 * says how deep History goes: every step, unless it outgrew its memory
 * budget (#558). With every step kept the list can be long, so it shows the
 * newest few hundred around the current step, and earlier ones on request.
 *
 * Going to a step (#1377): an action's row, opened, offers "Go back to this
 * step" (or forward), which undoes or redoes everything between here and
 * there as one action, with one notice ("Went back 20 steps, to Edit 37"),
 * not one per step.
 *
 * Closes the shared ways (#1289): the × in its fixed header (the list under
 * it is what scrolls), Escape, a click outside, and the History button that
 * opened it.
 */

import { useEffect, useRef, useState } from "react";
import { useHistoryStore, type Snapshot } from "@/stores/historyStore";
import { useEditLockStore } from "@/stores/editLockStore";
import { isProtected, usePnlSourceStore } from "@/stores/pnlSourceStore";
import { useRevertToSaveStore } from "@/stores/revertToSaveStore";
import {
  canRevertTo,
  depthLabel,
  formatSaveTime,
  listSaves,
  needsSeconds,
  onDiskIndex,
  revertBlock,
  revertBlockReason,
  saveAtPosition,
  saveLabel,
  saveTooltip,
  type SaveEntry,
} from "@/utils/saveHistory";
import { diffSource, condense, summarize } from "@/utils/sourceDiff";
import { useModelStore } from "@/stores/modelStore";
import { useChangesSinceSaveStore } from "@/stores/changesSinceSaveStore";
import { goToHistoryStep } from "@/hooks/useUndoRedo";
import { Button } from "./Button";
import { DialogHeader } from "./dialog/DialogHeader";
import { useDismiss } from "./dialog/useDismiss";

function DiffView({ before, after }: { before: string; after: string }) {
  const diff = diffSource(before, after);
  if (diff.unchanged) {
    return (
      <div style={{ padding: "4px 12px 6px 24px", fontSize: 11, color: "var(--pnv-text-faint)" }}>
        This action didn't change the code.
      </div>
    );
  }

  const lines = condense(diff, 2);
  return (
    <div
      style={{
        margin: "2px 8px 6px 20px",
        border: "1px solid var(--pnv-border-faint)",
        borderRadius: 4,
        background: "var(--pnv-surface-muted)",
        maxHeight: 180,
        overflow: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      }}
    >
      {lines.map((line, i) => {
        const added = line.kind === "added";
        const removed = line.kind === "removed";
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 6,
              padding: "0 6px",
              whiteSpace: "pre",
              background: added ? "var(--pnv-success-tint)" : removed ? "var(--pnv-danger-tint)" : "transparent",
              color: added ? "var(--pnv-success)" : removed ? "var(--pnv-danger)" : "var(--pnv-text-hint)",
            }}
          >
            <span style={{ width: 10, flexShrink: 0, opacity: 0.8 }}>
              {added ? "+" : removed ? "−" : " "}
            </span>
            <span style={{ overflowWrap: "anywhere" }}>{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Each step's one-line summary, kept per step object. History can hold
 * thousands of steps and the line diff is quadratic, so recomputing every
 * summary on every render (a click, a new step) is not affordable. A step's
 * code never changes (compacting a step, #558, changes how it is stored, not
 * what it says), so an entry stays valid until its step or the step before
 * it is replaced.
 */
const summaryCache = new WeakMap<Snapshot, { before: Snapshot; summary: string }>();
function stepSummary(before: Snapshot, after: Snapshot): string {
  const hit = summaryCache.get(after);
  if (hit && hit.before === before) return hit.summary;
  const summary = summarize(diffSource(before.source, after.source));
  summaryCache.set(after, { before, summary });
  return summary;
}

/** How many steps the list shows at first, and how many before the current one. */
const ROWS_SHOWN = 200;
const ROWS_BEFORE_CURRENT = 20;

/** A save, drawn as a line under the step it wrote; click to select it. */
function SaveMarker({
  save,
  selected,
  onDisk,
  seconds,
  onSelect,
}: {
  save: SaveEntry;
  seconds: boolean;
  selected: boolean;
  onDisk: boolean;
  onSelect: () => void;
}) {
  const auto = save.mark.kind === "auto";
  return (
    <button
      type="button"
      data-testid="history-save-marker"
      data-kind={save.mark.kind}
      data-on-disk={onDisk ? "true" : "false"}
      aria-pressed={selected}
      onClick={onSelect}
      title={saveTooltip(save.mark)}
      className="pnv-history-save-marker"
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 6,
        margin: 0,
        padding: "2px 12px 2px 20px",
        border: "none",
        borderTop: "1px dashed var(--pnv-success-border)",
        borderLeft: selected ? "3px solid var(--pnv-success)" : "3px solid transparent",
        background: selected ? "var(--pnv-success-tint)" : "transparent",
        color: "var(--pnv-success)",
        fontSize: 11,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span aria-hidden>⤓</span>
      <span style={{ flex: 1 }}>{saveLabel(save.mark, seconds)}</span>
      {auto && (
        <span
          data-testid="history-save-automatic"
          style={{
            fontSize: 10, padding: "0 5px", borderRadius: 3, color: "var(--pnv-text-muted)",
            background: "var(--pnv-surface-sunken)", border: "1px solid var(--pnv-border-faint)",
          }}
        >
          automatic
        </span>
      )}
    </button>
  );
}

export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const past = useHistoryStore((s) => s.past);
  const future = useHistoryStore((s) => s.future);
  const ref = useRef<HTMLDivElement>(null);
  // "Changes since save" (#1348): offered whenever the model has a file to
  // compare against, saved or not — "No changes" is an answer worth having.
  const filePath = useModelStore((s) => s.filePath);
  const unsaved = useModelStore((s) => s.source !== s.savedSource);
  const showChangesSinceSave = useChangesSinceSaveStore((s) => s.show);
  // Saves in History (#1349).
  const savedSource = useModelStore((s) => s.savedSource);
  const evicted = useHistoryStore((s) => s.evicted);
  const totalBudget = useHistoryStore((s) => s.budget.totalBytes);
  const viewOnly = useEditLockStore((s) => s.mode === "viewOnly");
  const pnlProtected = usePnlSourceStore((s) => isProtected(s.status));
  const showRevert = useRevertToSaveStore((s) => s.show);
  const [selectedSave, setSelectedSave] = useState<string | null>(null);
  // History keeps every step (#558), which can be thousands: the list shows
  // the newest ROWS_SHOWN around the current step, and more on request.
  const [earlier, setEarlier] = useState(0);
  useEffect(() => {
    if (!open) setEarlier(0);
  }, [open]);

  useDismiss(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // One list in display order, so an index means the same thing to the row and
  // to the diff: entry N is compared against entry N-1.
  const entries: Snapshot[] = [...past, ...future];
  const currentIndex = past.length - 1;
  const diskIndex = onDiskIndex(entries, savedSource);
  const block = revertBlock({ filePath, viewOnly, pnlProtected });
  const atSave = saveAtPosition(past, savedSource);
  const seconds = needsSeconds(listSaves(entries).map((e) => e.mark));
  const firstShown = Math.max(0, Math.min(entries.length - ROWS_SHOWN, currentIndex - ROWS_BEFORE_CURRENT) - earlier);
  const depth = depthLabel(evicted, totalBudget);
  const revert = (save: SaveEntry) => {
    setOpen(false);
    showRevert({ snapshot: save.snapshot, mark: save.mark });
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="history-button"
        style={{
          fontSize: 10,
          padding: "1px 5px",
          border: open ? "1px solid var(--pnv-primary)" : "1px solid var(--pnv-border-light)",
          borderRadius: 3,
          background: open ? "var(--pnv-primary-tint)" : "var(--pnv-surface)",
          color: open ? "var(--pnv-primary)" : "var(--pnv-text-hint)",
          cursor: "pointer",
        }}
        title="Show action history, and how each action changed the code"
      >
        History
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby="history-panel-title"
          data-testid="history-panel"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            zIndex: 1000,
            minWidth: 340,
            maxHeight: 400,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <DialogHeader title="History" titleId="history-panel-title" compact onClose={() => setOpen(false)} />
          {filePath && (
            <div
              style={{
                padding: "6px 12px", fontSize: 12, display: "flex", justifyContent: "space-between",
                alignItems: "center", gap: 8, borderBottom: "1px solid var(--pnv-border-faint)",
              }}
            >
              <Button
                kind="link"
                data-testid="history-changes-since-save"
                onClick={() => {
                  setOpen(false);
                  showChangesSinceSave();
                }}
                title="Compare the editor with the model's file on disk"
              >
                Changes since save…
              </Button>
              <span style={{ fontSize: 10, color: unsaved ? "var(--pnv-unsaved)" : "var(--pnv-text-faint)" }}>
                {unsaved ? "unsaved changes" : "all saved"}
              </span>
            </div>
          )}
          {atSave && (
            <div
              data-testid="history-at-save"
              style={{
                padding: "6px 12px", fontSize: 12, lineHeight: 1.4, display: "flex", flexDirection: "column", gap: 4,
                color: "var(--pnv-text-body)", background: "var(--pnv-success-tint)",
                borderBottom: "1px solid var(--pnv-border-faint)",
              }}
            >
              <span>
                You've undone to the save of <strong>{formatSaveTime(atSave.mark.at, seconds)}</strong>. The file on disk holds a different
                version, until you save or revert.
              </span>
              {block ? (
                <span style={{ fontSize: 11, color: "var(--pnv-text-muted)" }}>{revertBlockReason(block)}</span>
              ) : (
                <span>
                  <Button kind="small" data-testid="history-at-save-revert" onClick={() => revert(atSave)}>
                    Revert the file to this save…
                  </Button>
                </span>
              )}
            </div>
          )}
          <div style={{ overflowY: "auto", padding: "4px 0" }}>
            <div
              data-testid="history-counts"
              style={{ padding: "6px 12px", fontSize: 10, color: "var(--pnv-text-faint)", borderBottom: "1px solid var(--pnv-border-faint)" }}
              title={depth.title}
            >
              {Math.max(0, past.length - 1)} undo steps, {future.length} redo steps
              <span data-testid="history-depth" style={{ marginLeft: 6 }}>· {depth.text}</span>
              <span style={{ marginLeft: 6 }}>· click an action to see the code change or go to it</span>
            </div>
            {entries.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--pnv-text-faint)" }}>No history</div>
            )}
            {firstShown > 0 && (
              <div style={{ padding: "4px 12px", fontSize: 11 }}>
                <Button
                  kind="link"
                  data-testid="history-show-earlier"
                  onClick={() => setEarlier((n) => n + ROWS_SHOWN)}
                  title="List the steps before these; undo reaches them either way"
                >
                  Show {Math.min(firstShown, ROWS_SHOWN)} earlier steps ({firstShown} not listed)
                </Button>
              </div>
            )}
            {entries.map((entry, i) => {
              if (i < firstShown) return null;
              const isCurrent = i === currentIndex;
              const previous = i > 0 ? entries[i - 1] : null;
              const isExpanded = expanded === i;
              const summary = previous ? stepSummary(previous, entry) : null;
              const saves: SaveEntry[] = (entry.saves ?? []).map((mark) => ({ index: i, snapshot: entry, mark }));
              // A row opens to show its code change, and (unless it is where
              // History is now) to go there (#1377).
              const opens = !!previous || !isCurrent;
              const away = Math.abs(i - currentIndex);
              const back = i < currentIndex;
              return (
                <div key={i}>
                  <div
                    data-testid="history-step"
                    data-current={isCurrent ? "true" : undefined}
                    data-opens={opens ? "true" : undefined}
                    className="pnv-history-step"
                    onClick={() => opens && setExpanded(isExpanded ? null : i)}
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      cursor: opens ? "pointer" : "default",
                      color: isCurrent ? "var(--pnv-primary)" : "var(--pnv-text-secondary)",
                      background: isCurrent ? "var(--pnv-primary-tint)" : "transparent",
                      fontWeight: isCurrent ? 600 : 400,
                      borderLeft: isCurrent ? "3px solid var(--pnv-primary)" : "3px solid transparent",
                    }}
                    title={
                      isCurrent
                        ? previous
                          ? "Where History is now. Click to show how this action changed the code"
                          : undefined
                        : `Click to ${previous ? "show how this action changed the code, and to " : ""}go ${back ? "back" : "forward"} to it: ${back ? "undoes" : "redoes"} everything up to this step (${away} ${away === 1 ? "step" : "steps"})`
                    }
                  >
                    <span>
                      {isCurrent ? "→ " : ""}
                      {entry.description || (i === 0 ? "Initial state" : "Action")}
                      {i === diskIndex && (
                        <span
                          data-testid="history-on-disk"
                          title="The file on disk holds this step's code"
                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: "var(--pnv-success)" }}
                        >
                          on disk
                        </span>
                      )}
                    </span>
                    {summary && (
                      <span
                        style={{
                          fontSize: 10,
                          color: summary.startsWith("no change") ? "var(--pnv-warning)" : "var(--pnv-text-faint)",
                          whiteSpace: "nowrap",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {summary}
                      </span>
                    )}
                  </div>
                  {isExpanded && previous && (
                    <DiffView before={previous.source} after={entry.source} />
                  )}
                  {isExpanded && !isCurrent && (
                    <div style={{ padding: "0 12px 6px 23px" }}>
                      <Button
                        kind="small"
                        data-testid="history-go-to-step"
                        onClick={() => void goToHistoryStep(i)}
                        title={`${back ? "Undo" : "Redo"} everything up to this step: ${away} ${away === 1 ? "step" : "steps"}, as one action`}
                      >
                        {back ? "Go back to this step" : "Go forward to this step"} ({away} {away === 1 ? "step" : "steps"})
                      </Button>
                    </div>
                  )}
                  {saves.map((save, k) => {
                    const key = `${i}:${k}`;
                    const selected = selectedSave === key;
                    const onDisk = !canRevertTo(save, savedSource);
                    return (
                      <div key={key}>
                        <SaveMarker
                          save={save}
                          selected={selected}
                          onDisk={onDisk}
                          seconds={seconds}
                          onSelect={() => setSelectedSave(selected ? null : key)}
                        />
                        {selected && (
                          <div
                            data-testid="history-save-detail"
                            style={{ padding: "4px 12px 6px 23px", fontSize: 11, color: "var(--pnv-text-muted)", background: "var(--pnv-success-tint)" }}
                          >
                            {onDisk ? (
                              "The file on disk holds this version."
                            ) : block ? (
                              revertBlockReason(block)
                            ) : (
                              <Button kind="small" data-testid="history-revert-save" onClick={() => revert(save)}>
                                Revert the file to this save…
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
