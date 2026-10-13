import { describe, it, expect } from "vitest";
import { defaultHint, willMoveFiles } from "./sidecarPlacement";
import type { SidecarPlacement } from "./sidecarApi";

const at = (p: Partial<SidecarPlacement>): SidecarPlacement => ({
  perModel: null,
  default: "auto",
  effective: "lateral",
  managed: false,
  ...p,
});

describe("defaultHint", () => {
  it("names the resolved location while inheriting", () => {
    // No override, so `effective` is the resolved default and is concrete even
    // when `default` is the un-actionable "auto".
    expect(defaultHint(at({ perModel: null, default: "auto", effective: "lateral" })))
      .toBe(" (now: beside .py)");
    expect(defaultHint(at({ perModel: null, default: "auto", effective: "dotfolder" })))
      .toBe(" (now: .psyneuview/)");
  });

  it("names the DEFAULT, not the override, when the two disagree", () => {
    // The original bug. The model is pinned to the dot-folder while the global
    // default is lateral, so the row must point at lateral — where choosing it
    // would actually send the files. Reading `effective` here said
    // ".psyneuview/", i.e. exactly the place the click moves the files *away*
    // from, one confirm before they move on disk.
    expect(defaultHint(at({ perModel: "dotfolder", default: "lateral", effective: "dotfolder" })))
      .toBe(" (now: beside .py)");

    expect(defaultHint(at({ perModel: "lateral", default: "dotfolder", effective: "lateral" })))
      .toBe(" (now: .psyneuview/)");
  });

  it("stays silent when an override is set and the default is 'auto'", () => {
    // "auto" resolves against the model's existing companions, which only the
    // backend can see. No hint beats a guessed one right before a file move.
    expect(defaultHint(at({ perModel: "dotfolder", default: "auto", effective: "dotfolder" })))
      .toBe("");
  });
});

describe("willMoveFiles", () => {
  it("confirms only when the files actually relocate", () => {
    const lateral = at({ effective: "lateral" });
    expect(willMoveFiles(lateral, "dotfolder")).toBe(true);
    // Already there — pinning it is a no-op on disk.
    expect(willMoveFiles(lateral, "lateral")).toBe(false);
    // Handing control back to the default never moves anything by itself.
    expect(willMoveFiles(lateral, "inherit")).toBe(false);
    expect(willMoveFiles(at({ perModel: "dotfolder", effective: "dotfolder" }), "inherit")).toBe(false);
  });
});
