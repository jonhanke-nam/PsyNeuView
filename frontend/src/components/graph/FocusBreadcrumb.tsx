/**
 * #426 Focus mode breadcrumb. Shown only when a nested composition is focused
 * (rendered full-canvas as the graph root). Lets the user step back up the
 * ancestor chain or exit focus entirely.
 */

import { useModelStore } from "@/stores/modelStore";
import { focusComposition } from "@/utils/nodeActions";

const crumbStyle: React.CSSProperties = {
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: "2px 4px",
  fontSize: 12,
  color: "var(--pnv-primary-deep)",
  fontWeight: 600,
};

export function FocusBreadcrumb() {
  const focusPath = useModelStore((s) => s.focusPath);
  if (focusPath.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 2,
        background: "var(--pnv-surface)",
        border: "1px solid var(--pnv-primary-tint-border)",
        borderRadius: 6,
        padding: "4px 10px",
        boxShadow: "var(--pnv-shadow-float)",
        maxWidth: "90%",
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => void focusComposition(null)}
        title="Exit focus — show the full model"
        style={crumbStyle}
      >
        ⌂ Full model
      </button>
      {focusPath.map((crumb, i) => {
        const isLast = i === focusPath.length - 1;
        return (
          <span key={crumb.name} style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <span style={{ color: "var(--pnv-text-faint)", fontSize: 12 }}>›</span>
            {isLast ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pnv-node-text-strong)", padding: "2px 4px" }}>
                {crumb.label}
              </span>
            ) : (
              <button
                onClick={() => void focusComposition(crumb.name)}
                title={`Focus ${crumb.label}`}
                style={crumbStyle}
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
