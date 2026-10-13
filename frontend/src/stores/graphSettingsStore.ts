/**
 * Zustand store for graph display settings (toggles for show_graph parity features).
 */

import { create } from "zustand";
import { RENDERING_DEFAULTS } from "@/config/renderingDefaults";

export type GraphDirection = "TB" | "BT" | "LR" | "RL";

// Which auto-layout engine arranges the graph (#415). "layered" is the
// original Dagre sugiyama-style DAG (the `direction` setting orients it);
// "radial" and "force" are distinct algorithms that ignore direction.
export type LayoutStyle = "layered" | "radial" | "force";

// How single (non-bundled) projection edges are routed between ports.
// Bundled edges sharing a port always fan out as bowed beziers regardless,
// so they stay individually distinguishable (#278).
export type EdgeRouting = "straight" | "smoothstep" | "spline";

// What the edge-style menu calls each one (#1299). Only the labels are plain
// words: the values above are saved in layout files and settings, so they
// keep their original names.
export const EDGE_ROUTING_OPTIONS: { value: EdgeRouting; label: string; hint: string }[] = [
  { value: "straight", label: "Angled", hint: "Straight segments that bend at angles around nodes" },
  { value: "smoothstep", label: "Step", hint: "Horizontal and vertical segments with rounded corners" },
  { value: "spline", label: "Smooth", hint: "Flowing curves" },
];

interface GraphSettings {
  colorByRole: boolean;
  showDimensions: boolean;
  showProjectionLabels: boolean;
  showArrowheads: boolean;
  // Granular name visibility (#320). Projection/arrow names are covered by
  // showProjectionLabels above; these add structure and element names.
  showNodeNames: boolean;      // structure names (mechanism / composition labels)
  showNodeElements: boolean;   // per-node element names: type/role badges, function name
  edgeRouting: EdgeRouting;
  // #902 (DOF b): bend edges around nodes they would otherwise pass through.
  avoidNodes: boolean;
  // #902 (DOF c): attach edges at the oval boundary facing the other node.
  floatingPorts: boolean;
  // Lever 2: spread the attachment points of edges that share a hub (same
  // source+port fan-out) around the oval so the fan leaves as distinct,
  // de-crowded branches instead of overlapping. Requires floatingPorts.
  bundleEdges: boolean;
  // #955/#956 spacing knobs, tunable live:
  //   edgeLaneGap       — px between parallel/fanned edges (hub spread + bow).
  //   edgeNodeClearance — px a routed edge keeps clear of node boxes it detours.
  edgeLaneGap: number;
  edgeNodeClearance: number;
  // Arrow appearance (#319). Global across all projection edges.
  arrowLineThickness: number;      // scales each edge's per-type base width; 2 = unchanged
  arrowheadSize: number;           // chevron half-length, px
  arrowheadPosition: number;       // fractional position along the path, 0=source .. 1=target
  // #912: node oval border widths (px), parameterized so they can be tuned live
  // + via the runtime rendering-defaults override.
  nodeBorderWidth: number;         // ordinary roles
  nodeBorderWidthEmphasis: number; // INPUT/OUTPUT/CONTROL… (bold roles)
  showController: boolean;
  showLearning: boolean;
  showInactive: boolean;
  showCIMs: boolean;
  showFullTypes: boolean;
  showPortDots: boolean;
  // Flat view (#658): inline every nested composition into a single graph
  // (drill-down view off). Forces a model reload — serialize_composition runs
  // in flat mode — so it lives with the other graph-rebuilding toggles.
  flat: boolean;
  // PyTorch view (#230): the autodiff-flattened graph (AutodiffComposition
  // only). A specialization of `flat`; the two are mutually exclusive in the UI.
  pytorch: boolean;
  // Annotate each node with its execution phase (consideration-set rank),
  // derived from the scheduler's consideration queue (#386). Read-only.
  showExecutionOrder: boolean;
  direction: GraphDirection;
  layoutStyle: LayoutStyle;
  expandedNodes: Set<string>;
  collapsedCompositions: Set<string>;
  // Nested compositions rendered as a framed inset: internals shown, but laid
  // out as an independent mini-graph and treated as one opaque unit by the
  // parent layout (#427). Mutually exclusive with collapsedCompositions.
  insetCompositions: Set<string>;
  // Nested compositions we've already applied the collapse-by-default to.
  // A first-seen guard so the expand toggle (which triggers a model reload)
  // isn't clobbered by re-seeding on every load (#395).
  seededCollapseDefaults: Set<string>;

  // Custom styling
  customRoleColors: Record<string, string> | null;
  customEdgeColors: Record<string, string> | null;

  setColorByRole: (v: boolean) => void;
  setShowDimensions: (v: boolean) => void;
  setShowProjectionLabels: (v: boolean) => void;
  setShowArrowheads: (v: boolean) => void;
  setShowNodeNames: (v: boolean) => void;
  setShowNodeElements: (v: boolean) => void;
  setEdgeRouting: (v: EdgeRouting) => void;
  setAvoidNodes: (v: boolean) => void;
  setFloatingPorts: (v: boolean) => void;
  setEdgeLaneGap: (v: number) => void;
  setEdgeNodeClearance: (v: number) => void;
  setArrowLineThickness: (v: number) => void;
  setArrowheadSize: (v: number) => void;
  setArrowheadPosition: (v: number) => void;
  setNodeBorderWidth: (v: number) => void;
  setNodeBorderWidthEmphasis: (v: number) => void;
  setShowController: (v: boolean) => void;
  setShowLearning: (v: boolean) => void;
  setShowInactive: (v: boolean) => void;
  setShowCIMs: (v: boolean) => void;
  setShowFullTypes: (v: boolean) => void;
  setShowPortDots: (v: boolean) => void;
  setFlat: (v: boolean) => void;
  setPytorch: (v: boolean) => void;
  setShowExecutionOrder: (v: boolean) => void;
  setDirection: (v: GraphDirection) => void;
  setLayoutStyle: (v: LayoutStyle) => void;
  toggleExpandedNode: (id: string) => void;
  toggleCollapsedComposition: (id: string) => void;
  toggleInsetComposition: (id: string) => void;
  // Collapse any not-yet-seen nested composition on first load (#395).
  seedDefaultCollapsed: (names: string[]) => void;
  // Forget seeded names so a newly opened file re-applies the default.
  resetCollapseSeed: () => void;
  expandAllNodes: (labels: string[]) => void;
  collapseAllNodes: () => void;
  setCustomRoleColors: (v: Record<string, string> | null) => void;
  setCustomEdgeColors: (v: Record<string, string> | null) => void;
  setBundleEdges: (v: boolean) => void;
}

export const useGraphSettings = create<GraphSettings>((set, get) => ({
  colorByRole: true,
  showDimensions: false,
  showProjectionLabels: false,
  showArrowheads: true,
  showNodeNames: true,
  showNodeElements: true,
  edgeRouting: "straight",
  avoidNodes: true,
  floatingPorts: true,
  bundleEdges: true,
  edgeLaneGap: 16,
  edgeNodeClearance: 20,
  // #912: seeded from the rendering-defaults config (show_graph parity),
  // runtime-overridable via /rendering-defaults.json.
  arrowLineThickness: RENDERING_DEFAULTS.arrowLineThickness,
  arrowheadSize: RENDERING_DEFAULTS.arrowheadSize,
  arrowheadPosition: RENDERING_DEFAULTS.arrowheadPosition,
  nodeBorderWidth: RENDERING_DEFAULTS.nodeBorderWidth,
  nodeBorderWidthEmphasis: RENDERING_DEFAULTS.nodeBorderWidthEmphasis,
  showController: true,
  showLearning: false,
  showInactive: false,
  showCIMs: false,
  showFullTypes: false,
  showPortDots: true,
  flat: false,
  pytorch: false,
  showExecutionOrder: false,
  direction: "BT",
  layoutStyle: "layered",
  expandedNodes: new Set<string>(),
  collapsedCompositions: new Set<string>(),
  insetCompositions: new Set<string>(),
  seededCollapseDefaults: new Set<string>(),
  customRoleColors: null,
  customEdgeColors: null,

  setColorByRole: (v) => set({ colorByRole: v }),
  setShowDimensions: (v) => set({ showDimensions: v }),
  setShowProjectionLabels: (v) => set({ showProjectionLabels: v }),
  setShowArrowheads: (v) => set({ showArrowheads: v }),
  setShowNodeNames: (v) => set({ showNodeNames: v }),
  setShowNodeElements: (v) => set({ showNodeElements: v }),
  setEdgeRouting: (v) => set({ edgeRouting: v }),
  setAvoidNodes: (v) => set({ avoidNodes: v }),
  setFloatingPorts: (v) => set({ floatingPorts: v }),
  setBundleEdges: (v) => set({ bundleEdges: v }),
  setEdgeLaneGap: (v) => set({ edgeLaneGap: v }),
  setEdgeNodeClearance: (v) => set({ edgeNodeClearance: v }),
  setArrowLineThickness: (v) => set({ arrowLineThickness: v }),
  setArrowheadSize: (v) => set({ arrowheadSize: v }),
  setArrowheadPosition: (v) => set({ arrowheadPosition: v }),
  setNodeBorderWidth: (v) => set({ nodeBorderWidth: v }),
  setNodeBorderWidthEmphasis: (v) => set({ nodeBorderWidthEmphasis: v }),
  setShowController: (v) => set({ showController: v }),
  setShowLearning: (v) => set({ showLearning: v }),
  setShowInactive: (v) => set({ showInactive: v }),
  setShowCIMs: (v) => set({ showCIMs: v }),
  setShowFullTypes: (v) => set({ showFullTypes: v }),
  setShowPortDots: (v) => set({ showPortDots: v }),
  setFlat: (v) => set({ flat: v }),
  setPytorch: (v) => set({ pytorch: v }),
  setShowExecutionOrder: (v) => set({ showExecutionOrder: v }),
  setDirection: (v) => set({ direction: v }),
  setLayoutStyle: (v) => set({ layoutStyle: v }),
  toggleExpandedNode: (id) => {
    const next = new Set(get().expandedNodes);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ expandedNodes: next });
  },
  toggleCollapsedComposition: (id) => {
    const next = new Set(get().collapsedCompositions);
    if (next.has(id)) {
      next.delete(id);
      set({ collapsedCompositions: next });
    } else {
      next.add(id);
      // Collapsed and inset are mutually exclusive display modes.
      const inset = new Set(get().insetCompositions);
      inset.delete(id);
      set({ collapsedCompositions: next, insetCompositions: inset });
    }
  },
  toggleInsetComposition: (id) => {
    const next = new Set(get().insetCompositions);
    if (next.has(id)) {
      next.delete(id);
      set({ insetCompositions: next });
    } else {
      next.add(id);
      // Inset and collapsed are mutually exclusive display modes.
      const collapsed = new Set(get().collapsedCompositions);
      collapsed.delete(id);
      set({ insetCompositions: next, collapsedCompositions: collapsed });
    }
  },
  seedDefaultCollapsed: (names) => {
    const seeded = get().seededCollapseDefaults;
    const fresh = names.filter((n) => !seeded.has(n));
    if (fresh.length === 0) return;
    const nextCollapsed = new Set(get().collapsedCompositions);
    const nextSeeded = new Set(seeded);
    for (const n of fresh) { nextCollapsed.add(n); nextSeeded.add(n); }
    set({ collapsedCompositions: nextCollapsed, seededCollapseDefaults: nextSeeded });
  },
  resetCollapseSeed: () => set({ seededCollapseDefaults: new Set<string>() }),
  expandAllNodes: (labels) => {
    set({ expandedNodes: new Set(labels) });
  },
  collapseAllNodes: () => {
    set({ expandedNodes: new Set<string>() });
  },
  setCustomRoleColors: (v) => set({ customRoleColors: v }),
  setCustomEdgeColors: (v) => set({ customEdgeColors: v }),
}));
