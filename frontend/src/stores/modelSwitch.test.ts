/**
 * Switching to a model that does not build replaces what is shown (#386).
 *
 * #1030 holds the last good graph while a file is being edited, so a broken
 * keystroke doesn't blank the canvas. That hold used to apply to any load, so
 * opening a *different* model that failed to build left the previous model's
 * graph, title and Inspector up, looking current. Only the same file holds.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useModelStore } from "./modelStore";

function model(name: string, nodes: string[]) {
  return {
    compositions: [
      {
        kind: "composition",
        varName: name,
        name,
        nodes: nodes.map((n) => ({ varName: n, name: n, type: "TransferMechanism" })),
        projections: [],
      },
    ],
    lineMap: {},
  };
}

const COHEN_HUSTON = model("Bidirectional Stroop Model", ["COLOR INPUT", "RESPONSE"]);
const BROKEN = { compositions: [], lineMap: {}, error: "this model does not build", errorLine: 4 };

function open(path: string, data: unknown, source = `# ${path}`) {
  const s = useModelStore.getState();
  s.setFilePath(path);
  s.setSource(source);
  s.loadModelFromServer(data);
}

function names() {
  return useModelStore.getState().nodes.map((n) => n.id);
}

describe("switching to a model that does not build (#386)", () => {
  beforeEach(() => {
    useModelStore.setState({
      filePath: "", nodes: [], edges: [], modelError: null, modelErrorLine: null,
      graphIsStale: false, source: "", savedSource: "",
      compositionNames: [], compositionDisplayNames: {},
      lastGoodSource: null, lastGoodAt: null,
    });
  });

  it("clears the previous model's graph and shows the error", () => {
    open("/m/Cohen_Huston1994.py", COHEN_HUSTON);
    expect(names().length).toBeGreaterThan(0);

    open("/m/broken.py", BROKEN);

    const s = useModelStore.getState();
    expect(s.nodes).toHaveLength(0);
    expect(s.compositionNames).toEqual([]);
    expect(s.modelError).toBe("this model does not build");
    // Nothing is held, so nothing claims to be "the last version that built".
    expect(s.graphIsStale).toBe(false);
    expect(s.lastGoodSource).toBeNull();
  });

  it("still holds the graph while the same file is edited into a broken state", () => {
    open("/m/Cohen_Huston1994.py", COHEN_HUSTON);
    const before = names();

    useModelStore.getState().loadModelFromServer(BROKEN);

    expect(names()).toEqual(before);
    expect(useModelStore.getState().graphIsStale).toBe(true);
  });

  it("does not hold for an explicit re-open of the same file", () => {
    open("/m/Cohen_Huston1994.py", COHEN_HUSTON);

    useModelStore.getState().markFreshOpen();
    useModelStore.getState().loadModelFromServer(BROKEN);

    expect(useModelStore.getState().nodes).toHaveLength(0);
    expect(useModelStore.getState().modelError).toBe("this model does not build");
  });

  it("replaces the graph when the next model builds", () => {
    open("/m/Cohen_Huston1994.py", COHEN_HUSTON);
    open("/m/broken.py", BROKEN);
    open("/m/Gilzenrat.py", model("Composition", ["LC"]));

    expect(names()).toEqual(["LC"]);
    expect(useModelStore.getState().modelError).toBeNull();
  });
});

describe("a save that comes back after another model opened (#386)", () => {
  it("does not put the saved model's graph over the new one", async () => {
    open("/m/a.py", model("A", ["a"]), "a = 1");
    useModelStore.setState({ source: "a = 2" });
    let answer: (r: Response) => void = () => {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => new Promise<Response>((r) => { answer = r; })) as typeof fetch;
    try {
      const saving = useModelStore.getState().flushBuffer();
      open("/m/b.py", model("B", ["b"]));
      answer(new Response(JSON.stringify({ model: model("A", ["a"]) })));
      expect(await saving).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(useModelStore.getState().filePath).toBe("/m/b.py");
    expect(names()).toEqual(["b"]);
  });
});
