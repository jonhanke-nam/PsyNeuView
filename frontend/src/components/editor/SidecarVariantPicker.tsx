// Variant picker for one sidecar kind — layout (.pnlview.json) or settings
// (.labels.yaml). Drives the ordered, named-variant list from #483: shows the
// active variant, lets the user switch it (re-applying to the canvas/labels),
// and add / duplicate / rename / delete / reorder / search by name. Renders
// `missing` entries (in the index but file gone) distinctly.

import { useEffect, useRef, useState } from "react";
import { useModelStore } from "@/stores/modelStore";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  createVariant,
  deleteVariant,
  duplicateVariant,
  renameVariant,
  reorderVariants,
  saveLayoutVariant,
  saveLabelsVariant,
  type SidecarKind,
} from "@/utils/sidecarApi";
import {
  autoLayoutPositions,
  labelsSeedFromNodes,
  layoutPositionsFromNodes,
} from "@/utils/sidecarSeed";
import type { ModelLabels } from "@/utils/labels";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Z_MENU } from "@/constants/zLayers";

const KIND_LABEL: Record<SidecarKind, string> = {
  layout: "Layout",
  settings: "Labels",
};

export function SidecarVariantPicker({ kind }: { kind: SidecarKind }) {
  const filePath = useModelStore((s) => s.filePath);
  const sidecars = useModelStore((s) => s.sidecars);
  const switchVariant = useModelStore((s) => s.switchVariant);
  const refreshSidecars = useModelStore((s) => s.refreshSidecars);
  const applyLayoutPositions = useModelStore((s) => s.applyLayoutPositions);
  const setModelLabels = useModelStore((s) => s.setModelLabels);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  if (!filePath || !sidecars) return null;

  const variants = kind === "layout" ? sidecars.layouts : sidecars.settings;
  const activeName = kind === "layout" ? sidecars.activeLayout : sidecars.activeSetting;
  const names = variants.map((v) => v.name);

  // Run a mutation then refresh the merged view; surface failures as toasts
  // (the backend maps bad names / collisions to HTTP 400 with a message).
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshSidecars();
    } catch (e: any) {
      addNotification("error", e?.message || "Variant operation failed");
    }
  };

  const onSwitch = (name: string) => {
    setOpen(false);
    run(() => switchVariant(kind, name));
  };

  // Seed (or overwrite) a variant's file from current model state. `variant`
  // undefined targets the unsuffixed Default sidecar. `useAutoLayout` re-snaps
  // layout to a fresh dagre pass (reset) vs. keeping the on-screen positions
  // (add). `applyToCanvas` re-applies the seed to the live view when the
  // variant the user is touching is the active one.
  const seedVariant = async (
    variant: string | undefined,
    useAutoLayout: boolean,
    applyToCanvas: boolean,
  ) => {
    if (!filePath) return;
    const { nodes, edges } = useModelStore.getState();
    if (kind === "layout") {
      const positions = useAutoLayout
        ? autoLayoutPositions(nodes, edges)
        : layoutPositionsFromNodes(nodes);
      await saveLayoutVariant(filePath, positions, variant);
      if (applyToCanvas) applyLayoutPositions(positions);
    } else {
      const labels = labelsSeedFromNodes(nodes);
      if (Object.keys(labels).length === 0) {
        throw new Error("No labelable ports in the current model");
      }
      await saveLabelsVariant(filePath, labels, variant);
      if (applyToCanvas) setModelLabels(labels as unknown as ModelLabels);
    }
  };

  const onAdd = () => {
    const input = window.prompt(
      `New ${KIND_LABEL[kind].toLowerCase()} variant name (leave blank for the default file):`,
      "",
    );
    if (input === null) return; // cancelled
    const name = input.trim();
    run(async () => {
      if (name === "" || name === "Default") {
        // Blank → create/seed the conventional unsuffixed Default sidecar
        // ("Default" is reserved, so it can't go through createVariant).
        await seedVariant(undefined, false, true);
      } else {
        await createVariant(filePath, kind, name);
        await seedVariant(name, false, true);
      }
    });
  };

  const onReset = (name: string) => {
    if (
      !window.confirm(
        `Reset ${KIND_LABEL[kind].toLowerCase()} variant "${name}" to defaults from the current model? This overwrites its contents.`,
      )
    )
      return;
    const variant = name === "Default" ? undefined : name;
    run(() => seedVariant(variant, kind === "layout", name === activeName));
  };

  const onDuplicate = (name: string) => {
    const to = window.prompt(`Duplicate "${name}" as:`, `${name}-copy`)?.trim();
    if (!to) return;
    run(() => duplicateVariant(filePath, kind, name, to));
  };

  const onRename = (name: string) => {
    const to = window.prompt(`Rename "${name}" to:`, name)?.trim();
    if (!to || to === name) return;
    run(() => renameVariant(filePath, kind, name, to));
  };

  const onDelete = (name: string) => {
    if (!window.confirm(`Delete ${KIND_LABEL[kind].toLowerCase()} variant "${name}"? This removes its file.`)) return;
    run(() => deleteVariant(filePath, kind, name));
  };

  const onMove = (name: string, dir: -1 | 1) => {
    const i = names.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= names.length) return;
    const next = [...names];
    [next[i], next[j]] = [next[j], next[i]];
    run(() => reorderVariants(filePath, kind, next));
  };

  const filtered = query
    ? variants.filter((v) => v.name.toLowerCase().includes(query.toLowerCase()))
    : variants;

  const buttonLabel = activeName ?? "Default";

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        data-testid="sidecar-variant-button"
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: "var(--pnv-fs-11)",
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
        title={`Switch or manage ${KIND_LABEL[kind].toLowerCase()} variants`}
      >
        <span style={{ color: "var(--pnv-text-faint)" }}>{KIND_LABEL[kind]}:</span>
        <span>{buttonLabel}</span>
        <span style={{ color: "var(--pnv-text-faint)", fontSize: "var(--pnv-fs-9)" }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="sidecar-variant-menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 2,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            zIndex: Z_MENU,
            minWidth: 220,
            padding: "4px 0",
          }}
        >
          {variants.length > 5 && (
            <div style={{ padding: "4px 8px" }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontSize: "var(--pnv-fs-11)",
                  padding: "3px 6px",
                  border: "1px solid var(--pnv-border-light)",
                  borderRadius: 3,
                }}
              />
            </div>
          )}
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.map((v) => {
              const isActive = v.name === activeName;
              return (
                <div
                  key={v.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    background: isActive ? "var(--pnv-primary-tint)" : "none",
                  }}
                >
                  <span style={{ width: 10, color: "var(--pnv-primary)" }}>{isActive ? "●" : ""}</span>
                  <button
                    onClick={() => !v.missing && onSwitch(v.name)}
                    disabled={v.missing}
                    title={v.missing ? "File missing — can't activate" : "Set active"}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      border: "none",
                      background: "none",
                      cursor: v.missing ? "not-allowed" : "pointer",
                      fontSize: "var(--pnv-fs-12)",
                      fontFamily: "monospace",
                      color: v.missing ? "var(--pnv-danger)" : "var(--pnv-text-body)",
                    }}
                  >
                    {v.name}
                    {v.missing && <span style={{ fontStyle: "italic" }}> (missing)</span>}
                  </button>
                  <RowBtn title="Move up" onClick={() => onMove(v.name, -1)}>↑</RowBtn>
                  <RowBtn title="Move down" onClick={() => onMove(v.name, 1)}>↓</RowBtn>
                  {!v.missing && (
                    <RowBtn title="Reset to defaults" onClick={() => onReset(v.name)}>↺</RowBtn>
                  )}
                  <RowBtn title="Rename" onClick={() => onRename(v.name)}>✎</RowBtn>
                  <RowBtn title="Duplicate" onClick={() => onDuplicate(v.name)}>⧉</RowBtn>
                  <RowBtn title="Delete" onClick={() => onDelete(v.name)}>✕</RowBtn>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "6px 12px", fontSize: "var(--pnv-fs-11)", color: "var(--pnv-text-faint)" }}>No matches</div>
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--pnv-border-faint)", marginTop: 4 }}>
            <button
              onClick={onAdd}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: "var(--pnv-fs-12)",
                color: "var(--pnv-primary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--pnv-primary-tint)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              + Add {KIND_LABEL[kind].toLowerCase()} variant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RowBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: "var(--pnv-fs-11)",
        color: "var(--pnv-text-hint)",
        padding: "0 2px",
        lineHeight: 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--pnv-primary)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--pnv-text-hint)")}
    >
      {children}
    </button>
  );
}
