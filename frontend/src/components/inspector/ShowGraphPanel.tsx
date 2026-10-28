/**
 * ShowGraphPanel — renders PsyNeuLink's native show_graph() output as SVG,
 * for visual comparison with the React Flow graph and for views the React
 * Flow renderer doesn't (yet) support — notably show_pytorch=True, the
 * autodiff-flattened view of an AutodiffComposition.
 *
 * Supports zoom/pan via scroll wheel and buttons.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useModelStore, selectExecPath } from "@/stores/modelStore";

interface ShowGraphOptions {
  show_cim: boolean;
  show_controller: boolean;
  show_learning: boolean;
  show_node_structure: boolean;
  show_types: boolean;
  show_dimensions: boolean;
  show_projection_labels: boolean;
  show_pytorch: boolean;
}

const DEFAULT_OPTIONS: ShowGraphOptions = {
  show_cim: false,
  show_controller: true,
  show_learning: false,
  show_node_structure: false,
  show_types: false,
  show_dimensions: false,
  show_projection_labels: false,
  show_pytorch: false,
};

const OPTION_LABELS: Record<keyof ShowGraphOptions, string> = {
  show_cim: "CIMs",
  show_controller: "Controller",
  show_learning: "Learning",
  show_node_structure: "Node Structure",
  show_types: "Types",
  show_dimensions: "Dimensions",
  show_projection_labels: "Projection Labels",
  show_pytorch: "PyTorch View",
};

// PyTorch view is only meaningful for AutodiffComposition subclasses.
const AUTODIFF_ONLY_OPTIONS: Set<keyof ShowGraphOptions> = new Set(["show_pytorch"]);

interface ShowGraphPanelProps {
  /** Whether the tab is showing. The panel stays mounted while hidden. */
  active: boolean;
}

export function ShowGraphPanel({ active }: ShowGraphPanelProps) {
  const filePath = useModelStore((s) => s.filePath);
  // #1029: run what the user is looking at. While the buffer has unsaved
  // edits this is the preview file, not the model on disk.
  const execPath = useModelStore(selectExecPath);
  const compositionNames = useModelStore((s) => s.compositionNames);
  const activeComposition = useModelStore((s) => s.activeComposition);
  const compositionMeta = useModelStore((s) => s.compositionMeta);
  const nodes = useModelStore((s) => s.nodes);

  const [options, setOptions] = useState<ShowGraphOptions>(DEFAULT_OPTIONS);
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const fetchIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const compositionName =
    activeComposition || compositionNames[compositionNames.length - 1] || null;

  const activeIsAutodiff = !!(compositionName && compositionMeta[compositionName]?.isAutodiff);

  const fetchShowGraph = useCallback(async () => {
    if (!filePath || !compositionName) return;

    // show_pytorch is an AutodiffComposition-only kwarg; a plain Composition's
    // show_graph rejects it at any value, so omit the key entirely (not just
    // set it false) for non-autodiff comps (#437).
    const effectiveOptions: Partial<ShowGraphOptions> = { ...options };
    if (!activeIsAutodiff) delete effectiveOptions.show_pytorch;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const resp = await fetch("/api/model/show-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: execPath,
          composition_name: compositionName,
          options: effectiveOptions,
        }),
      });

      if (fetchId !== fetchIdRef.current) return;

      if (!resp.ok) {
        const err = await resp.json();
        setError(err.detail || "show_graph request failed");
        setSvg(null);
        return;
      }

      const data = await resp.json();
      setSvg(data.svg);
      setZoom(0.5); // Reset zoom on new SVG
      setPan({ x: 0, y: 0 });
    } catch (e: any) {
      if (fetchId === fetchIdRef.current) {
        setError(e.message || "show_graph request failed");
        setSvg(null);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [filePath, compositionName, options, activeIsAutodiff]);

  // Fetch only while the tab is showing (#22). The panel stays mounted when
  // hidden, and each fetch reloads the model in the model runner, which
  // handles one request at a time: a hidden fetch on every model open made
  // the "Like show_graph" layout wait about 2 s behind it. Opening the tab
  // fetches once, if anything changed since the picture it already has.
  // A model change that adds or removes boxes needs a new picture too.
  const nodeCount = nodes.length;
  const fetchedFor = useRef<{ fetch: typeof fetchShowGraph; nodeCount: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const last = fetchedFor.current;
    if (last && last.fetch === fetchShowGraph && last.nodeCount === nodeCount) return;
    fetchedFor.current = { fetch: fetchShowGraph, nodeCount };
    fetchShowGraph();
  }, [active, fetchShowGraph, nodeCount]);

  // Live zoom/pan for the imperative wheel/drag handlers (avoids stale
  // closures). Pan is a translate offset applied with the scale transform —
  // CSS scale() doesn't grow the layout box, so a scroll container can't pan a
  // zoomed SVG; a transform offset (like React Flow) is the correct approach.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Wheel + trackpad-pinch zoom, anchored at the cursor (#703). Pinch arrives
  // as a wheel event with ctrlKey set, so both paths zoom. Depends on `svg`
  // because the container only mounts once an SVG has rendered.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const z = zoomRef.current;
      const z2 = Math.min(3, Math.max(0.1, z - e.deltaY * 0.0015 * z));
      if (z2 === z) return;
      // Keep the content point under the cursor fixed: solve pan so that
      // (cursor - pan)/z == (cursor - newPan)/z2.
      const p = panRef.current;
      setPan({
        x: cx - ((cx - p.x) / z) * z2,
        y: cy - ((cy - p.y) / z) * z2,
      });
      setZoom(z2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svg]);

  // Drag to pan (#703) — shifts the translate offset, matching React Flow.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.style.cursor = "grabbing";
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = "grab";
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [svg]);

  const toggleOption = (key: keyof ShowGraphOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!filePath) {
    return (
      <div style={{ padding: 16, color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-13)" }}>
        Load a model to see its show_graph output.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontSize: "var(--pnv-fs-13)",
      }}
    >
      {/* Option toggles */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--pnv-border-faint)",
          flexShrink: 0,
        }}
      >
        {(Object.keys(OPTION_LABELS) as (keyof ShowGraphOptions)[])
          .filter((key) => !AUTODIFF_ONLY_OPTIONS.has(key) || activeIsAutodiff)
          .map((key) => (
            <label
              key={key}
              style={{
                fontSize: "var(--pnv-fs-11)",
                color: "var(--pnv-text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggleOption(key)}
                style={{ margin: 0 }}
              />
              {OPTION_LABELS[key]}
            </label>
          ))}
        <button
          onClick={fetchShowGraph}
          disabled={loading}
          style={{
            fontSize: "var(--pnv-fs-11)",
            padding: "2px 8px",
            background: "var(--pnv-surface-sunken)",
            border: "1px solid var(--pnv-border-light)",
            borderRadius: 3,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Zoom controls */}
      {svg && (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            padding: "4px 12px",
            borderBottom: "1px solid var(--pnv-border-faint)",
            flexShrink: 0,
            fontSize: "var(--pnv-fs-11)",
            color: "var(--pnv-text-muted)",
          }}
        >
          <button
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            style={zoomBtnStyle}
          >
            -
          </button>
          <span style={{ minWidth: 42, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
            style={zoomBtnStyle}
          >
            +
          </button>
          <button
            onClick={() => {
              setZoom(0.5);
              setPan({ x: 0, y: 0 });
            }}
            style={{ ...zoomBtnStyle, width: "auto", padding: "1px 8px" }}
          >
            Fit
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            style={{ ...zoomBtnStyle, width: "auto", padding: "1px 8px" }}
          >
            100%
          </button>
          <span style={{ marginLeft: 8, color: "var(--pnv-text-faint)" }}>
            Scroll/pinch to zoom · drag to pan
          </span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div
          style={{
            padding: 8,
            margin: "8px 12px",
            background: "var(--pnv-danger-tint)",
            color: "var(--pnv-danger)",
            borderRadius: 4,
            fontSize: "var(--pnv-fs-12)",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* SVG display with zoom/pan */}
      {loading && !svg && (
        <div style={{ padding: "12px 16px", color: "var(--pnv-text-hint)", fontSize: "var(--pnv-fs-12)" }}>
          Rendering show_graph...
        </div>
      )}
      {svg && (
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "hidden",
            background: "var(--pnv-surface-muted)",
            cursor: "grab",
            position: "relative",
          }}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              padding: 8,
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  fontSize: "var(--pnv-fs-13)",
  width: 24,
  height: 22,
  border: "1px solid var(--pnv-border-light)",
  borderRadius: 3,
  background: "var(--pnv-surface)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
