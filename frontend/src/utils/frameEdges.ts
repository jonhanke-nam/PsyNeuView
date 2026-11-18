/**
 * Projections through an open composition's boundary end on the member
 * inside, not on the frame (#209).
 *
 * PsyNeuLink wires a projection into a nested composition to the composition's
 * input CIM, and one out of it from its output CIM, so the backend names the
 * composition as the projection's end, with the CIM port as its handle
 * (`INPUT_CIM_<member>_<port>` or `OUTPUT_CIM_<member>_<port>`). Folded to one
 * node, that is where the edge belongs. Open, show_graph draws the projection
 * straight to the member the port carries to (or from), and so should the
 * canvas: ended on the frame, the edge stopped on the frame's outline in empty
 * space, wherever a layout or a drag had put the frame. Only the Like
 * show_graph layout's courses carried it on to the member, and only until
 * something moved (#23, #73).
 *
 * So, before layout, each such edge is redirected to the member and its port.
 * The edge keeps its id and its projection data (the Inspector still shows the
 * projection as PsyNeuLink has it); only where it is drawn changes. A frame
 * within a frame is followed inward the same way, as PsyNeuLink names the
 * outer port after the inner one's.
 */

import type { Edge, Node } from "@xyflow/react";

type Prefix = "INPUT_CIM_" | "OUTPUT_CIM_";

interface End {
  id: string;
  handle: string | undefined;
}

const portNames = (n: Node | undefined, kind: "inputPorts" | "outputPorts"): string[] => {
  const ports = (n?.data as Record<string, { name?: string }[] | undefined> | undefined)?.[kind];
  return (ports ?? []).map((p) => p.name ?? "").filter(Boolean);
};

/**
 * The node and port an edge end really belongs to. An end on an open frame's
 * CIM port goes to the member the port is named for, with the member's own
 * port when the member has one of that name (else no port, so React Flow
 * uses the member's first). Any other end is itself.
 */
export function memberEnd(
  id: string,
  handle: string | null | undefined,
  prefix: Prefix,
  byId: Map<string, Node>,
  nodes: Node[],
): End {
  const node = byId.get(id);
  if (node?.type !== "compositionNode" || !handle?.startsWith(prefix)) {
    return { id, handle: handle ?? undefined };
  }
  const rest = handle.slice(prefix.length);
  // The longest name that fits, so `a_b` wins over `a` for `a_b_InputPort-0`.
  const member = nodes
    .filter((n) => n.parentId === id && rest.startsWith(`${n.id}_`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!member) return { id, handle };
  const port = rest.slice(member.id.length + 1);
  if (member.type === "compositionNode") return memberEnd(member.id, port, prefix, byId, nodes);
  const known = portNames(member, prefix === "INPUT_CIM_" ? "inputPorts" : "outputPorts");
  return { id: member.id, handle: known.includes(port) ? port : undefined };
}

/**
 * Redirect every projection edge that ends on an open frame's CIM port to the
 * member inside. Edits the edges in place; returns the ids of those changed.
 */
export function retargetFrameEdges(nodes: Node[], edges: Edge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const changed: string[] = [];
  for (const edge of edges) {
    if (edge.type !== "projectionEdge") continue;
    const source = memberEnd(edge.source, edge.sourceHandle, "OUTPUT_CIM_", byId, nodes);
    const target = memberEnd(edge.target, edge.targetHandle, "INPUT_CIM_", byId, nodes);
    if (source.id === edge.source && target.id === edge.target) continue;
    edge.source = source.id;
    edge.sourceHandle = source.handle;
    edge.target = target.id;
    edge.targetHandle = target.handle;
    changed.push(edge.id);
  }
  return changed;
}
