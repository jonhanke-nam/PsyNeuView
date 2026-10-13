// Model-level control for where a model's sidecar files physically live (#933):
// laterally beside the `.py`, or tucked into a hidden `.psyneuview/` dot-folder.
//
// This is a *different axis* from the layout/label variant pickers: those choose
// which arrangement you're viewing (and a model can have many), while this is a
// single per-model choice of *where on disk* all of those files sit — they move
// together. It lives beside the variant pickers but is deliberately its own
// control so the two concepts don't read as one.

import { useEffect, useRef, useState } from "react";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { LOCATION_LABEL, defaultHint, willMoveFiles } from "@/utils/sidecarPlacement";
import { useDismiss } from "@/components/common/dialog/useDismiss";

export function SidecarPlacementPicker() {
  const filePath = useModelStore((s) => s.filePath);
  const sidecars = useModelStore((s) => s.sidecars);
  const setPlacement = useModelStore((s) => s.setPlacement);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  // Escape closes the menu through the shared stack (#1289).
  useDismiss(open, () => setOpen(false));

  // Placement isn't user-selectable for a managed clone (its companions are
  // already redirected out of tree), so the control simply doesn't appear.
  if (!filePath || !sidecars || sidecars.placement.managed) return null;
  const placement = sidecars.placement;

  const choose = (value: "lateral" | "dotfolder" | "inherit") => {
    setOpen(false);

    // No-op if it's already the active choice.
    const alreadySelected =
      value === "inherit" ? placement.perModel === null : value === placement.perModel;
    if (alreadySelected) return;

    // A concrete location that differs from where the files currently are will
    // relocate them on disk — confirm first.
    const willMove = willMoveFiles(placement, value);
    if (willMove) {
      const dest =
        value === "lateral"
          ? "beside your .py file"
          : "into a hidden .psyneuview/ folder";
      if (
        !window.confirm(
          `Move this model's sidecar files ${dest}? Its layout and label files will be relocated on disk.`,
        )
      ) {
        return;
      }
    }

    (async () => {
      try {
        const migration = await setPlacement(value);
        if (migration?.conflicts?.length) {
          addNotification(
            "error",
            `Placement changed, but ${migration.conflicts.length} file(s) already existed at the destination and were left in place: ${migration.conflicts.join(", ")}`,
          );
        } else if (migration?.moved.length) {
          addNotification("success", `Moved ${migration.moved.length} sidecar file(s).`);
        }
      } catch (e: any) {
        addNotification("error", e?.message || "Couldn't change sidecar placement");
      }
    })();
  };

  const inheriting = placement.perModel === null;


  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        data-testid="sidecar-placement-button"
        onClick={() => setOpen((o) => !o)}
        title="Where this model's sidecar files (layouts, labels) are stored on disk"
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          padding: "2px 8px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 3,
          background: "var(--pnv-surface)",
          color: "var(--pnv-text-body)",
          cursor: "pointer",
          display: "inline-flex",
          gap: 5,
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--pnv-text-faint)" }}>Files:</span>
        <span>{LOCATION_LABEL[placement.effective]}</span>
        {inheriting && <span style={{ color: "var(--pnv-text-faint)", fontSize: 9 }}>(default)</span>}
        <span style={{ color: "var(--pnv-text-faint)", fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="sidecar-placement-menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 2,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            zIndex: 1000,
            minWidth: 240,
            padding: "4px 0",
          }}
        >
          <div
            style={{
              padding: "3px 12px 5px",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--pnv-text-faint)",
            }}
          >
            Sidecar files — this model
          </div>
          <PlacementRow
            selected={placement.perModel === "lateral"}
            onClick={() => choose("lateral")}
            label="Beside the .py"
            hint="visible next to your model"
          />
          <PlacementRow
            selected={placement.perModel === "dotfolder"}
            onClick={() => choose("dotfolder")}
            label="Hidden .psyneuview/"
            hint="tucked into a dot-folder"
          />
          <PlacementRow
            selected={inheriting}
            onClick={() => choose("inherit")}
            label="Use default"
            hint={`follows the global default${defaultHint(placement)}`}
          />
        </div>
      )}
    </div>
  );
}

function PlacementRow({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      // Repeated row, so hover is a CSS class rather than onMouseEnter state
      // (#845): mutating a shared inline style leaves stale backgrounds behind
      // on re-render. See docs/ui-interaction-conventions.md.
      className="placement-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "none",
        cursor: "pointer",
        padding: "4px 12px",
        fontSize: 12,
        color: "var(--pnv-text-body)",
      }}
    >
      <span style={{ width: 12, color: "var(--pnv-primary)" }}>{selected ? "◉" : "○"}</span>
      <span>{label}</span>
      <span style={{ fontSize: 10, color: "var(--pnv-text-faint)" }}>{hint}</span>
    </button>
  );
}
