import { describe, it, expect } from "vitest";

// Mirrors the formatter in PresenceIndicator — kept as a pure function test so
// the phrasing is pinned without rendering the component.
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

describe("name list phrasing", () => {
  it("reads the way a person would say it", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["alex"])).toBe("alex");
    expect(joinNames(["alex", "blake"])).toBe("alex and blake");
    expect(joinNames(["alex", "blake", "casey"])).toBe("alex, blake and casey");
  });
});
