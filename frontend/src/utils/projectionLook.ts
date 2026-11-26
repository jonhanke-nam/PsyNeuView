/**
 * How a projection is drawn: its line, its colour and what it ends in, as
 * show_graph draws it (#425).
 *
 * show_graph is the gold standard (#306). It draws a control projection (any
 * projection from a ControlMechanism) as a solid line in its control colour
 * ending in a small box (`arrowhead=box`); the composition's controller's
 * projections the same in its controller colour; a learning projection in its
 * learning colour; and every other projection (a mapping projection, a node's
 * recurrent projection to itself) as a plain line ending in an arrow.
 *
 * Where the backend could ask show_graph, the model comes with show_graph's
 * own edges (`showGraphEdges`, read from its description), and those decide
 * the arrowhead, line and colour; the type rule below stands in where it
 * couldn't, and for the edges show_graph doesn't draw (learning shown, the
 * interfaces).
 */

export type Arrowhead = "normal" | "box" | "none";
export type LineStyle = "solid" | "dashed" | "dotted";

export interface ProjectionLook {
  arrowhead: Arrowhead;
  line: LineStyle;
  /** A palette token, as `var(--pnv-…)`. */
  color: string;
}

/** One edge of show_graph's picture, as the backend read it (sandbox_worker.show_graph_edge_looks). */
export interface ShowGraphEdge {
  sender: string;
  receiver: string;
  arrowhead?: string;
  color?: string;
  style?: string;
  penwidth?: string;
}

/**
 * show_graph's default colour names for its edges, and the token PsyNeuView
 * draws each in. Its defaults (ShowGraph.__init__): default_node_color black,
 * control_color blue, controller_color purple, learning_color orange,
 * inactive_projection_color red, probe_color pink.
 */
export const SHOW_GRAPH_EDGE_COLORS: Record<string, string> = {
  black: "var(--pnv-projection-mapping)",
  blue: "var(--pnv-projection-control)",
  purple: "var(--pnv-projection-controller)",
  orange: "var(--pnv-projection-learning)",
  red: "var(--pnv-projection-inactive)",
  pink: "var(--pnv-role-probe)",
};

/** The dash pattern for a line style, at an ordinary line's width. */
export const LINE_DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: "6 3",
  dotted: "1.5 3",
};

const CONTROL_TYPES = new Set(["ControlProjection", "GatingProjection", "ModulatoryProjection"]);

/** show_graph's rule by type, for an edge show_graph's own picture doesn't give. */
export function projectionLookFor(type: string | undefined, opts: { fromController?: boolean; fromControl?: boolean } = {}): ProjectionLook {
  if (opts.fromController) {
    return { arrowhead: CONTROL_TYPES.has(type ?? "") ? "box" : "normal", line: "solid", color: "var(--pnv-projection-controller)" };
  }
  if (CONTROL_TYPES.has(type ?? "") || opts.fromControl) {
    return { arrowhead: "box", line: "solid", color: "var(--pnv-projection-control)" };
  }
  if (type === "LearningProjection") {
    return { arrowhead: "normal", line: "solid", color: "var(--pnv-projection-learning)" };
  }
  return { arrowhead: "normal", line: "solid", color: "var(--pnv-projection-mapping)" };
}

/** Graphviz's arrowhead names, as the canvas draws them. */
export function arrowheadFromShowGraph(name: string | undefined): Arrowhead | null {
  switch ((name ?? "").toLowerCase()) {
    case "":
      return null;
    case "box":
    case "obox":
    case "square":
      return "box";
    case "none":
      return "none";
    default:
      // normal, vee, empty, open, ...: all an arrow
      return "normal";
  }
}

/** The look show_graph's own edge gives, over the type rule's for what it leaves unsaid. */
export function lookFromShowGraph(base: ProjectionLook, sg: ShowGraphEdge | undefined): ProjectionLook {
  if (!sg) return base;
  const style = (sg.style ?? "").toLowerCase();
  return {
    arrowhead: arrowheadFromShowGraph(sg.arrowhead) ?? "normal",
    line: style.includes("dashed") ? "dashed" : style.includes("dotted") ? "dotted" : "solid",
    color: SHOW_GRAPH_EDGE_COLORS[(sg.color ?? "").toLowerCase()] ?? base.color,
  };
}

/**
 * show_graph's edges by the two nodes they join, each pair's in show_graph's
 * order, to hand out in turn to the canvas's edges between the same pair
 * (several projections can join one pair).
 */
export function showGraphEdgesByPair(edges: ShowGraphEdge[] | undefined | null): Map<string, ShowGraphEdge[]> {
  const byPair = new Map<string, ShowGraphEdge[]>();
  for (const e of edges ?? []) {
    const key = `${e.sender}\u0000${e.receiver}`;
    (byPair.get(key) ?? byPair.set(key, []).get(key)!).push(e);
  }
  return byPair;
}

/** The kinds of projection the legend names (#425), in the order it lists them. */
export type ProjectionKind = "mapping" | "control" | "controller" | "learning" | "selfloop";

export const PROJECTION_KIND_ORDER: ProjectionKind[] = ["mapping", "control", "controller", "learning", "selfloop"];

export const PROJECTION_KIND_INFO: Record<ProjectionKind, { label: string; meaning: string; color: string; arrowhead: Arrowhead }> = {
  mapping: {
    label: "projection",
    meaning: "Carries a node's output to another node's input: a line ending in an arrow, as show_graph draws it.",
    color: "var(--pnv-projection-mapping)",
    arrowhead: "normal",
  },
  control: {
    label: "control",
    meaning: "From a control mechanism: it sets a parameter of the node it ends at. show_graph's solid blue line ending in a box.",
    color: "var(--pnv-projection-control)",
    arrowhead: "box",
  },
  controller: {
    label: "controller",
    meaning: "To or from the composition's controller, in show_graph's controller colour; its control projections end in a box.",
    color: "var(--pnv-projection-controller)",
    arrowhead: "box",
  },
  learning: {
    label: "learning",
    meaning: "Part of learning: it changes the weights of a projection, in show_graph's learning colour.",
    color: "var(--pnv-projection-learning)",
    arrowhead: "normal",
  },
  selfloop: {
    label: "to itself",
    meaning: "A node's projection to itself (a recurrent projection), drawn as a loop on the node, as show_graph draws it.",
    color: "var(--pnv-projection-mapping)",
    arrowhead: "normal",
  },
};

/** Which kinds the model's projections are, for the legend. */
export function projectionKindsPresent(
  edges: { source: string; target: string; type?: string; data?: unknown; style?: { stroke?: unknown } }[],
): Set<ProjectionKind> {
  const kinds = new Set<ProjectionKind>();
  for (const e of edges) {
    if (e.type !== "projectionEdge") continue;
    const d = (e.data ?? {}) as { arrowhead?: Arrowhead; type?: string; fromController?: boolean };
    if (!d.arrowhead) continue; // PsyNeuView's own kinds (inactive, dangling)
    if (e.source === e.target) kinds.add("selfloop");
    else if (d.fromController || e.style?.stroke === "var(--pnv-projection-controller)") kinds.add("controller");
    else if (d.arrowhead === "box") kinds.add("control");
    else if (e.style?.stroke === "var(--pnv-projection-learning)") kinds.add("learning");
    else kinds.add("mapping");
  }
  return kinds;
}
