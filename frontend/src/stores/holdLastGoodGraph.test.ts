/**
 * A model that does not build must not take the graph down with it (#1030).
 *
 * A file under edit is broken for much of the time it is being edited, and
 * every intermediate save reaches us — from an IDE through the file watcher,
 * and from our own editor. Applying a failed introspection clears the canvas
 * and discards the layout, then rebuilds a moment later when the next keystroke
 * parses. The result is flicker and a lost arrangement.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useModelStore } from "./modelStore";

const WORKING = {
  compositions: [
    {
      varName: "c",
      name: "c",
      nodes: [{ varName: "a", name: "a", type: "TransferMechanism" }],
      projections: [],
    },
  ],
  lineMap: {},
};

const BROKEN = { compositions: [], lineMap: {}, error: "invalid syntax", errorLine: 4 };

function load(model: unknown) {
  useModelStore.getState().loadModelFromServer(model);
}

describe("holding the last good graph", () => {
  beforeEach(() => {
    useModelStore.setState({
      nodes: [], edges: [], modelError: null, modelErrorLine: null,
      graphIsStale: false, source: "", savedSource: "",
    });
  });

  it("keeps the nodes when a later model fails to build", () => {
    load(WORKING);
    const before = useModelStore.getState().nodes.length;
    expect(before).toBeGreaterThan(0);

    load(BROKEN);

    expect(useModelStore.getState().nodes.length).toBe(before);
    expect(useModelStore.getState().graphIsStale).toBe(true);
    expect(useModelStore.getState().modelError).toBe("invalid syntax");
    expect(useModelStore.getState().modelErrorLine).toBe(4);
  });

  it("shows nothing when a broken file is opened cold", () => {
    // No previous graph to hold, so an empty canvas is the honest answer.
    load(BROKEN);

    expect(useModelStore.getState().nodes.length).toBe(0);
    expect(useModelStore.getState().graphIsStale).toBe(false);
    expect(useModelStore.getState().modelError).toBe("invalid syntax");
  });

  it("clears the stale mark once the file builds again", () => {
    load(WORKING);
    load(BROKEN);
    expect(useModelStore.getState().graphIsStale).toBe(true);

    load(WORKING);

    expect(useModelStore.getState().graphIsStale).toBe(false);
    expect(useModelStore.getState().modelError).toBeNull();
  });

  it("still marks the buffer saved, so the editor is not left dirty", () => {
    // applyChange sets the source before loading; a held graph must not skip
    // the baseline update or the editor comes back dirty against older text.
    load(WORKING);
    useModelStore.setState({ source: "broken text" });

    load(BROKEN);

    expect(useModelStore.getState().savedSource).toBe("broken text");
  });

  it("does not hold when the failed model still built something", () => {
    // A partial build is real content; replacing is right, and the stale mark
    // would be a lie.
    load(WORKING);
    load({ ...WORKING, error: "a warning-ish error" });

    expect(useModelStore.getState().graphIsStale).toBe(false);
  });
});

describe("checkpointing the source that built (#1154)", () => {
  beforeEach(() => {
    useModelStore.setState({
      nodes: [], edges: [], modelError: null, modelErrorLine: null,
      graphIsStale: false, source: "", savedSource: "",
      lastGoodSource: null, lastGoodAt: null,
    });
  });

  it("records the source a successful build came from", () => {
    useModelStore.setState({ source: "x = 1" });
    load(WORKING);

    expect(useModelStore.getState().lastGoodSource).toBe("x = 1");
    expect(useModelStore.getState().lastGoodAt).toBeTypeOf("number");
  });

  it("keeps the checkpoint when a later version fails", () => {
    useModelStore.setState({ source: "x = 1" });
    load(WORKING);
    useModelStore.setState({ source: "x = (" });
    load(BROKEN);

    // The whole point: the held graph and the source that produced it agree.
    expect(useModelStore.getState().lastGoodSource).toBe("x = 1");
    expect(useModelStore.getState().graphIsStale).toBe(true);
  });

  it("moves the checkpoint forward on the next successful build", () => {
    useModelStore.setState({ source: "x = 1" });
    load(WORKING);
    useModelStore.setState({ source: "x = 2" });
    load(WORKING);

    expect(useModelStore.getState().lastGoodSource).toBe("x = 2");
  });

  it("has no checkpoint before anything builds", () => {
    load(BROKEN);
    expect(useModelStore.getState().lastGoodSource).toBeNull();
  });
});

describe("an edit whose statement is skipped holds the graph (#1367)", () => {
  // Parses, fails when run: the backend skips it and builds the rest (#615).
  const SKIPPED = {
    ...WORKING,
    partialExecution: true,
    skippedStatements: [{ line: 15, error: "name 'this' is not defined" }],
  };

  beforeEach(() => {
    useModelStore.setState({
      nodes: [], edges: [], modelError: null, modelErrorLine: null,
      graphIsStale: false, source: "", savedSource: "",
      lastGoodSource: null, lastGoodAt: null, shownSkippedErrors: [], previewPath: null,
    });
  });

  function preview(model: unknown, source: string) {
    useModelStore.setState({ source });
    return useModelStore.getState().applyPreviewModel(model, "/tmp/preview.py", source);
  }

  it("holds the graph with the banner and the error, and says it did not build", () => {
    useModelStore.setState({ source: "good" });
    load(WORKING);

    expect(preview(SKIPPED, "good\nthis is not python()")).toBe(false);

    const s = useModelStore.getState();
    expect(s.graphIsStale).toBe(true);
    expect(s.modelError).toBe("name 'this' is not defined");
    expect(s.modelErrorLine).toBe(15);
    expect(s.lastGoodSource).toBe("good");
    expect(s.previewPath).toBe("/tmp/preview.py");
  });

  it("clears when the edit builds again", () => {
    useModelStore.setState({ source: "good" });
    load(WORKING);
    preview(SKIPPED, "good\nthis");

    expect(preview(WORKING, "good\n# fixed")).toBe(true);

    expect(useModelStore.getState().graphIsStale).toBe(false);
    expect(useModelStore.getState().modelError).toBeNull();
    expect(useModelStore.getState().lastGoodSource).toBe("good\n# fixed");
  });

  it("does not hold for a statement the shown build skipped too", () => {
    // A library model's driver line, skipped on every build (#796).
    load(SKIPPED);
    expect(useModelStore.getState().shownSkippedErrors).toEqual(["name 'this' is not defined"]);

    expect(preview(SKIPPED, "edited")).toBe(true);
    expect(useModelStore.getState().graphIsStale).toBe(false);
  });

  it("does not hold for a dangling projection, which draws a phantom node", () => {
    load(WORKING);
    const dangling = {
      ...SKIPPED,
      danglingProjections: [{
        varName: "p", type: "MappingProjection", line: 15, senderRef: "a",
        receiverRef: "b", missing: ["b"], missingSide: "receiver",
      }],
    };

    preview(dangling, "with a dangling projection");

    expect(useModelStore.getState().graphIsStale).toBe(false);
  });

  it("shows a partial build on open, as before: only an edit is held", () => {
    load(WORKING);
    load(SKIPPED);
    expect(useModelStore.getState().graphIsStale).toBe(false);
  });
});
