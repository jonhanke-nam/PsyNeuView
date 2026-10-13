import { describe, it, expect } from "vitest";
import { routeAroundObstacles, routeWaypoints, type Pt, type Rect, expandedCorners } from "./edgeRouter";

// Parse an SVG path emitted by the "straight" renderer ("M x y L x y L ...")
// into its vertex list. Only the straight style is a pure polyline, so these
// geometry assertions always route with style: "straight".
function parsePolyline(d: string): Pt[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

// Is point p strictly inside rect r (with a tiny inset so boundary touching is OK)?
function pointInRect(p: Pt, r: Rect, inset = 0.5): boolean {
  return p.x > r.x + inset && p.x < r.x + r.w - inset
    && p.y > r.y + inset && p.y < r.y + r.h - inset;
}

// Does segment a→b penetrate rect r? Sampled — plenty for a unit test.
function segEntersRect(a: Pt, b: Pt, r: Rect): boolean {
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (pointInRect({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return true;
  }
  return false;
}

describe("routeAroundObstacles: no node crossing", () => {
  it("detours a straight shot that would pass through a node", () => {
    const s: Pt = { x: 100, y: 400 };
    const t: Pt = { x: 700, y: 400 };
    // Obstacle straddling the direct line y=400.
    const obstacle: Rect = { x: 350, y: 370, w: 120, h: 60 };
    const d = routeAroundObstacles(s, t, [obstacle], { style: "straight" });
    expect(d).not.toBeNull();
    const pts = parsePolyline(d!);
    expect(pts.length).toBeGreaterThan(2); // it actually bent
    // No vertex sits inside the obstacle, and no segment penetrates it.
    for (const p of pts) expect(pointInRect(p, obstacle)).toBe(false);
    for (let i = 0; i < pts.length - 1; i++) {
      expect(segEntersRect(pts[i], pts[i + 1], obstacle)).toBe(false);
    }
  });

  // #1364: obstacles were filtered to the box spanned by the endpoints, so a
  // detour that swung outside that box could run through a node the router
  // never considered. Here the cheap way round the blocker is to the right,
  // and a second node sits on that side, beside the s–t box rather than in it.
  it("avoids a node that lies on the detour but outside the endpoints' box", () => {
    const s: Pt = { x: 0, y: 0 };
    const t: Pt = { x: 0, y: 400 };
    const blocker: Rect = { x: -100, y: 180, w: 130, h: 40 }; // straddles x=0
    const beside: Rect = { x: 35, y: 60, w: 85, h: 90 }; // clear of x in [-20, 20]
    const obstacles = [blocker, beside];
    for (const routed of [
      parsePolyline(routeAroundObstacles(s, t, obstacles, { style: "straight" })!),
      [s, ...routeWaypoints(s, t, obstacles), t],
    ]) {
      expect(routed.length).toBeGreaterThan(2);
      for (let i = 0; i < routed.length - 1; i++) {
        for (const o of obstacles) expect(segEntersRect(routed[i], routed[i + 1], o)).toBe(false);
      }
    }
  });

  it("returns null (defer to caller) when the direct line is already clear", () => {
    const d = routeAroundObstacles({ x: 0, y: 0 }, { x: 400, y: 0 }, [], {});
    expect(d).toBeNull();
  });
});

describe("routeWaypoints ⇔ rendered path (handle alignment, #962)", () => {
  it("waypoints are exactly the interior vertices of the straight rendered path", () => {
    const s: Pt = { x: 100, y: 400 };
    const t: Pt = { x: 700, y: 400 };
    const obstacle: Rect = { x: 350, y: 370, w: 120, h: 60 };
    const wps = routeWaypoints(s, t, [obstacle]);
    const rendered = parsePolyline(routeAroundObstacles(s, t, [obstacle], { style: "straight" })!);
    const interior = rendered.slice(1, -1); // drop the fixed endpoints
    expect(wps.length).toBe(interior.length);
    wps.forEach((w, i) => {
      expect(w.x).toBeCloseTo(interior[i].x, 6);
      expect(w.y).toBeCloseTo(interior[i].y, 6);
    });
  });

  it("a laned (bowed) edge's waypoint coincides with its rendered bend", () => {
    const s: Pt = { x: 100, y: 100 };
    const t: Pt = { x: 500, y: 100 };
    const wps = routeWaypoints(s, t, [], { lateralOffset: 16 });
    const rendered = parsePolyline(
      routeAroundObstacles(s, t, [], { style: "straight", lateralOffset: 16 })!,
    );
    const interior = rendered.slice(1, -1);
    expect(wps.length).toBe(interior.length);
    expect(wps.length).toBeGreaterThan(0); // the bow introduced a bend
    wps.forEach((w, i) => {
      expect(w.x).toBeCloseTo(interior[i].x, 6);
      expect(w.y).toBeCloseTo(interior[i].y, 6);
    });
  });
});

describe("lateral bow separates parallel edges (no edge-edge overlap, #944)", () => {
  it("opposite offsets push two co-linear edges at least a lane gap apart mid-span", () => {
    const s: Pt = { x: 100, y: 100 };
    const t: Pt = { x: 500, y: 100 }; // horizontal → perpendicular is vertical
    const up = parsePolyline(routeAroundObstacles(s, t, [], { style: "straight", lateralOffset: 16 })!);
    const down = parsePolyline(routeAroundObstacles(s, t, [], { style: "straight", lateralOffset: -16 })!);
    // midpoint bend of each
    const midUp = up[Math.floor(up.length / 2)];
    const midDown = down[Math.floor(down.length / 2)];
    // they bow to opposite sides, ≥ one lane gap (16px) apart
    expect(Math.abs(midUp.y - midDown.y)).toBeGreaterThanOrEqual(16);
    expect(Math.sign(midUp.y - 100)).toBe(-Math.sign(midDown.y - 100));
  });
});

describe("expandedCorners (#1019)", () => {
  it("reports the user's waypoints and the corners it inserts", () => {
    // An obstacle squarely between the waypoint and the target, so the leg
    // waypoint→target cannot run straight.
    const obstacles = [{ x: 180, y: 40, w: 120, h: 60 }];
    const corners = expandedCorners(
      [
        { x: 0, y: 0 },     // source
        { x: 120, y: 70 },  // the user's waypoint
        { x: 400, y: 70 },  // target
      ],
      obstacles,
    );

    const user = corners.filter((c) => !c.forced);
    const inserted = corners.filter((c) => c.forced);

    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({ x: 120, y: 70 });
    // The regression this guards: a leg that has to route around a node
    // contributes corners, and they must be reported so the handle layer can
    // put a dot on each. Listing only user waypoints left them ungrabbable.
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("reports only the caller's own waypoints when nothing is in the way", () => {
    expect(
      expandedCorners([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], []),
    ).toEqual([{ x: 50, y: 50, forced: false }]);
  });

  it("has no interior corners for a clear two-point path", () => {
    expect(expandedCorners([{ x: 0, y: 0 }, { x: 100, y: 0 }], [])).toEqual([]);
  });
});
