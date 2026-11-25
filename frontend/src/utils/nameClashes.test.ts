import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAME_CLASHES_SEEN_KEY, checkNameClashes, isNewClash } from "./nameClashes";
import { activityEntries, clearActivity } from "./activityLog";

const answer = {
  clashes: [{ stem: "Dup", files: ["Scripts/Examples/Dup.py", "Scripts/Examples/more/Dup.py"], kind: "source" }],
  key: "github:PrincetonUniversity/PsyNeuLink:abc123",
  message: "Model files share a name in this PsyNeuLink: Dup (Scripts/Examples/Dup.py, Scripts/Examples/more/Dup.py).",
};

describe("the name-clash notice (#422)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    clearActivity();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => answer })));
  });

  it("is new only with clashes and an unseen key", () => {
    expect(isNewClash(answer, null)).toBe(true);
    expect(isNewClash(answer, answer.key)).toBe(false);
    expect(isNewClash({ ...answer, clashes: [] }, null)).toBe(false);
  });

  it("names the clashes once, and logs them", async () => {
    const warn = vi.fn();
    await checkNameClashes(warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Dup");
    expect(localStorage.getItem(NAME_CLASHES_SEEN_KEY)).toBe(answer.key);
    expect(activityEntries().some((e) => e.kind === "psyneulink" && e.text.includes("Dup"))).toBe(true);

    await checkNameClashes(warn);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
