// Pure helpers for the sidecar-placement control (#933).
//
// Kept out of the component so the resolution rules can be unit-tested: they
// are the part with real branching, and the part that was wrong.

import type { SidecarPlacement } from "./sidecarApi";

/** Short, friendly label for a concrete placement location. */
export const LOCATION_LABEL: Record<"lateral" | "dotfolder", string> = {
  lateral: "beside .py",
  dotfolder: ".psyneuview/",
};

/**
 * The trailing "(now: …)" on the **Use default** row — where choosing it would
 * actually put the files.
 *
 * The subtlety, and the original bug: this is *not* `effective`. `effective`
 * already has the per-model override folded in, so reading it here describes
 * where the files sit today rather than where this choice would send them. The
 * two agree only while inheriting — and an override is precisely when someone
 * reads this row, immediately before an action that moves files on disk.
 *
 * `default` may be "auto", whose concrete location depends on whether the model
 * already has lateral companions. Only the backend can resolve that, so name a
 * location when the default names one and stay silent otherwise. A vague hint
 * beats a confident wrong one when the next click relocates files.
 */
export function defaultHint(placement: SidecarPlacement): string {
  if (placement.perModel === null) {
    // Inheriting, so `effective` *is* the resolved default — and unlike
    // `default` it is always concrete, which makes it the better label.
    return ` (now: ${LOCATION_LABEL[placement.effective]})`;
  }
  if (placement.default === "lateral" || placement.default === "dotfolder") {
    return ` (now: ${LOCATION_LABEL[placement.default]})`;
  }
  return "";
}

/**
 * Whether picking `value` will relocate files on disk — the test for whether to
 * confirm first. Pinning to where the files already are, or handing control
 * back to the default, moves nothing.
 */
export function willMoveFiles(
  placement: SidecarPlacement,
  value: "lateral" | "dotfolder" | "inherit",
): boolean {
  return value !== "inherit" && value !== placement.effective;
}
