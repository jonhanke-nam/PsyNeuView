/**
 * Compact toolbar above the graph canvas with display toggles and layout controls.
 * Extracted from the former NodePalette.tsx.
 *
 * Common, at-a-glance controls stay inline. The less-frequent structural
 * toggles (Controller / Learning / CIMs / Inactive — each rebuilds the
 * graph), the Flip X/Y reflections, and Expand/Collapse All live in a
 * single "More" overflow menu so the bar stays scannable (#338).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useModelStore, usesFlatPositions } from "@/stores/modelStore";
import { EDGE_ROUTING_OPTIONS, useGraphSettings } from "@/stores/graphSettingsStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { applyLayout } from "@/utils/layout";
import { applyShowGraphLayoutNow } from "@/hooks/useShowGraphLayout";
import { LAYOUT_STYLES } from "@/stores/graphLayoutDefaultStore";
import { useDismiss } from "@/components/common/dialog/useDismiss";
import { MENU_ROW_HOVER, menuRowColours, toggleColours } from "@/components/common/toolbarStyles";
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";

export function GraphToolbar() {
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const autoLayout = useModelStore((s) => s.autoLayout);
  const setAutoLayout = useModelStore((s) => s.setAutoLayout);

  const colorByRole = useGraphSettings((s) => s.colorByRole);
  const showDimensions = useGraphSettings((s) => s.showDimensions);
  const showProjectionLabels = useGraphSettings((s) => s.showProjectionLabels);
  const showNodeNames = useGraphSettings((s) => s.showNodeNames);
  const showNodeElements = useGraphSettings((s) => s.showNodeElements);
  const showArrowheads = useGraphSettings((s) => s.showArrowheads);
  const edgeRouting = useGraphSettings((s) => s.edgeRouting);
  const bundleEdges = useGraphSettings((s) => s.bundleEdges);
  const showControllerToggle = useGraphSettings((s) => s.showController);
  const showLearning = useGraphSettings((s) => s.showLearning);
  const showInactive = useGraphSettings((s) => s.showInactive);
  const showCIMs = useGraphSettings((s) => s.showCIMs);
  const showFullTypes = useGraphSettings((s) => s.showFullTypes);
  const showPortDots = useGraphSettings((s) => s.showPortDots);
  const showExecutionOrder = useGraphSettings((s) => s.showExecutionOrder);
  const direction = useGraphSettings((s) => s.direction);
  const layoutStyle = useGraphSettings((s) => s.layoutStyle);

  const paletteOpen = usePaletteStore((s) => s.isOpen);

  const reloadModel = useCallback(() => {
    if (!filePath) return;
    fetch("/api/model/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // #658: read flat fresh from the store so a just-flipped toggle reloads
      // with the new value (avoids a stale closure on the captured `flat`).
      body: JSON.stringify({
        file_path: filePath,
        flat: useGraphSettings.getState().flat,
        pytorch: useGraphSettings.getState().pytorch,
      ...showGraphLoadRequest(),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.source) setSource(data.source);
        // Pass the sidecar labels/bundle/variants the reload just fetched —
        // omitting them makes loadModelFromServer clear modelLabels, which
        // dropped the YAML port labels on every Auto↔Custom layout switch (#611).
        loadModelFromServer(data.model, data.layout, data.labels, data.bundle, data.sidecars);
      })
      .catch(() => {});
  }, [filePath, setSource, loadModelFromServer]);

  // Persist a fresh node layout to the server (shared by Reset / Flip).
  const saveLayout = useCallback(
    (nodes: { position: { x: number; y: number }; data?: unknown; id: string; type?: string }[]) => {
      if (!filePath) return;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
        if (n.id.startsWith("cluster::")) continue; // #697/#713: never persist frames
        const vn = (n.data as any)?.varName || n.id;
        positions[vn] = { x: n.position.x, y: n.position.y };
      }
      // #659: merge over the last loaded layout so a save in one view (flat or
      // nested) doesn't drop the other view's unique node positions.
      const merged = { ...useModelStore.getState().lastLayoutPositions, ...positions };
      // #719: flat / PyTorch view positions go to their own namespace.
      const body = usesFlatPositions()
        ? { file_path: filePath, flatPositions: merged }
        : { file_path: filePath, positions: merged };
      fetch("/api/model/save-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [filePath],
  );

  const flipVertical = useCallback(() => {
    const { nodes, setNodes } = useModelStore.getState();
    if (nodes.length === 0) return;
    const ys = nodes.map((n) => n.position.y);
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const flipped = nodes.map((n) => ({
      ...n,
      position: { x: n.position.x, y: 2 * centerY - n.position.y },
    }));
    setNodes(flipped);
    saveLayout(flipped);
  }, [saveLayout]);

  const flipHorizontal = useCallback(() => {
    const { nodes, setNodes } = useModelStore.getState();
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.position.x);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const flipped = nodes.map((n) => ({
      ...n,
      position: { x: 2 * centerX - n.position.x, y: n.position.y },
    }));
    setNodes(flipped);
    saveLayout(flipped);
  }, [saveLayout]);

  const expandAll = useCallback(() => {
    const labels = useModelStore.getState().nodes
      .filter((n) => n.type === "mechanismNode")
      .map((n) => (n.data as any)?.label || n.id);
    useGraphSettings.getState().expandAllNodes(labels);
  }, []);

  const collapseAll = useCallback(() => {
    useGraphSettings.getState().collapseAllNodes();
  }, []);

  if (!filePath) return null;

  // #717: Flatten / PyTorch view modes moved to the composition selector in
  // the top Toolbar (they're view-mode choices, not structural toggles).
  const moreItems: MoreItem[] = [
    {
      kind: "toggle",
      label: "Controller",
      active: showControllerToggle,
      onClick: () => {
        useGraphSettings.getState().setShowController(!showControllerToggle);
        reloadModel();
      },
      title: "Show/hide controller mechanism and control projections",
    },
    {
      kind: "toggle",
      label: "Learning",
      active: showLearning,
      onClick: () => {
        useGraphSettings.getState().setShowLearning(!showLearning);
        reloadModel();
      },
      title: "Show/hide learning mechanisms and projections",
    },
    {
      kind: "toggle",
      label: "CIMs",
      active: showCIMs,
      onClick: () => {
        useGraphSettings.getState().setShowCIMs(!showCIMs);
        reloadModel();
      },
      title: "Show/hide CompositionInterfaceMechanisms at composition boundaries",
    },
    {
      kind: "toggle",
      label: "Inactive",
      active: showInactive,
      onClick: () => {
        useGraphSettings.getState().setShowInactive(!showInactive);
        reloadModel();
      },
      title: "Show/hide inactive projections (red dashed)",
    },
    {
      kind: "toggle",
      label: "Bundle edges",
      active: bundleEdges,
      onClick: () => useGraphSettings.getState().setBundleEdges(!bundleEdges),
      title: "Spread the attachment points of edges sharing a hub so fan-outs read as distinct branches (lever 2)",
    },
    { kind: "divider" },
    {
      kind: "action",
      label: "↕ Flip Y",
      onClick: flipVertical,
      title: "Flip graph vertically (reflect across X axis)",
    },
    {
      kind: "action",
      label: "↔ Flip X",
      onClick: flipHorizontal,
      title: "Flip graph horizontally (reflect across Y axis)",
    },
    { kind: "divider" },
    {
      kind: "action",
      label: "Expand All",
      onClick: expandAll,
      title: "Expand all mechanism nodes to show ports and functions",
    },
    {
      kind: "action",
      label: "Collapse All",
      onClick: collapseAll,
      title: "Collapse all mechanism nodes to compact view",
    },
  ];

  return (
    <div
      style={{
        padding: "4px 12px",
        borderBottom: "1px solid var(--pnv-border-faint)",
        background: "var(--pnv-surface-muted)",
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {/* Palette toggle button */}
      <button
        onClick={() => usePaletteStore.getState().toggleOpen()}
        style={{
          fontSize: 13,
          padding: "3px 8px",
          ...toggleColours(paletteOpen),
          borderRadius: 4,
          // The glyph is a touch quieter than a word while off.
          ...(paletteOpen ? {} : { color: "var(--pnv-text-secondary)" }),
          cursor: "pointer",
          fontWeight: 600,
          lineHeight: 1,
        }}
        title={paletteOpen ? "Hide object palette" : "Show object palette"}
      >
        {paletteOpen ? "◨" : "◧"}
      </button>

      <span style={{ width: 1, height: 20, background: "var(--pnv-border-light)", margin: "0 4px" }} />

      <button
        onClick={() => {
          const next = !autoLayout;
          setAutoLayout(next);
          reloadModel();
        }}
        style={{
          fontSize: 11,
          padding: "3px 10px",
          ...toggleColours(autoLayout),
          borderRadius: 4,
          cursor: "pointer",
          fontWeight: autoLayout ? 600 : 400,
        }}
        title={autoLayout ? "Using auto layout — click to switch to custom layout" : "Using custom layout — click to switch to auto layout"}
      >
        Layout: {autoLayout ? "Auto" : "Custom"}
      </button>
      <button
        onClick={() => {
          // Reset = recompute the active layout engine using the *current*
          // direction setting and persist it as the new custom layout.
          // Without `direction`, Dagre falls back to its default and produces
          // a layout that doesn't match Auto mode (#97). Non-layered engines
          // ignore direction (#415).
          const { nodes, edges, setNodes } = useModelStore.getState();
          const laid = applyLayout(layoutStyle, nodes, edges, { direction });
          setNodes(laid);
          setAutoLayout(false);
          saveLayout(laid);
        }}
        style={{
          fontSize: 11,
          padding: "3px 10px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: "var(--pnv-surface)",
          cursor: "pointer",
        }}
        title="Recompute positions and save as new custom layout"
      >
        Reset Custom Layout
      </button>

      <span style={{ width: 1, height: 20, background: "var(--pnv-border-light)", margin: "0 4px" }} />

      <ToggleButton
        label="Roles"
        active={colorByRole}
        onClick={() => useGraphSettings.getState().setColorByRole(!colorByRole)}
        title="Color nodes by role (INPUT/OUTPUT/CONTROL) vs by type"
      />
      <ToggleButton
        label="Dims"
        active={showDimensions}
        onClick={() => useGraphSettings.getState().setShowDimensions(!showDimensions)}
        title="Show port dimensions on nodes"
      />
      <ToggleButton
        label="Names"
        active={showNodeNames}
        onClick={() => useGraphSettings.getState().setShowNodeNames(!showNodeNames)}
        title="Show structure names (mechanism / composition labels)"
      />
      <ToggleButton
        label="Elements"
        active={showNodeElements}
        onClick={() => useGraphSettings.getState().setShowNodeElements(!showNodeElements)}
        title="Show each node's type and role tags and its function (off by default: just the name, as in show_graph)"
      />
      <ToggleButton
        label="Labels"
        active={showProjectionLabels}
        onClick={() => useGraphSettings.getState().setShowProjectionLabels(!showProjectionLabels)}
        title="Show projection (arrow) names on edges"
      />
      <ToggleButton
        label="Arrows"
        active={showArrowheads}
        onClick={() => useGraphSettings.getState().setShowArrowheads(!showArrowheads)}
        title="Show midline direction arrows on projection edges"
      />
      <select
        value={edgeRouting}
        onChange={(e) => useGraphSettings.getState().setEdgeRouting(e.target.value as any)}
        style={{
          fontSize: 11,
          padding: "2px 4px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: "var(--pnv-surface)",
        }}
        title="Edge style: Angled, Step or Smooth"
      >
        {EDGE_ROUTING_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>
      <ToggleButton
        label="Types"
        active={showFullTypes}
        onClick={() => useGraphSettings.getState().setShowFullTypes(!showFullTypes)}
        title="Show full class names in the type tag (e.g., TransferMechanism instead of Transfer); the tag shows with Elements on"
      />
      <ToggleButton
        label="Order"
        active={showExecutionOrder}
        onClick={() => useGraphSettings.getState().setShowExecutionOrder(!showExecutionOrder)}
        title="Show each node's execution phase (consideration-set rank) without running the model"
      />
      <ToggleButton
        label="Ports"
        testId="toolbar-show-ports"
        active={showPortDots}
        onClick={() => useGraphSettings.getState().setShowPortDots(!showPortDots)}
        title="Show ports: port dots on the graph (input=blue, output=green, parameter=orange) and the Ports section in Components"
      />

      <span style={{ width: 1, height: 20, background: "var(--pnv-border-light)", margin: "0 4px" }} />

      <select
        value={layoutStyle}
        onChange={(e) => {
          const style = e.target.value as any;
          useGraphSettings.getState().setLayoutStyle(style);
          if (style === "showgraph") {
            // show_graph flows bottom-to-top; turn the ports to match, then
            // fetch and apply its layout (#19).
            useGraphSettings.getState().setDirection("BT");
            void applyShowGraphLayoutNow();
            return;
          }
          const { nodes, edges, setNodes } = useModelStore.getState();
          const laid = applyLayout(style, nodes, edges, { direction });
          setNodes(laid);
        }}
        style={{
          fontSize: 11,
          padding: "2px 4px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: "var(--pnv-surface)",
        }}
        title="Auto-layout engine (Layered = Dagre DAG; Radial/Force ignore direction; Like show_graph = PsyNeuLink's show_graph arrangement)"
      >
        {LAYOUT_STYLES.map((o) => (
          <option key={o.id} value={o.id} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={direction}
        disabled={layoutStyle !== "layered"}
        onChange={(e) => {
          useGraphSettings.getState().setDirection(e.target.value as any);
          const { nodes, edges, setNodes } = useModelStore.getState();
          const laid = applyLayout(layoutStyle, nodes, edges, { direction: e.target.value as any });
          setNodes(laid);
        }}
        style={{
          fontSize: 11,
          padding: "2px 4px",
          border: "1px solid var(--pnv-border)",
          borderRadius: 4,
          background: layoutStyle === "layered" ? "var(--pnv-surface)" : "var(--pnv-surface-sunken)",
          opacity: layoutStyle === "layered" ? 1 : 0.5,
        }}
        title={
          layoutStyle === "layered"
            ? "Graph flow direction"
            : "Direction applies to the Layered engine only"
        }
      >
        <option value="TB">{"↓"} Top-Down</option>
        <option value="BT">{"↑"} Bottom-Up</option>
        <option value="LR">{"→"} Left-Right</option>
        <option value="RL">{"←"} Right-Left</option>
      </select>

      <span style={{ width: 1, height: 20, background: "var(--pnv-border-light)", margin: "0 4px" }} />

      <MoreMenu items={moreItems} />
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
  title,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      title={title}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        ...toggleColours(active),
        borderRadius: 4,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

type MoreItem =
  | { kind: "toggle"; label: string; active: boolean; onClick: () => void; title?: string }
  | { kind: "action"; label: string; onClick: () => void; title?: string }
  | { kind: "divider" };

function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Any active toggle inside the menu is surfaced on the button so the
  // user can see at a glance that something is hidden in here.
  const anyActive = items.some((i) => i.kind === "toggle" && i.active);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  // Escape closes the menu through the shared stack (#1289).
  useDismiss(open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          fontSize: 11,
          padding: "3px 8px",
          ...toggleColours(open || anyActive),
          borderRadius: 4,
          cursor: "pointer",
          fontWeight: open || anyActive ? 600 : 400,
        }}
        title="More display and layout options"
        data-testid="graph-more-button"
      >
        More {"▾"}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="graph-more-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 20,
            minWidth: 160,
            background: "var(--pnv-surface)",
            border: "1px solid var(--pnv-border)",
            borderRadius: 6,
            boxShadow: "var(--pnv-shadow-popover)",
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {items.map((item, idx) => {
            if (item.kind === "divider") {
              return (
                <span
                  key={`d${idx}`}
                  style={{ height: 1, background: "var(--pnv-border-faint)", margin: "2px 4px" }}
                />
              );
            }
            const active = item.kind === "toggle" && item.active;
            return (
              <button
                key={item.label}
                onClick={() => {
                  item.onClick();
                  // Actions close the menu; toggles stay open so the user
                  // can flip several without re-opening.
                  if (item.kind === "action") setOpen(false);
                }}
                title={item.title}
                style={{
                  fontSize: 11,
                  textAlign: "left",
                  padding: "4px 8px",
                  border: "none",
                  borderRadius: 4,
                  ...menuRowColours(active),
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = MENU_ROW_HOVER;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span>{item.label}</span>
                {item.kind === "toggle" && (
                  <span style={{ opacity: active ? 1 : 0.25 }}>
                    {active ? "✓" : "·"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
