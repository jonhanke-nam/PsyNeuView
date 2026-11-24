/** The newest model open wins (#386). */

import { beforeEach, describe, expect, it } from "vitest";

import { useModelStore } from "@/stores/modelStore";
import { beginModelOpen, isNewestModelOpen, withStillShowing } from "./modelOpenSequence";

/** An answer that arrives when the test says so. */
function later<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** The shape of every open: take a ticket, wait for the answer, apply it if newest. */
async function openModel(name: string, answer: Promise<string>, shown: string[]) {
  const ticket = beginModelOpen();
  const model = await answer;
  if (!isNewestModelOpen(ticket)) return;
  shown.push(`${name}:${model}`);
}

describe("model open tickets", () => {
  it("only the newest ticket is current", () => {
    const first = beginModelOpen();
    expect(isNewestModelOpen(first)).toBe(true);
    const second = beginModelOpen();
    expect(isNewestModelOpen(first)).toBe(false);
    expect(isNewestModelOpen(second)).toBe(true);
  });

  it("a slow older answer arriving last is dropped", async () => {
    const shown: string[] = [];
    const slow = later<string>();
    const fast = later<string>();
    const a = openModel("Cohen_Huston1994", slow.promise, shown);
    const b = openModel("Gilzenrat", fast.promise, shown);
    fast.resolve("built");
    slow.resolve("built");
    await Promise.all([a, b]);
    expect(shown).toEqual(["Gilzenrat:built"]);
  });

  it("an older answer arriving first is dropped too, not shown in passing", async () => {
    const shown: string[] = [];
    const first = later<string>();
    const second = later<string>();
    const a = openModel("Nieuwenhuis", first.promise, shown);
    const b = openModel("Stroop", second.promise, shown);
    first.resolve("built");
    await a;
    second.resolve("built");
    await b;
    expect(shown).toEqual(["Stroop:built"]);
  });

  it("three quick opens show only the last", async () => {
    const shown: string[] = [];
    const answers = [later<string>(), later<string>(), later<string>()];
    const opens = ["A", "B", "C"].map((n, i) => openModel(n, answers[i].promise, shown));
    answers[2].resolve("built");
    answers[0].resolve("built");
    answers[1].resolve("built");
    await Promise.all(opens);
    expect(shown).toEqual(["C:built"]);
  });
});

describe("a failed open says which model is still open", () => {
  beforeEach(() => useModelStore.setState({ filePath: "", bundleOrigin: null }));

  it("names the open model", () => {
    useModelStore.setState({ filePath: "/models/Cohen_Huston1994.py" });
    expect(withStillShowing("Failed to load: File not found: /x/missing.py")).toBe(
      "Failed to load: File not found: /x/missing.py. Nothing new was opened: Cohen_Huston1994.py is still the open model.",
    );
  });

  it("names a bundle by the bundle, not its working copy", () => {
    useModelStore.setState({ filePath: "/tmp/work/m.py", bundleOrigin: "/models/m.pnlproject" });
    expect(withStillShowing("Failed to open bundle: bad zip.")).toMatch(/: m\.pnlproject is still the open model\.$/);
  });

  it("says nothing more when no model is open", () => {
    expect(withStillShowing("Failed to load: nope.")).toBe("Failed to load: nope");
  });
});
