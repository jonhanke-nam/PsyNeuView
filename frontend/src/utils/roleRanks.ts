/**
 * Rank nodes by role first, graph depth only as a fallback (#1013).
 *
 * Ranking a recurrent model by graph structure does not work, because the
 * question "what depth is this node" has no answer once a cycle exists. Six of
 * the ten bundled reference models are recurrent, so this is the common case.
 * Botvinick has four CYCLE nodes and produced a diagonal staircase with
 * COLOR HIDDEN placed *below* the RESPONSE it feeds.
 *
 * `show_graph` never hits this because it ranks by **role**: inputs pinned to
 * one end, outputs to the other, everything else left to float. It asks a
 * question that always has an answer before asking one that may not.
 *
 * This does the same, and adds a middle: depth measured on the graph with
 * feedback edges removed, which is acyclic by construction so depth is always
 * defined.
 *
 * Pure, and separate from the engine that consumes it, because the interesting
 * part is *which rank each node gets* — testable directly — rather than where
 * the pixels land.
 */

/** Roles that pin a node to the first rank. */
const FIRST = ["INPUT", "ORIGIN", "BIAS"];
/** Roles that pin a node to the last rank. */
const LAST = ["OUTPUT", "TERMINAL"];

export interface RankNode {
  id: string;
  roles?: string[];
}

export interface RankEdge {
  source: string;
  target: string;
  /** True for a feedback projection — excluded when measuring depth. */
  feedback?: boolean;
}

export interface RankResult {
  /** node id → rank, 0-based, ascending from the inputs. */
  ranks: Record<string, number>;
  /** How many ranks there are, so callers can place the last one. */
  rankCount: number;
}

const has = (node: RankNode, names: string[]) =>
  (node.roles ?? []).some((r) => names.includes(r.toUpperCase()));

/**
 * Edges that can be used to measure depth.
 *
 * Feedback edges are dropped, and so is any edge that closes a cycle among what
 * remains — PsyNeuLink does not always mark every back-edge, and one unmarked
 * cycle would make depth undefined for the whole component. Detected by a
 * depth-first walk, dropping the edge that returns to a node still on the
 * stack.
 */
export function acyclicEdges(nodes: RankNode[], edges: RankEdge[]): RankEdge[] {
  const candidates = edges.filter((e) => !e.feedback && e.source !== e.target);
  const out = new Map<string, RankEdge[]>();
  for (const e of candidates) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
  }

  const kept: RankEdge[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // unseen | on-stack | done
  const walk = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.target) ?? 0;
      if (s === 1) continue; // closes a cycle — drop it
      kept.push(e);
      if (s === 0) walk(e.target);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if ((state.get(n.id) ?? 0) === 0) walk(n.id);
  return kept;
}

/**
 * Longest-path depth from the nodes with no incoming edge.
 *
 * Longest rather than shortest so a node sits below *everything* that feeds it
 * — the property that was violated when COLOR HIDDEN landed under RESPONSE.
 */
function depths(nodes: RankNode[], edges: RankEdge[]): Map<string, number> {
  const incoming = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    out.set(n.id, []);
  }
  for (const e of edges) {
    if (!incoming.has(e.target) || !out.has(e.source)) continue;
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    out.get(e.source)!.push(e.target);
  }

  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of out.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1));
      incoming.set(next, (incoming.get(next) ?? 1) - 1);
      if ((incoming.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  return depth;
}

/** Rank every node: roles pin the ends, depth orders the middle. */
export function roleAwareRanks(nodes: RankNode[], edges: RankEdge[]): RankResult {
  if (nodes.length === 0) return { ranks: {}, rankCount: 0 };

  const firsts = nodes.filter((n) => has(n, FIRST));
  const lasts = nodes.filter((n) => has(n, LAST) && !has(n, FIRST));
  const middle = nodes.filter((n) => !has(n, FIRST) && !has(n, LAST));

  const depth = depths(nodes, acyclicEdges(nodes, edges));

  // Middle nodes keep their relative depth order, compacted so the ranks are
  // contiguous — a gap would read as an empty row nobody asked for.
  const used = [...new Set(middle.map((n) => depth.get(n.id) ?? 0))].sort((a, b) => a - b);
  const compact = new Map(used.map((d, i) => [d, i + 1]));

  const ranks: Record<string, number> = {};
  for (const n of firsts) ranks[n.id] = 0;
  for (const n of middle) ranks[n.id] = compact.get(depth.get(n.id) ?? 0) ?? 1;
  const lastRank = (used.length ? used.length : 0) + 1;
  for (const n of lasts) ranks[n.id] = lastRank;

  // With no inputs and no outputs there is nothing to pin against, so depth is
  // the whole answer and rank 0 should be usable.
  if (firsts.length === 0 && lasts.length === 0) {
    for (const n of middle) ranks[n.id] = (compact.get(depth.get(n.id) ?? 0) ?? 1) - 1;
    return { ranks, rankCount: Math.max(1, used.length) };
  }

  return { ranks, rankCount: lastRank + (lasts.length ? 1 : 0) };
}
