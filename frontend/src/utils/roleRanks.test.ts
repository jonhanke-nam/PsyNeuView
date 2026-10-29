import { describe, expect, it } from "vitest";

import { acyclicEdges, roleAwareRanks, type RankEdge, type RankNode } from "./roleRanks";

const n = (id: string, ...roles: string[]): RankNode => ({ id, roles });
const e = (source: string, target: string, feedback = false): RankEdge => ({
  source, target, feedback,
});

describe("acyclicEdges", () => {
  it("breaks a control loop at the control projection, not the task's own edges (#9)", () => {
    // TASK feeds HIDDEN feeds OUTPUT; OUTPUT feeds MONITOR feeds CONTROL; CONTROL modulates TASK.
    const nodes = ["CONTROL", "INPUT", "OUTPUT", "MONITOR", "TASK", "HIDDEN"].map((id) => n(id));
    const control: RankEdge = { source: "CONTROL", target: "TASK", control: true };
    const kept = acyclicEdges(nodes, [
      control,
      e("INPUT", "HIDDEN"),
      e("HIDDEN", "OUTPUT"),
      e("OUTPUT", "MONITOR"),
      e("MONITOR", "CONTROL"),
      e("TASK", "HIDDEN"),
    ]);
    expect(kept).toContainEqual(e("TASK", "HIDDEN"));
    expect(kept).not.toContainEqual(control);
  });
  it("keeps a control projection that closes no cycle", () => {
    const control: RankEdge = { source: "LC", target: "A", control: true };
    expect(acyclicEdges([n("LC"), n("A")], [control])).toContainEqual(control);
  });

  it("drops edges marked as feedback", () => {
    const kept = acyclicEdges([n("a"), n("b")], [e("a", "b"), e("b", "a", true)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].source).toBe("a");
  });

  /** PsyNeuLink does not always mark every back-edge. */
  it("drops an unmarked edge that closes a cycle", () => {
    const kept = acyclicEdges([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c"), e("c", "a")]);
    expect(kept).toHaveLength(2);
  });

  it("drops a self-loop", () => {
    expect(acyclicEdges([n("a")], [e("a", "a")])).toHaveLength(0);
  });

  it("keeps a diamond, which is acyclic despite two paths", () => {
    const kept = acyclicEdges(
      [n("a"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")],
    );
    expect(kept).toHaveLength(4);
  });
});

describe("roleAwareRanks", () => {
  it("pins inputs first and outputs last", () => {
    const { ranks } = roleAwareRanks(
      [n("in", "INPUT"), n("mid"), n("out", "OUTPUT")],
      [e("in", "mid"), e("mid", "out")],
    );
    expect(ranks.in).toBe(0);
    expect(ranks.mid).toBeGreaterThan(ranks.in);
    expect(ranks.out).toBeGreaterThan(ranks.mid);
  });

  /** The Botvinick failure: a node placed below something it feeds. */
  it("never ranks a node above one that feeds it", () => {
    const { ranks } = roleAwareRanks(
      [n("input", "INPUT"), n("hidden"), n("response", "OUTPUT")],
      [e("input", "hidden"), e("hidden", "response")],
    );
    expect(ranks.hidden).toBeLessThan(ranks.response);
  });

  /** Longest path, not shortest: a node sits below *everything* feeding it. */
  it("uses the longest path when one exists", () => {
    const { ranks } = roleAwareRanks(
      [n("a", "INPUT"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("b", "c"), e("c", "d"), e("a", "d")],
    );
    // d is fed by both a (1 hop) and c (3 hops) — it must sit below c.
    expect(ranks.d).toBeGreaterThan(ranks.c);
  });

  /** The case graph-depth ranking cannot answer at all. */
  it("ranks a recurrent model without the cycle breaking it", () => {
    const { ranks } = roleAwareRanks(
      [n("in", "INPUT"), n("a", "CYCLE"), n("b", "CYCLE"), n("out", "OUTPUT")],
      [e("in", "a"), e("a", "b"), e("b", "a"), e("b", "out")],
    );
    expect(Object.keys(ranks)).toHaveLength(4);
    expect(Object.values(ranks).every((r) => Number.isFinite(r))).toBe(true);
    expect(ranks.in).toBe(0);
    expect(ranks.out).toBeGreaterThan(ranks.a);
  });

  it("puts every input on the same rank, however deep the graph says", () => {
    const { ranks } = roleAwareRanks(
      [n("i1", "INPUT"), n("i2", "INPUT"), n("mid")],
      [e("i1", "i2"), e("i2", "mid")],
    );
    expect(ranks.i1).toBe(0);
    expect(ranks.i2).toBe(0);
  });

  it("treats a node that is both input and output as an input", () => {
    // Pinning it to both ends is impossible; first wins, which keeps the
    // "inputs start the diagram" reading intact.
    const { ranks } = roleAwareRanks([n("solo", "INPUT", "OUTPUT"), n("x")], [e("solo", "x")]);
    expect(ranks.solo).toBe(0);
  });

  it("leaves no gaps between ranks", () => {
    const { ranks } = roleAwareRanks(
      [n("in", "INPUT"), n("a"), n("b"), n("out", "OUTPUT")],
      [e("in", "a"), e("a", "b"), e("b", "out")],
    );
    const used = [...new Set(Object.values(ranks))].sort((x, y) => x - y);
    expect(used).toEqual(used.map((_, i) => i));
  });

  it("handles a model with no roles at all", () => {
    const { ranks } = roleAwareRanks([n("a"), n("b")], [e("a", "b")]);
    expect(ranks.a).toBe(0);
    expect(ranks.b).toBe(1);
  });

  it("survives an empty model", () => {
    expect(roleAwareRanks([], [])).toEqual({ ranks: {}, rankCount: 0 });
  });

  it("ranks an isolated node rather than dropping it", () => {
    const { ranks } = roleAwareRanks([n("in", "INPUT"), n("lonely")], []);
    expect(ranks.lonely).toBeDefined();
  });
});
