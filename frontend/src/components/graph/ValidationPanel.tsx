/**
 * Validation surface for model state issues that aren't fatal but need
 * the user's attention. Currently lists statically-detected dangling
 * projections (#186), and connections PsyNeuLink refused to make, e.g. on a
 * shape mismatch (#1235).
 */

import { useState } from "react";
import { useModelStore } from "@/stores/modelStore";

export function ValidationPanel() {
  const dangling = useModelStore((s) => s.danglingProjections);
  const broken = useModelStore((s) => s.brokenProjections);
  const setCursorTargetLine = useModelStore((s) => s.setCursorTargetLine);
  const [expanded, setExpanded] = useState(true);

  if (dangling.length === 0 && broken.length === 0) return null;

  const issueCount = dangling.length + broken.length;
  // Name what's wrong: a count of "issues" says nothing about what to fix.
  const kinds = [
    dangling.length ? `${dangling.length} dangling projection${dangling.length === 1 ? "" : "s"}` : "",
    broken.length ? `${broken.length} broken connection${broken.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return (
    <div
      data-testid="validation-panel"
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 6,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-danger)",
        borderRadius: 6,
        boxShadow: "var(--pnv-shadow-float)",
        fontSize: "var(--pnv-fs-12)",
        fontFamily: "monospace",
        maxWidth: 480,
        minWidth: 240,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "var(--pnv-danger-tint)",
          color: "var(--pnv-danger)",
          border: "none",
          borderRadius: "5px 5px 0 0",
          padding: "6px 12px",
          cursor: "pointer",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
        title={expanded ? "Hide list" : "Show list"}
      >
        <span style={{ fontSize: "var(--pnv-fs-14)" }}>⚠</span>
        <span data-testid="validation-summary" title={`${issueCount} to fix`}>{kinds.join(", ")}</span>
        <span style={{ marginLeft: "auto", fontFamily: "sans-serif", fontSize: "var(--pnv-fs-10)" }}>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: "6px 12px 8px",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {dangling.map((d) => {
            const sideText =
              d.missingSide === "both"
                ? `both endpoints missing: ${d.missing.join(", ")}`
                : `missing ${d.missingSide}: ${d.missing.join(", ")}`;
            return (
              <li
                key={d.varName}
                style={{
                  padding: "3px 0",
                  borderBottom: "1px solid var(--pnv-danger-border)",
                  lineHeight: 1.4,
                }}
              >
                <button
                  onClick={() => d.line && setCursorTargetLine(d.line)}
                  title={d.line ? `Jump to line ${d.line}` : ""}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: d.line ? "pointer" : "default",
                    color: "var(--pnv-primary-deep)",
                    fontWeight: 600,
                    fontFamily: "monospace",
                    fontSize: "var(--pnv-fs-12)",
                  }}
                >
                  {d.varName}
                </button>
                <span style={{ color: "var(--pnv-text-muted)" }}> ({d.type}) — </span>
                <span style={{ color: "var(--pnv-danger)" }}>{sideText}</span>
                {d.line ? (
                  <span style={{ color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-11)" }}> · line {d.line}</span>
                ) : null}
              </li>
            );
          })}
          {broken.map((b) => (
            <li
              key={`broken-${b.varName}`}
              data-testid="broken-connection"
              style={{ padding: "3px 0", borderBottom: "1px solid var(--pnv-danger-border)", lineHeight: 1.4 }}
            >
              <button
                onClick={() => b.line && setCursorTargetLine(b.line)}
                title={b.line ? `Jump to line ${b.line}` : ""}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: b.line ? "pointer" : "default",
                  color: "var(--pnv-primary-deep)",
                  fontWeight: 600,
                  fontFamily: "monospace",
                  fontSize: "var(--pnv-fs-12)",
                }}
              >
                {b.varName}
              </button>
              <span style={{ color: "var(--pnv-text-muted)" }}>
                {" "}({b.senderRef ?? "?"} → {b.receiverRef ?? "?"}) — couldn't be made:{" "}
              </span>
              <span style={{ color: "var(--pnv-danger)", fontFamily: "sans-serif" }}>{b.error}</span>
              {b.line ? <span style={{ color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-11)" }}> · line {b.line}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
