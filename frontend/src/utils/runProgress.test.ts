import { describe, expect, it } from "vitest";
import { formatRunProgress } from "./runProgress";

describe("formatRunProgress (#357)", () => {
  it("reads trials finished of the total, and the last one's time", () => {
    expect(formatRunProgress({ trial: 3, total: 10, seconds: 0.4213 })).toBe("Trial 3 of 10 · 0.42 s");
  });
  it("leaves the time out until a trial has one", () => {
    expect(formatRunProgress({ trial: 1, total: 2, seconds: null })).toBe("Trial 1 of 2");
  });
});
