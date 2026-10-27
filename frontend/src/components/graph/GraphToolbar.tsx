/**
 * Compact toolbar above the graph canvas: the essentials only.
 * Extracted from the former NodePalette.tsx.
 *
 * On the bar: the Components panel toggle, Layout: Auto / Custom, Reset
 * Custom Layout and the layout engine. Every view option — what nodes and
 * lines show, the Layered direction, the flips, Expand / Collapse All, and
 * the parts that rebuild the graph (Controller, Learning, CIMs, Inactive),
 * which were the More menu (#338) — is in one persistent pop-up, Advanced
 * Graph View Options ▾ (GraphViewOptionsMenu, #123), so the bar stays short
 * (the clean look, #109).
 */

import { useCallback } from "react";
import { useModelStore, usesFlatPositions } from "@/stores/modelStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { usePaletteStore } from "@/stores/paletteStore";
import { applyLayout } from "@/utils/layout";
import { applyShowGraphLayoutNow } from "@/hooks/useShowGraphLayout";
import { LAYOUT_STYLES } from "@/stores/graphLayoutDefaultStore";
import { toggleColours } from "@/components/common/toolbarStyles";
import { showGraphLoadRequest } from "@/utils/showGraphLoadRequest";
import { GraphViewOptionsMenu } from "./GraphViewOptionsMenu";

export function GraphToolbar() {
  const filePath = useModelStore((s) => s.filePath);
  const setSource = useModelStore((s) => s.setSource);
  const loadModelFromServer = useModelStore((s) => s.loadModelFromServer);
  const autoLayout = useModelStore((s) => s.autoLayout);
  const setAutoLayout = useModelStore((s) => s.setAutoLayout);

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
          fontSize: "var(--pnv-fs-13)",
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
          fontSize: "var(--pnv-fs-11)",
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
          fontSize: "var(--pnv-fs-11)",
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
          fontSize: "var(--pnv-fs-11)",
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

      <span style={{ width: 1, height: 20, background: "var(--pnv-border-light)", margin: "0 4px" }} />

      <GraphViewOptionsMenu
        reloadModel={reloadModel}
        flipVertical={flipVertical}
        flipHorizontal={flipHorizontal}
        expandAll={expandAll}
        collapseAll={collapseAll}
      />
    </div>
  );
}
