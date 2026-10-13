/**
 * The PsyNeuLink call a Run/Learn actually made (#766).
 *
 * Rendered from a string the backend builds out of the very kwargs it passed,
 * so what is shown here and what executed cannot drift. Bulk arguments are
 * summarized by the backend — the point is the shape of the call, not its
 * payload.
 *
 * Shared by the Run and Learn panels so the two can't diverge in how they
 * present the same fact.
 */
interface Props {
  call?: string | null;
  /** Non-null only when the resolved mode differs from what was requested. */
  reason?: string | null;
}

export function PnlCallLine({ call, reason }: Props) {
  if (!call) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <code
        style={{
          display: "block",
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "var(--pnv-text-body)",
          background: "var(--pnv-surface-sunken)",
          border: "1px solid var(--pnv-border-faint)",
          borderRadius: 3,
          padding: "3px 6px",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
        title="The PsyNeuLink call this used"
      >
        {call}
      </code>
      {reason && (
        <div style={{ fontSize: 11, color: "var(--pnv-warning)", marginTop: 2 }}>{reason}</div>
      )}
    </div>
  );
}
