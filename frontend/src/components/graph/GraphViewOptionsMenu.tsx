/**
 * Advanced Graph View Options ▾: every view option of the graph in one
 * pop-up panel, so the graph toolbar keeps only its essentials (#123, part of
 * the clean look #109).
 *
 * It replaces the row of toolbar toggles (Roles, Dims, Names, Elements,
 * Labels, Arrows, Types, Order, Ports, the edge-style and direction selects)
 * and the More ▾ menu, whose contents are view options too. Each row is a
 * real checkbox (or select, or a small button) with a plain name and a
 * one-line hint, grouped under small headings:
 *
 *   Nodes                what each node shows; Expand / Collapse all
 *   Layout               the Layered direction, and the two flips
 *   Lines                edge style, direction arrows, line names, spreading
 *                        shared lines; a link to the scheduling arrows' one
 *                        control, in Settings ▸ Appearance
 *   What the graph shows the parts that rebuild the graph: controller,
 *                        learning, interface nodes, inactive lines
 *
 * It is persistent: flipping a toggle, picking from a select or pressing a
 * row's button leaves it open, so several can be changed in one go. Its
 * button, Escape (useDismiss), a click outside and the × in its header
 * (DialogHeader) close it, like History, the other panel anchored to a
 * button (docs/dialog-inventory.md). The values themselves live where they
 * always did, in the graph settings store.
 *
 * The panel is position: fixed under its button, so the graph pane's edges
 * don't clip it, and drawn above the panel dividers; at a narrow window its
 * two columns become one, and the body scrolls under the fixed header when
 * the window is short.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EDGE_ROUTING_OPTIONS, useGraphSettings, type GraphDirection } from "@/stores/graphSettingsStore";
import { useModelStore } from "@/stores/modelStore";
import { applyLayout } from "@/utils/layout";
import { DialogHeader } from "@/components/common/dialog/DialogHeader";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { Button } from "@/components/common/Button";
import { toggleColours } from "@/components/common/toolbarStyles";
import { openSettings } from "@/components/common/settings/sections";

interface Props {
  /** Reload the model: the "What the graph shows" options rebuild the graph. */
  reloadModel: () => void;
  flipVertical: () => void;
  flipHorizontal: () => void;
  expandAll: () => void;
  collapseAll: () => void;
}

/** Two columns from this width of window up; one below. */
const TWO_COLUMNS_FROM = 660;
const TWO_COLUMN_WIDTH = 600;
const ONE_COLUMN_WIDTH = 320;
const MARGIN = 8;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  twoColumns: boolean;
}

/** Under the button, its right edge on the button's, kept inside the window. */
function place(button: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const twoColumns = vw >= TWO_COLUMNS_FROM;
  const width = Math.min(twoColumns ? TWO_COLUMN_WIDTH : ONE_COLUMN_WIDTH, vw - 2 * MARGIN);
  const top = button.bottom + 4;
  const left = Math.max(MARGIN, Math.min(button.right - width, vw - width - MARGIN));
  return { top, left, width, maxHeight: Math.max(160, vh - top - MARGIN), twoColumns };
}

export function GraphViewOptionsMenu({ reloadModel, flipVertical, flipHorizontal, expandAll, collapseAll }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // Escape and the × hand the focus back to the button, so a keyboard user
  // carries on from where they opened it.
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Escape closes it through the shared stack (#1289).
  useDismiss(open, close);

  // A click outside closes it; a click inside (a toggle) does not. Listened
  // for in the capture phase: the canvas's pan handler stops a mousedown on
  // the pane from bubbling, and a click on the graph is the likeliest
  // "outside" there is.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (buttonRef.current) setPlacement(place(buttonRef.current.getBoundingClientRect()));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  // Opening moves the focus into the panel, so Tab reaches its options next.
  const shown = open && placement !== null;
  useEffect(() => {
    if (shown) panelRef.current?.focus({ preventScroll: true });
  }, [shown]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          fontSize: 11,
          padding: "3px 8px",
          ...toggleColours(open),
          borderRadius: 4,
          cursor: "pointer",
          fontWeight: open ? 600 : 400,
          whiteSpace: "nowrap",
        }}
        title="Names, colours, ports, lines, direction, and what the graph shows"
        data-testid="graph-view-options-button"
      >
        Advanced Graph View Options {"▾"}
      </button>
      {open &&
        placement &&
        // In document.body: the graph pane is a layer of its own, so from
        // inside it the dividers between the panels would be drawn across
        // the panel at a narrow window, whatever its z-index.
        createPortal(
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-labelledby="graph-view-options-title"
            data-testid="graph-view-options-menu"
            style={{
              position: "fixed",
              top: placement.top,
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              // Above the panel dividers (Allotment sashes, z-index 35), as the
              // main toolbar's menus are (#1391).
              zIndex: 1000,
              outline: "none",
              background: "var(--pnv-surface)",
              border: "1px solid var(--pnv-border)",
              borderRadius: 6,
              boxShadow: "var(--pnv-shadow-popover)",
              display: "flex",
              flexDirection: "column",
              textAlign: "left",
            }}
          >
            <DialogHeader title="Advanced Graph View Options" titleId="graph-view-options-title" compact onClose={close} />
            <div
              style={{
                overflowY: "auto",
                padding: "4px 12px 10px",
                display: "grid",
                gridTemplateColumns: placement.twoColumns ? "1fr 1fr" : "1fr",
                columnGap: 20,
                alignItems: "start",
              }}
            >
              <div>
                <NodesGroup expandAll={expandAll} collapseAll={collapseAll} />
                <LayoutGroup flipVertical={flipVertical} flipHorizontal={flipHorizontal} />
              </div>
              <div>
                <LinesGroup onOpenSettings={close} />
                <ContentsGroup reloadModel={reloadModel} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function NodesGroup({ expandAll, collapseAll }: { expandAll: () => void; collapseAll: () => void }) {
  const g = useGraphSettings();
  return (
    <Group title="Nodes">
      <Toggle
        testId="graph-view-option-names"
        label="Names"
        hint="The name of each node"
        checked={g.showNodeNames}
        onChange={(v) => g.setShowNodeNames(v)}
      />
      <Toggle
        testId="graph-view-option-elements"
        label="Type and role tags"
        hint="The small tags on a node, and its function"
        checked={g.showNodeElements}
        onChange={(v) => g.setShowNodeElements(v)}
      />
      <Toggle
        testId="graph-view-option-types"
        label="Full type names"
        hint="TransferMechanism rather than Transfer"
        checked={g.showFullTypes}
        onChange={(v) => g.setShowFullTypes(v)}
      />
      <Toggle
        testId="graph-view-option-roles"
        label="Colour by role"
        hint="Input, output, control… colours; off, by type"
        checked={g.colorByRole}
        onChange={(v) => g.setColorByRole(v)}
      />
      <Toggle
        testId="graph-view-option-dims"
        label="Dimensions"
        hint="The size of each port's value"
        checked={g.showDimensions}
        onChange={(v) => g.setShowDimensions(v)}
      />
      <Toggle
        testId="graph-view-option-order"
        label="Run order"
        hint="Each node's step in a run, without running"
        checked={g.showExecutionOrder}
        onChange={(v) => g.setShowExecutionOrder(v)}
      />
      {/* The one Show ports switch (#112): off by default and remembered per
          browser (graphSettingsStore); it also shows the Components panel's
          Ports section. Its test id is the one it had on the toolbar. */}
      <Toggle
        testId="toolbar-show-ports"
        label="Show ports"
        hint="Port dots on nodes, and Ports in the Components panel"
        checked={g.showPortDots}
        onChange={(v) => g.setShowPortDots(v)}
      />
      <Actions hint="Open every node to show its ports and function, or fold them all">
        <Button kind="small" onClick={expandAll} data-testid="graph-view-option-expand-all">
          Expand all
        </Button>
        <Button kind="small" onClick={collapseAll} data-testid="graph-view-option-collapse-all">
          Collapse all
        </Button>
      </Actions>
    </Group>
  );
}

function LayoutGroup({ flipVertical, flipHorizontal }: { flipVertical: () => void; flipHorizontal: () => void }) {
  const direction = useGraphSettings((s) => s.direction);
  const layoutStyle = useGraphSettings((s) => s.layoutStyle);
  const layered = layoutStyle === "layered";
  return (
    <Group title="Layout">
      <Choice
        label="Direction"
        hint={layered ? "Which way the Layered layout runs" : "For the Layered layout only"}
        htmlFor="graph-view-option-direction"
      >
        <select
          id="graph-view-option-direction"
          data-testid="graph-view-option-direction"
          value={direction}
          disabled={!layered}
          onChange={(e) => {
            const next = e.target.value as GraphDirection;
            useGraphSettings.getState().setDirection(next);
            const { nodes, edges, setNodes } = useModelStore.getState();
            setNodes(applyLayout(layoutStyle, nodes, edges, { direction: next }));
          }}
          style={selectStyle(layered)}
        >
          <option value="TB">{"↓"} Top-Down</option>
          <option value="BT">{"↑"} Bottom-Up</option>
          <option value="LR">{"→"} Left-Right</option>
          <option value="RL">{"←"} Right-Left</option>
        </select>
      </Choice>
      <Actions hint="Mirror the graph; saved as your custom layout">
        <Button kind="small" onClick={flipVertical} data-testid="graph-view-option-flip-y" title="Flip the graph vertically">
          {"↕"} Flip up–down
        </Button>
        <Button kind="small" onClick={flipHorizontal} data-testid="graph-view-option-flip-x" title="Flip the graph horizontally">
          {"↔"} Flip left–right
        </Button>
      </Actions>
    </Group>
  );
}

function LinesGroup({ onOpenSettings }: { onOpenSettings: () => void }) {
  const g = useGraphSettings();
  return (
    <Group title="Lines">
      <Choice label="Line style" hint="How lines run between nodes" htmlFor="graph-view-option-edge-style">
        <select
          id="graph-view-option-edge-style"
          data-testid="graph-view-option-edge-style"
          value={g.edgeRouting}
          onChange={(e) => g.setEdgeRouting(e.target.value as typeof g.edgeRouting)}
          style={selectStyle(true)}
        >
          {EDGE_ROUTING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
      </Choice>
      <Toggle
        testId="graph-view-option-arrows"
        label="Direction arrows"
        hint="Arrowheads on each line, pointing the way it runs"
        checked={g.showArrowheads}
        onChange={(v) => g.setShowArrowheads(v)}
      />
      <Toggle
        testId="graph-view-option-labels"
        label="Line names"
        hint="Each projection's name beside its line"
        checked={g.showProjectionLabels}
        onChange={(v) => g.setShowProjectionLabels(v)}
      />
      <Toggle
        testId="graph-view-option-bundle-edges"
        label="Spread shared lines"
        hint="Fan out lines leaving the same node, so each reads apart"
        checked={g.bundleEdges}
        onChange={(v) => g.setBundleEdges(v)}
      />
      {/* One control per setting (docs/settings-and-mac-app.md): the
          scheduling arrows' is in Settings, so this row goes there. */}
      <div style={{ padding: "4px 0" }}>
        <Button
          kind="link"
          data-testid="graph-view-option-scheduling-arrows"
          onClick={() => {
            onOpenSettings();
            openSettings("appearance");
          }}
          style={{ fontSize: 12 }}
        >
          Scheduling arrows…
        </Button>
        <div style={hintStyle}>The dashed before / after arrows: in Settings ▸ Appearance</div>
      </div>
    </Group>
  );
}

function ContentsGroup({ reloadModel }: { reloadModel: () => void }) {
  const g = useGraphSettings();
  // Each of these rebuilds the graph, so it reloads the model as it did in More ▾.
  const flip = (set: (v: boolean) => void) => (v: boolean) => {
    set(v);
    reloadModel();
  };
  return (
    <Group title="What the graph shows" note="Each rebuilds the graph">
      <Toggle
        testId="graph-view-option-controller"
        label="Controller"
        hint="The controller and its control lines"
        checked={g.showController}
        onChange={flip(g.setShowController)}
      />
      <Toggle
        testId="graph-view-option-learning"
        label="Learning"
        hint="Learning mechanisms and their lines"
        checked={g.showLearning}
        onChange={flip(g.setShowLearning)}
      />
      <Toggle
        testId="graph-view-option-cims"
        label="Interface nodes (CIMs)"
        hint="Where values enter and leave each composition"
        checked={g.showCIMs}
        onChange={flip(g.setShowCIMs)}
      />
      <Toggle
        testId="graph-view-option-inactive"
        label="Inactive lines"
        hint="Projections not in use, red and dashed"
        checked={g.showInactive}
        onChange={flip(g.setShowInactive)}
      />
    </Group>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--pnv-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          padding: "4px 0",
          borderBottom: "1px solid var(--pnv-border-faint)",
          marginBottom: 2,
        }}
      >
        {title}
        {note && (
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--pnv-text-hint)" }}>
            {" "}
            · {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** One on/off option: a real checkbox in its label, so the whole row toggles. */
function Toggle({
  testId,
  label,
  hint,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={rowStyle}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: "2px 0 0", flexShrink: 0, cursor: "pointer" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12, color: "var(--pnv-text)" }}>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </span>
    </label>
  );
}

/** An option with a select: its name and hint, the select beside them. */
function Choice({ label, hint, htmlFor, children }: { label: string; hint: string; htmlFor: string; children: ReactNode }) {
  return (
    <div style={{ ...rowStyle, cursor: "default", alignItems: "center", justifyContent: "space-between" }}>
      <label htmlFor={htmlFor} style={{ minWidth: 0, cursor: "pointer" }}>
        <span style={{ display: "block", fontSize: 12, color: "var(--pnv-text)" }}>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </label>
      {children}
    </div>
  );
}

/** A row of small buttons, with what they do under them. */
function Actions({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
      <div style={{ ...hintStyle, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  padding: "3px 0",
  cursor: "pointer",
};

const hintStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  lineHeight: 1.3,
  color: "var(--pnv-text-muted)",
};

function selectStyle(enabled: boolean): CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 4px",
    border: "1px solid var(--pnv-border)",
    borderRadius: 4,
    background: enabled ? "var(--pnv-surface)" : "var(--pnv-surface-sunken)",
    opacity: enabled ? 1 : 0.5,
    flexShrink: 0,
  };
}
