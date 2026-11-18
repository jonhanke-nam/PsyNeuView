import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
});

import { WALKTHROUGHS } from "./tourStep";
import {
  PROGRESS_KEY,
  clearProgress,
  codeFingerprint,
  fitsWalkthrough,
  loadProgress,
  progressFor,
  saveProgress,
  stepsFingerprint,
} from "./tutorialProgress";

const stroop = WALKTHROUGHS.stroop;

describe("where a tutorial was left (#173)", () => {
  beforeEach(() => stored.clear());

  it("keeps one place per tutorial, and finishing one forgets only its own", () => {
    saveProgress("stroop", progressFor(stroop, 2, "code", "abc", null));
    saveProgress("ddm", progressFor(WALKTHROUGHS.ddm, 1, null, null, "/mine/ddm_demo.py"));
    expect(loadProgress("stroop")).toMatchObject({ step: 2, code: "code", fresh: "abc" });
    expect(loadProgress("ddm")).toMatchObject({ step: 1, file: "/mine/ddm_demo.py" });
    clearProgress("stroop");
    expect(loadProgress("stroop")).toBeNull();
    expect(loadProgress("ddm")).not.toBeNull();
    clearProgress("ddm");
    expect(stored.has(PROGRESS_KEY)).toBe(false);
  });

  it("survives unreadable storage", () => {
    stored.set(PROGRESS_KEY, "not json");
    expect(loadProgress("stroop")).toBeNull();
    saveProgress("stroop", progressFor(stroop, 1, null, null, null));
    expect(loadProgress("stroop")?.step).toBe(1);
  });

  it("fits only the tutorial as it was saved", () => {
    const p = progressFor(stroop, 2, null, null, null);
    expect(fitsWalkthrough(stroop, p)).toBe(true);
    expect(fitsWalkthrough(stroop, { ...p, stepId: "gone" })).toBe(false);
    expect(fitsWalkthrough(stroop, { ...p, steps: "a|b" })).toBe(false);
    expect(fitsWalkthrough(stroop, { ...p, step: stroop.steps.length })).toBe(false);
    // Step 1 is a fresh start: nothing to resume.
    expect(fitsWalkthrough(stroop, progressFor(stroop, 0, null, null, null))).toBe(false);
    expect(stepsFingerprint(stroop)).toContain(stroop.steps[0].id);
  });

  it("tells models apart by their code", () => {
    expect(codeFingerprint("a = 1\n")).toBe(codeFingerprint("a = 1\n"));
    expect(codeFingerprint("a = 1\n")).not.toBe(codeFingerprint("a = 2\n"));
    expect(codeFingerprint("")).toMatch(/^[0-9a-f]{8}$/);
  });
});
