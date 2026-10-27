import { useState, useCallback, useEffect, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import "@xyflow/react/dist/style.css";

import { useGraphSettings } from "./stores/graphSettingsStore";
import { useNodeOutlineStore } from "./stores/nodeOutlineStore";
import { useEdgeLineStore } from "./stores/edgeLineStore";
import { loadRuntimeRenderingDefaults } from "./config/renderingDefaults";
import { GraphCanvas } from "./components/graph/GraphCanvas";
import { CodeEditor } from "./components/editor/CodeEditor";
import { InspectorPanel } from "./components/inspector/InspectorPanel";
import { RunPanel } from "./components/inspector/RunPanel";
import { LearnPanel } from "./components/inspector/LearnPanel";
import { ShowGraphPanel } from "./components/inspector/ShowGraphPanel";
import { RunStatePanel } from "./components/inspector/RunStatePanel";
import { GraphStylePanel } from "./components/graph/GraphStylePanel";
import { SchedulerPanel } from "./components/scheduler/SchedulerPanel";
import { Toolbar } from "./components/layout/Toolbar";
import { BusyIndicator } from "./components/common/BusyIndicator";
import { NotificationBar } from "./components/common/NotificationBar";
import { StatusBar } from "./components/common/StatusBar";
import { TourBar } from "./components/common/TourBar";
import { OrientationOffer } from "./components/common/OrientationOffer";
import { DiagnosticPanel } from "./components/common/DiagnosticPanel";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useShowGraphLayout } from "./hooks/useShowGraphLayout";
import { useLayeredLayoutFit } from "./hooks/useLayeredLayoutFit";
import { ExternalChangeModal } from "./components/common/ExternalChangeModal";
import { ChangesSinceSaveDialog } from "./components/common/ChangesSinceSaveDialog";
import { RevertToSaveDialog } from "./components/common/RevertToSaveDialog";
import { registerCommand } from "./shortcuts/commands";
import { useAppShortcuts } from "./shortcuts/useAppShortcuts";
import { useModelStore } from "./stores/modelStore";
import { useNotificationStore } from "./stores/notificationStore";
import { useLayoutStore } from "./stores/layoutStore";
import { importModelFiles } from "./utils/importModelFiles";
import { SyncIndicator } from "./components/common/SyncIndicator";
import { installDiagnostics, noteUiFact } from "./utils/diagnostics";

type BottomTab = "inspector" | "scheduler" | "run" | "learn" | "runstate" | "showgraph" | "style";

export default function App() {
  const [bottomTab, setBottomTab] = useState<BottomTab>("inspector");
  const [dragOver, setDragOver] = useState(false);
  const codeVisible = useLayoutStore((s) => s.codeVisible);
  const graphVisible = useLayoutStore((s) => s.graphVisible);
  const bottomVisible = useLayoutStore((s) => s.bottomVisible);
  const outerSizes = useLayoutStore((s) => s.outerSizes);
  const innerSizes = useLayoutStore((s) => s.innerSizes);
  const setOuterSizes = useLayoutStore((s) => s.setOuterSizes);
  const setInnerSizes = useLayoutStore((s) => s.setInnerSizes);
  const toggleBottom = useLayoutStore((s) => s.toggleBottom);
  const { pendingChange, acceptPendingChange, dismissPendingChange } = useFileWatcher();
  useShowGraphLayout();
  useLayeredLayoutFit();
  useAppShortcuts();

  // #1112: Cmd+I shows the Inspector, the Mac convention for Show Inspector.
  // Registered here because App owns which bottom tab is selected.
  useEffect(
    () => registerCommand("inspector.focus", () => setBottomTab("inspector")),
    []
  );

  // #1287: once the app has loaded, `window.__pnvDiagnostics` answers with a
  // snapshot of the page's state and the activity log, for Report a Problem
  // in the Mac app and Settings ▸ About ▸ Download diagnostics in a browser.
  useEffect(() => installDiagnostics(), []);
  useEffect(() => noteUiFact({ activeBottomTab: bottomTab }), [bottomTab]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    // Shared with the Open menu's "Import model or project…" (#1068), so the
    // two entry points cannot drift apart.
    await importModelFiles(Array.from(e.dataTransfer.files), "drop");
  }, []);

  // Listen for file drops forwarded from CodeMirror (which intercepts drops)
  // #912: apply an optional runtime rendering-defaults override at startup
  // (/rendering-defaults.json) so the look can be retuned without a rebuild.
  useEffect(() => {
    void loadRuntimeRenderingDefaults().then((o) => {
      const s = useGraphSettings.getState();
      if (typeof o.arrowheadSize === "number") s.setArrowheadSize(o.arrowheadSize);
      if (typeof o.arrowheadPosition === "number") s.setArrowheadPosition(o.arrowheadPosition);
      // The node outline retunes only the default: a width chosen in Settings wins (#42).
      useNodeOutlineStore.getState().setDefault(o.nodeBorderWidth);
      // Likewise the line width between nodes (#107).
      useEdgeLineStore.getState().setDefault(o.arrowLineThickness);
    });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail?.files as File[];
      if (!files?.length) return;
      const fakeEvent = {
        preventDefault: () => {},
        dataTransfer: { files },
      } as unknown as React.DragEvent;
      handleFileDrop(fakeEvent);
    };
    window.addEventListener("psynewview:file-drop", handler);
    return () => window.removeEventListener("psynewview:file-drop", handler);
  }, [handleFileDrop]);

  return (
    <ReactFlowProvider>
      <div
        style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}
        onDragOver={(e) => {
          // Only intercept OS file drags — palette drags use a custom MIME
          // type and have their own drop target on the canvas.
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        {/* Drop overlay — captures the actual drop event */}
        {dragOver && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            style={{
              position: "absolute",
              inset: 0,
              background: "color-mix(in srgb, var(--pnv-primary) 8%, transparent)",
              border: "3px dashed var(--pnv-primary)",
              borderRadius: 8,
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--pnv-primary)", pointerEvents: "none" }}>
              Drop .py or .pnlproject file to import
            </div>
          </div>
        )}
        <Toolbar />
        <DiagnosticPanel />
        <NotificationBar />
        <StatusBar />
        {/* #1028: always present, so "nothing is happening" and "nothing is
            connected" stop looking the same. */}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px" }}>
          <SyncIndicator />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Allotment
            defaultSizes={outerSizes}
            onChange={(sizes) => {
              // Only persist proportions when both top-level panes are present;
              // a hidden pane reports size 0 and would clobber the saved split.
              if (codeVisible) setOuterSizes(sizes);
            }}
          >
            <Allotment.Pane minSize={200} visible={codeVisible}>
              {/* Stable handle for the editor pane: the guided walkthroughs point at it (#1310). */}
              <div data-testid="code-editor-pane" style={{ height: "100%" }}>
                <CodeEditor />
              </div>
            </Allotment.Pane>
            <Allotment.Pane minSize={300}>
              <Allotment
                vertical
                defaultSizes={innerSizes}
                onChange={(sizes) => {
                  if (graphVisible && bottomVisible) setInnerSizes(sizes);
                }}
              >
                <Allotment.Pane minSize={200} visible={graphVisible}>
                  <GraphCanvas />
                  {/* #38: the wheel where the result will appear. */}
                  <BusyIndicator placement="canvas" />
                </Allotment.Pane>
                <Allotment.Pane minSize={100} preferredSize={250} visible={bottomVisible}>
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    {/* Tab bar */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        borderBottom: "1px solid var(--pnv-border-faint)",
                        background: "var(--pnv-surface-muted)",
                      }}
                    >
                      <TabButton
                        label="Inspector"
                        active={bottomTab === "inspector"}
                        onClick={() => setBottomTab("inspector")}
                      />
                      {/* Composition-wide scheduler workspace (#380): mode,
                          derived execution order, condition roster, termination. */}
                      <TabButton
                        label="Scheduler"
                        active={bottomTab === "scheduler"}
                        onClick={() => setBottomTab("scheduler")}
                      />
                      <TabButton
                        label="Run"
                        active={bottomTab === "run"}
                        onClick={() => setBottomTab("run")}
                      />
                      {/* Async training jobs (#534/#536): kept as its own tab
                          until the Run|Learn mode merge into RunPanel (#534
                          follow-up) can land without colliding with in-flight
                          RunPanel work. */}
                      <TabButton
                        label="Learn"
                        active={bottomTab === "learn"}
                        onClick={() => setBottomTab("learn")}
                      />
                      {/* Run State tab — the unified "what's happening at
                          the active step" view (#355). Picks up traceStep
                          + snapshot data + per-node values so the user has
                          one place to look during stepping. */}
                      <TabButton
                        label="Run State"
                        active={bottomTab === "runstate"}
                        onClick={() => setBottomTab("runstate")}
                      />
                      {/* TODO: show_graph tab is slated for future deprecation.
                          Keeping for now as a comparison view against the main graph. */}
                      <TabButton
                        label="show_graph"
                        active={bottomTab === "showgraph"}
                        onClick={() => setBottomTab("showgraph")}
                      />
                      <TabButton
                        label="Style"
                        active={bottomTab === "style"}
                        onClick={() => setBottomTab("style")}
                      />
                      {/* Collapse the bottom panel (#226). Blocked by the store
                          when it's the last visible pane. */}
                      <button
                        onClick={toggleBottom}
                        title="Collapse this panel"
                        style={{
                          marginLeft: "auto",
                          marginRight: 6,
                          padding: "2px 8px",
                          fontSize: 13,
                          lineHeight: 1,
                          color: "var(--pnv-text-hint)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {"⌄"}
                      </button>
                    </div>
                    {/* Tab content — both panels stay mounted to preserve state */}
                    <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
                      <div data-testid="panel-inspector" style={{ display: bottomTab === "inspector" ? "block" : "none", height: "100%" }}>
                        <InspectorPanel />
                      </div>
                      <div data-testid="panel-scheduler" style={{ display: bottomTab === "scheduler" ? "block" : "none", height: "100%" }}>
                        <SchedulerPanel />
                      </div>
                      <div data-testid="panel-run" style={{ display: bottomTab === "run" ? "block" : "none", height: "100%" }}>
                        <RunPanel />
                      </div>
                      <div data-testid="panel-learn" style={{ display: bottomTab === "learn" ? "block" : "none", height: "100%" }}>
                        <LearnPanel />
                      </div>
                      <div data-testid="panel-run-state" style={{ display: bottomTab === "runstate" ? "block" : "none", height: "100%" }}>
                        <RunStatePanel />
                      </div>
                      <div style={{ display: bottomTab === "showgraph" ? "block" : "none", height: "100%" }}>
                        <ShowGraphPanel active={bottomTab === "showgraph"} />
                      </div>
                      <div style={{ display: bottomTab === "style" ? "block" : "none", height: "100%" }}>
                        <GraphStylePanel />
                      </div>
                    </div>
                  </div>
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>
          </Allotment>
        </div>

        {/* What the unsaved changes are, against the file on disk (#1348). */}
        <ChangesSinceSaveDialog />
        <RevertToSaveDialog />
        {/* The file changed underneath unsaved edits — ask, never guess (#926). */}
        {pendingChange && (
          <ExternalChangeModal
            filePath={pendingChange.filePath}
            onLoadFromDisk={acceptPendingChange}
            onKeepMyEdits={dismissPendingChange}
          />
        )}
        {/* Reserved region for a running walkthrough (#1181): a real row,
            so the app shrinks to make space instead of being covered. Renders
            nothing when no walkthrough is running. */}
        <TourBar />
        {/* The one-time offer of the orientation walkthroughs (#1310). */}
        <OrientationOffer />
      </div>
    </ReactFlowProvider>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      // Stable handle for the tabs: "Run State" -> tab-run-state. Tests and
      // guided walkthroughs both need to point at a tab without matching on
      // its visible label, which is free to be reworded.
      data-testid={`tab-${label.toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        padding: "6px 16px",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        color: active ? "var(--pnv-primary)" : "var(--pnv-text-muted)",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid var(--pnv-primary)" : "2px solid transparent",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
