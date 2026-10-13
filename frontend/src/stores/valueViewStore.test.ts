/**
 * #1387: a node's "list | grid" choice, and its width, are kept in the
 * model's layout file and come back when the model is opened again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModelStore } from "./modelStore";
import { sanitizeValueViews, useValueViews, valueViewFor } from "./valueViewStore";
import { chooseValueView } from "@/utils/valueViewSave";

const MODEL = {
  compositions: [
    {
      varName: "c",
      name: "c",
      nodes: [{ varName: "hopfield", name: "hopfield", type: "RecurrentTransferMechanism" }],
      projections: [],
    },
  ],
  lineMap: {},
};

describe("value views", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    useValueViews.setState({ views: {} });
    useModelStore.setState({ filePath: "/tmp/hopfield_network.py", nodes: [], edges: [] });
    fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves a choice to the layout file, every node's at once", () => {
    chooseValueView("other", { as: "list" });
    chooseValueView("hopfield-3", { as: "grid", width: 5 });
    expect(useValueViews.getState().views).toEqual({
      other: { as: "list" },
      hopfield: { as: "grid", width: 5 },
    });
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe("/api/model/save-layout");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      file_path: "/tmp/hopfield_network.py",
      valueViews: { other: { as: "list" }, hopfield: { as: "grid", width: 5 } },
    });
  });

  it("saves nothing without an open file, but keeps the choice", () => {
    useModelStore.setState({ filePath: null });
    chooseValueView("hopfield", { as: "grid" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(valueViewFor(useValueViews.getState().views, "hopfield")).toEqual({ as: "grid" });
  });

  it("comes back from the layout file on load", () => {
    useModelStore.getState().loadModelFromServer(MODEL, { valueViews: { hopfield: { as: "grid", width: 5 } } });
    expect(useValueViews.getState().views).toEqual({ hopfield: { as: "grid", width: 5 } });
  });

  it("is cleared by a model with no choices, and kept by a load with no layout", () => {
    useValueViews.setState({ views: { hopfield: { as: "grid" } } });
    // A preview of unsaved edits, or the file watcher: no layout comes with it.
    useModelStore.getState().loadModelFromServer(MODEL);
    expect(useValueViews.getState().views).toEqual({ hopfield: { as: "grid" } });
    // Another model opened, with no layout file.
    useModelStore.getState().loadModelFromServer(MODEL, null);
    expect(useValueViews.getState().views).toEqual({});
  });

  it("finds a node's choice by any of its names", () => {
    const views = { hopfield: { as: "grid" as const } };
    expect(valueViewFor(views, undefined, "hopfield-2")).toEqual({ as: "grid" });
    expect(valueViewFor(views, "other")).toBeUndefined();
  });

  it("drops malformed entries from a layout file", () => {
    expect(
      sanitizeValueViews({
        a: { as: "grid", width: 5 },
        b: { as: "table" },
        c: { as: "grid", width: -1 },
        d: "grid",
      }),
    ).toEqual({ a: { as: "grid", width: 5 }, c: { as: "grid" } });
    expect(sanitizeValueViews(null)).toEqual({});
    expect(sanitizeValueViews([1])).toEqual({});
  });
});
