import { describe, expect, it } from "vitest";
import { recordVersion } from "./recordVersion";

describe("recordVersion (#357)", () => {
  const rec = { modelPath: "/m.py", sourceHash: "abc" };
  it("matches when the open source hashes the same", () => {
    expect(recordVersion(rec, "/m.py", "abc")).toBe("matches");
  });
  it("is from an earlier version when the hash differs", () => {
    expect(recordVersion(rec, "/m.py", "def")).toBe("earlier");
  });
  it("is from another file when the paths differ", () => {
    expect(recordVersion(rec, "/other.py", "abc")).toBe("other-file");
  });
  it("can't tell for an unhashed record or before the open source is hashed", () => {
    expect(recordVersion({ modelPath: "/m.py" }, "/m.py", "abc")).toBeNull();
    expect(recordVersion(rec, "/m.py", null)).toBeNull();
  });
});
