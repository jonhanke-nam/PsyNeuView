import { describe, expect, it } from "vitest";

import { ambiguousKeys, hydrateRoutes, routeKey, serializeRoutes } from "./edgeRoutes";

const edge = (id: string, s: string, t: string, sh = "out", th = "in") => ({
  id, source: s, target: t, sourceHandle: sh, targetHandle: th,
});

const A_TO_B = edge("MappingProjection from a to b", "a", "b");

describe("routeKey", () => {
  it("is derived from the endpoints, not the projection name", () => {
    const renamed = { ...A_TO_B, id: "a totally different name" };
    expect(routeKey(renamed)).toBe(routeKey(A_TO_B));
  });

  it("separates edges that differ only by port", () => {
    expect(routeKey(edge("e", "a", "b", "out1"))).not.toBe(routeKey(edge("e", "a", "b", "out2")));
  });
});

describe("what gets persisted", () => {
  /** The question this feature exists to answer. */
  it("persists an edge whose path the user dragged", () => {
    const out = serializeRoutes(
      [A_TO_B],
      { [A_TO_B.id]: true },
      { [A_TO_B.id]: [{ x: 5, y: 6 }] },
      {},
    );
    expect(out[routeKey(A_TO_B)].waypoints).toEqual([{ x: 5, y: 6 }]);
  });

  /** Promote-on-grab puts waypoints in the store before any movement. */
  it("does not persist an edge that was only grabbed", () => {
    const out = serializeRoutes([A_TO_B], {}, { [A_TO_B.id]: [{ x: 5, y: 6 }] }, {});
    expect(out).toEqual({});
  });

  it("persists a dragged connection dot", () => {
    const out = serializeRoutes([A_TO_B], { [A_TO_B.id]: true }, {}, { [A_TO_B.id]: { s: 1.2 } });
    expect(out[routeKey(A_TO_B)].ends).toEqual({ s: 1.2 });
  });

  it("writes nothing for a shaped edge left with no shaping", () => {
    // "Reset route" drops the mark, but a stale mark must not produce an entry.
    const out = serializeRoutes([A_TO_B], { [A_TO_B.id]: true }, {}, {});
    expect(out).toEqual({});
  });
});

describe("parallel edges between the same ports", () => {
  const twin = { ...A_TO_B, id: "second projection a to b" };

  it("are skipped rather than guessed at when saving", () => {
    const out = serializeRoutes(
      [A_TO_B, twin],
      { [A_TO_B.id]: true },
      { [A_TO_B.id]: [{ x: 1, y: 1 }] },
      {},
    );
    expect(out).toEqual({});
  });

  it("are skipped on load, so a route never lands on the wrong edge", () => {
    const saved = { [routeKey(A_TO_B)]: { waypoints: [{ x: 1, y: 1 }] } };
    expect(hydrateRoutes([A_TO_B, twin], saved).waypoints).toEqual({});
  });

  it("are reported by ambiguousKeys", () => {
    expect([...ambiguousKeys([A_TO_B, twin])]).toEqual([routeKey(A_TO_B)]);
  });
});

describe("hydrate", () => {
  it("round-trips a shaped edge", () => {
    const saved = serializeRoutes(
      [A_TO_B],
      { [A_TO_B.id]: true },
      { [A_TO_B.id]: [{ x: 9, y: 9 }] },
      { [A_TO_B.id]: { t: 0.4 } },
    );
    const back = hydrateRoutes([A_TO_B], saved);
    expect(back.waypoints[A_TO_B.id]).toEqual([{ x: 9, y: 9 }]);
    expect(back.overrides[A_TO_B.id]).toEqual({ t: 0.4 });
  });

  it("finds the route again after the projection was renamed", () => {
    const saved = serializeRoutes([A_TO_B], { [A_TO_B.id]: true }, { [A_TO_B.id]: [{ x: 3, y: 4 }] }, {});
    const renamed = { ...A_TO_B, id: "renamed projection" };
    expect(hydrateRoutes([renamed], saved).waypoints[renamed.id]).toEqual([{ x: 3, y: 4 }]);
  });

  it("marks restored edges as shaped, so the next save keeps them", () => {
    const saved = { [routeKey(A_TO_B)]: { waypoints: [{ x: 1, y: 2 }] } };
    const back = hydrateRoutes([A_TO_B], saved);
    expect(back.shaped[A_TO_B.id]).toBe(true);
    // ...and a save made from that state still contains the route.
    expect(serializeRoutes([A_TO_B], back.shaped, back.waypoints, back.overrides)).toEqual(saved);
  });

  it("ignores routes for edges the model no longer has", () => {
    const saved = { "gone|out|nowhere|in": { waypoints: [{ x: 0, y: 0 }] } };
    expect(hydrateRoutes([A_TO_B], saved).waypoints).toEqual({});
  });

  it("survives an absent or empty sidecar", () => {
    expect(hydrateRoutes([A_TO_B], null).waypoints).toEqual({});
    expect(hydrateRoutes([A_TO_B], {}).waypoints).toEqual({});
  });
});
