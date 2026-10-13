/**
 * The rows of a line diff, drawn either unified or side by side.
 *
 * Shared by the two dialogs that compare two versions of the model's file:
 * "Changes since the last version that built" (LastGoodDiff, #1154) and
 * "Changes since save" (#1348). It draws only the rows; the dialog around it
 * owns the title, the summary and what "no changes" means there.
 *
 * Unified: one column, each line numbered in both versions, − and + marks.
 * Side by side: the older version on the left, the newer on the right, a
 * changed line set beside what replaced it (`toSideBySide`). Long runs of
 * unchanged lines are folded to a "⋯ N unchanged lines" row in both.
 */

import type { CSSProperties } from "react";

import { collapseUnchanged, toSideBySide, type DiffRow } from "@/utils/lineDiff";

export const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

type Collapsed = ReturnType<typeof collapseUnchanged>;

const lineNo: CSSProperties = { width: 34, textAlign: "right", color: "var(--pnv-text-faint)", flex: "none" };
const mark: CSSProperties = { width: 10, flex: "none", color: "var(--pnv-text-hint)" };

function tint(kind: DiffRow["kind"] | null): string {
  return kind === "added" ? "var(--pnv-success-tint)" : kind === "removed" ? "var(--pnv-danger-tint)" : "transparent";
}

function sign(kind: DiffRow["kind"]): string {
  return kind === "added" ? "+" : kind === "removed" ? "−" : " ";
}

function Gap({ hidden }: { hidden: number }) {
  return (
    <div style={{ padding: "4px 16px", color: "var(--pnv-text-faint)", background: "var(--pnv-surface-muted)" }}>
      ⋯ {hidden} unchanged {hidden === 1 ? "line" : "lines"}
    </div>
  );
}

/** One half of a side-by-side row; `null` is the blank opposite an insertion or a deletion. */
function Half({ row, side }: { row: DiffRow | null; side: "left" | "right" }) {
  // An unchanged line sits on both sides; a change only on its own.
  const kind = row === null ? null : row.kind;
  return (
    <div
      data-diff-side={side}
      style={{
        flex: "1 1 0", minWidth: 0, display: "flex", gap: 8, padding: "1px 10px",
        whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        background: row === null ? "var(--pnv-surface-muted)" : tint(kind),
        borderLeft: side === "right" ? "1px solid var(--pnv-border-faint)" : undefined,
      }}
    >
      <span style={lineNo}>{row === null ? "" : side === "left" ? row.leftNo : row.rightNo}</span>
      <span style={mark}>{row === null ? " " : sign(row.kind)}</span>
      <span>{row === null ? "" : row.text || " "}</span>
    </div>
  );
}

export function LineDiffView({ rows, layout = "unified" }: { rows: Collapsed; layout?: "unified" | "split" }) {
  if (layout === "split") {
    return (
      <div data-testid="line-diff" data-layout="split">
        {toSideBySide(rows).map((row, i) =>
          row.kind === "gap" ? (
            <Gap key={i} hidden={row.hidden} />
          ) : (
            <div key={i} data-diff-row style={{ display: "flex" }}>
              <Half row={row.left} side="left" />
              <Half row={row.right} side="right" />
            </div>
          ),
        )}
      </div>
    );
  }
  return (
    <div data-testid="line-diff" data-layout="unified">
      {rows.map((row, i) =>
        row.kind === "gap" ? (
          <Gap key={i} hidden={row.hidden} />
        ) : (
          <div
            key={i}
            data-diff-row
            style={{ display: "flex", gap: 10, padding: "1px 16px", whiteSpace: "pre-wrap", background: tint(row.kind) }}
          >
            <span style={lineNo}>{row.leftNo ?? ""}</span>
            <span style={lineNo}>{row.rightNo ?? ""}</span>
            <span style={mark}>{sign(row.kind)}</span>
            <span>{row.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
