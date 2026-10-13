import { describe, expect, it } from "vitest";

import { COPIED_NOTE, UPDATE_APP_NOTE, revealOrCopy, type RevealDeps } from "./revealPath";

const PATH = "/Users/me/Documents/PsyNeuView-My-Models";

function deps(over: Partial<RevealDeps>): RevealDeps & { copied: string[] } {
  const copied: string[] = [];
  return {
    hasBridge: true,
    reveal: async () => "revealed",
    copy: async (text) => {
      copied.push(text);
    },
    copied,
    ...over,
  };
}

describe("Show in Finder, and what happens when it can't (#1295)", () => {
  it("reveals through the bridge when the app knows the op", async () => {
    const d = deps({});
    expect(await revealOrCopy(PATH, d)).toEqual({ kind: "revealed" });
    expect(d.copied).toEqual([]);
  });

  it("copies the path and asks for an app update when the app is too old", async () => {
    // 0.5.15 and earlier: no `revealed: true` in the reply, however it answers.
    const d = deps({ reveal: async () => "unsupported" });
    expect(await revealOrCopy(PATH, d)).toEqual({ kind: "copied", note: UPDATE_APP_NOTE });
    expect(d.copied).toEqual([PATH]);
  });

  it("copies the path in a plain browser, without the update note", async () => {
    const d = deps({ hasBridge: false, reveal: async () => { throw new Error("no bridge"); } });
    expect(await revealOrCopy(PATH, d)).toEqual({ kind: "copied", note: COPIED_NOTE });
    expect(d.copied).toEqual([PATH]);
  });

  it("shows the app's own message when it refused", async () => {
    const d = deps({ reveal: async () => { throw new Error("There's no folder at /nowhere."); } });
    expect(await revealOrCopy("/nowhere", d)).toEqual({ kind: "failed", message: "There's no folder at /nowhere." });
    expect(d.copied).toEqual([]);
  });

  it("says so when even the clipboard is out of reach", async () => {
    const d = deps({ hasBridge: false, copy: async () => { throw new Error("blocked"); } });
    expect(await revealOrCopy(PATH, d)).toEqual({ kind: "failed", message: "Couldn't copy the path." });
  });
});
