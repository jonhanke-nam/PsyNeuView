import { describe, expect, it } from "vitest";
import { fitTitle, shortFolder, shortenLabel, titleParts, windowTitle, type ModelIdentity } from "./modelTitle";

const CH: ModelIdentity = {
  source: "reference",
  label: "Stroop — Bidirectional (Cohen & Huston 1994)",
  file: "Cohen_Huston1994.py",
  path: "/Users/someone/.psyneuview/working-copies/Cohen_Huston1994.py",
  workingCopy: true,
};
const MINE: ModelIdentity = {
  source: "user",
  label: null,
  file: "my_stroop.py",
  path: "/Users/someone/Documents/research/2026/projects/stroop/my_stroop.py",
};

// 7px a character; the tag carries 12px of padding and border.
const measure = (text: string, part: string) => text.length * 7 + (part === "tag" ? 12 : 0);
const full = (id: ModelIdentity) => {
  const p = titleParts(id);
  return ["label", "file", "tag", "folder"]
    .filter((k) => p[k as keyof typeof p])
    .reduce((w, k) => w + measure(p[k as keyof typeof p] as string, k), 0);
};

describe("model title parts (#422)", () => {
  it("a reference model shows its menu label, its file and its source", () => {
    expect(titleParts(CH)).toEqual({ label: CH.label, file: "Cohen_Huston1994.py", tag: "Reference", folder: null });
  });

  it("the user's own file is named by its file, with its folder", () => {
    expect(titleParts(MINE)).toEqual({
      label: "my_stroop.py",
      file: null,
      tag: "Your file",
      folder: "~/…/projects/stroop",
    });
  });

  it("a short folder is shown whole", () => {
    expect(shortFolder("/Users/someone/models/x.py")).toBe("~/models");
  });

  it("the window title is the label", () => {
    expect(windowTitle(CH)).toBe("Stroop — Bidirectional (Cohen & Huston 1994) — PsyNeuView");
    expect(windowTitle(MINE)).toBe("my_stroop.py — PsyNeuView");
    expect(windowTitle(null)).toBe("PsyNeuView");
  });
});

describe("shortening the label (#422)", () => {
  it("leaves a label that fits alone", () => {
    expect(shortenLabel("Stroop — Basic", 40)).toBe("Stroop — Basic");
  });

  it("keeps the start and the author/year end", () => {
    const s = shortenLabel(CH.label!, 30);
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.startsWith("Stroop")).toBe(true);
    expect(s.endsWith("(Cohen & Huston 1994)")).toBe(true);
    expect(s).toContain("…");
  });

  it("shortens in the middle when there is no author/year end", () => {
    const s = shortenLabel("Locus Coeruleus gain model without any authors", 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.startsWith("Locus")).toBe(true);
    expect(s.endsWith("authors")).toBe(true);
  });

  it("is never empty", () => {
    expect(shortenLabel(CH.label!, 1).length).toBeGreaterThan(0);
    expect(shortenLabel(CH.label!, 0).length).toBeGreaterThan(0);
  });
});

describe("fitting the title to the room (#422)", () => {
  it("shows everything when it fits", () => {
    expect(fitTitle(titleParts(MINE), 10_000, measure, 0)).toEqual(titleParts(MINE));
  });

  it("drops the folder first, then the tag, then the file", () => {
    const p = titleParts(MINE);
    const noFolder = fitTitle(p, full(MINE) - 1, measure, 0);
    expect(noFolder.folder).toBeNull();
    expect(noFolder.tag).toBe("Your file");

    const r = titleParts(CH);
    const w = full(CH);
    const noTag = fitTitle(r, w - 1, measure, 0);
    expect(noTag).toMatchObject({ tag: null, file: "Cohen_Huston1994.py", label: CH.label });
    const labelOnly = fitTitle(r, measure(CH.label!, "label"), measure, 0);
    expect(labelOnly).toMatchObject({ tag: null, file: null, label: CH.label });
  });

  it("then shortens the label, keeping its author/year end, never hiding it", () => {
    const out = fitTitle(titleParts(CH), 30 * 7, measure, 0);
    expect(out.file).toBeNull();
    expect(out.label.length).toBeLessThanOrEqual(30);
    expect(out.label.endsWith("(Cohen & Huston 1994)")).toBe(true);
    const tiny = fitTitle(titleParts(CH), 0, measure, 0);
    expect(tiny.label.length).toBeGreaterThan(0);
  });

  it("counts the gaps between parts", () => {
    const p = titleParts(CH);
    const exact = fitTitle(p, full(CH), measure, 0);
    expect(exact.tag).toBe("Reference");
    const withGaps = fitTitle(p, full(CH), measure, 8);
    expect(withGaps.tag).toBeNull();
  });
});
