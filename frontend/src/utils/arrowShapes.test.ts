import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelStore } from "@/stores/modelStore";
import { useEdgeAttach } from "@/stores/edgeAttachStore";
import { useGraphSettings } from "@/stores/graphSettingsStore";
import { arrowShaped, registerArrowShapeCommit, restoreRoutes, startShapingArrow } from "./arrowShapes";

// Shaping an arrow by hand, as a step of its own (#164).

const EDGE = { id: "a_to_b", source: "a", target: "b", sourceHandle: "out", targetHandle: "in" };
const KEY = "a|out|b|in";
const BENT = { [KEY]: { waypoints: [{ x: 10, y: 20 }] } };

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  useModelStore.setState({ edges: [EDGE] as never, autoLayout: true });
  useEdgeAttach.getState().clearAll();
  useGraphSettings.setState({ flat: false, pytorch: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("a drag on an arrow in Auto", () => {
  it("makes the layout Custom", () => {
    startShapingArrow();
    expect(useModelStore.getState().autoLayout).toBe(false);
  });

  it("leaves a custom layout as it is", () => {
    useModelStore.setState({ autoLayout: false });
    startShapingArrow();
    expect(useModelStore.getState().autoLayout).toBe(false);
  });
});

describe("a reshape", () => {
  it("goes to what the canvas registered: before it starts, and by name once done", () => {
    const seen: string[] = [];
    const off = registerArrowShapeCommit({ before: () => seen.push("before"), done: (d) => seen.push(d) });
    startShapingArrow();
    arrowShaped("Reshaped arrow a_to_b");
    off();
    arrowShaped("after the canvas is gone");
    expect(seen).toEqual(["before", "Reshaped arrow a_to_b"]);
  });
});

describe("Undo reaching a step with the arrows shaped otherwise", () => {
  it("puts the route back and saves it under the nested view's key", () => {
    expect(restoreRoutes(BENT, "/m/a.py")).toBe(true);
    expect(useEdgeAttach.getState().waypoints[EDGE.id]).toEqual([{ x: 10, y: 20 }]);
    expect(useEdgeAttach.getState().shaped[EDGE.id]).toBe(true);
    expect(bodies()).toEqual([{ file_path: "/m/a.py", edgeRoutes: BENT }]);
  });

  it("saves under the flat key in the PyTorch view, leaving the nested routes alone", () => {
    useGraphSettings.setState({ pytorch: true });
    restoreRoutes(BENT, "/m/a.py");
    expect(bodies()).toEqual([{ file_path: "/m/a.py", flatEdgeRoutes: BENT }]);
  });

  it("an arrow no longer shaped goes back to its automatic route", () => {
    restoreRoutes(BENT, "/m/a.py");
    restoreRoutes({}, "/m/a.py");
    expect(useEdgeAttach.getState().waypoints).toEqual({});
    expect(bodies()[1]).toEqual({ file_path: "/m/a.py", edgeRoutes: {} });
  });

  it("writes nothing when the arrows are as the step had them", () => {
    restoreRoutes(BENT, "/m/a.py");
    expect(restoreRoutes(BENT, "/m/a.py")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
