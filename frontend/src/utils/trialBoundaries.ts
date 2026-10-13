/**
 * Trial-boundary derivation for the trace stepper (#470).
 *
 * `executionTrialBoundaries` (step indices where each trial starts) is normally
 * supplied by the backend from the PsyNeuLink `_debugger` hook firing
 * `BEGINNING_OF_TRIAL`. PsyNeuLink builds without that hook (PyPI, stock
 * PrincetonUniversity `devel`) return only `[0]`, which previously collapsed
 * the trace stepper's trial navigation (⏮/⏭, the run/trial toggle, the
 * "Trial X/Y" indicator) to nothing — even on a multi-trial run.
 *
 * When the hook is absent we can still recover usable boundaries from the run's
 * `numTrials` and the flat execution trace: assuming each trial fired the same
 * number of execution sets (the common case), partition the trace evenly. This
 * keeps trial-level stepping working on hook-less builds; the per-node value
 * pill stays absent because that genuinely needs the snapshot data the hook
 * provides.
 */

/**
 * Resolve the trial boundaries to use for the trace stepper.
 *
 * - A backend list with >1 entry is authoritative — use it as-is.
 * - Otherwise, if the run had >1 trial and a non-empty trace, derive evenly
 *   spaced boundaries from `numTrials`.
 * - Single-trial (or unknown) runs return `[0]` (or the backend's `[0]`), which
 *   correctly leaves trial navigation hidden.
 */
export function deriveTrialBoundaries(
  traceLength: number,
  numTrials: number | null | undefined,
  backendBoundaries: number[] | undefined,
): number[] {
  // Backend gave us real per-trial info — trust it.
  if (backendBoundaries && backendBoundaries.length > 1) {
    return backendBoundaries;
  }

  // No usable backend boundaries. Fall back to an even partition when we know
  // there was more than one trial and have steps to split.
  if (
    typeof numTrials === "number" &&
    numTrials > 1 &&
    traceLength > 0 &&
    numTrials <= traceLength
  ) {
    const perTrial = Math.floor(traceLength / numTrials);
    // Only partition cleanly when the trace divides evenly across trials;
    // an uneven trace means we can't trust an even split, so don't fabricate
    // boundaries that would mislabel which step belongs to which trial.
    if (perTrial > 0 && perTrial * numTrials === traceLength) {
      return Array.from({ length: numTrials }, (_, i) => i * perTrial);
    }
  }

  // Single trial, unknown trial count, or an unevenly divisible trace: keep
  // whatever the backend sent (normally `[0]`), leaving trial nav hidden.
  return backendBoundaries ?? [];
}
