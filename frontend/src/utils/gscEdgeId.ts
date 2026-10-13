/**
 * The canvas edge for a graph-structure condition (#1370).
 *
 * One condition draws one dashed edge per target node, so an edge's id names
 * both its endpoints (#651): `gsc_<condition id>_<source>__<target>`. The
 * Inspector's and the Scheduler tab's condition rows used to select
 * `gsc_<condition id>`, the id from before that change, which no edge has:
 * clicking a row selected nothing on the canvas.
 */

interface EdgeLike {
  id: string;
  data?: unknown;
}

/** The id of the edge drawn for condition `gscId` from `source` to `target`. */
export function gscEdgeId(gscId: string, source: string, target: string): string {
  return `gsc_${gscId}_${source}__${target}`;
}

/**
 * The edge to select for a condition row: the one to or from `node` when
 * given (a row listed under one of the condition's targets), else the
 * condition's first edge. Null when the condition draws no edge (its nodes
 * are not on the canvas).
 */
export function findGscEdgeId(edges: readonly EdgeLike[], gscId: string, node?: string): string | null {
  const ofCondition = edges.filter((e) => (e.data as { gscId?: string } | undefined)?.gscId === gscId);
  if (ofCondition.length === 0) return null;
  if (node !== undefined) {
    const touching = ofCondition.find((e) => (e.data as { targetNode?: string } | undefined)?.targetNode === node);
    if (touching) return touching.id;
  }
  return ofCondition[0].id;
}
