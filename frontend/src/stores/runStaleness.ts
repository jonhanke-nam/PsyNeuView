/**
 * Keeps `useRunResults().stale` true while the open model's source differs
 * from the source the results ran (#337).
 *
 * Performance: typing must not pay for this. The run's hash is computed once,
 * when it starts; the current source is hashed only after edits pause
 * (`CHECK_DELAY_MS`), only while there are results to check, and each source
 * string is hashed at most once (`cachedSourceHash`).
 *
 * Going stale also clears the graph's stepping highlights and trace: they
 * point at nodes and values the edited model may no longer have. Undo back to
 * the exact source that ran makes the hashes match, and the results current.
 * Layout and fold or expand changes leave the source text alone, so they never
 * make results stale.
 *
 * Switching to another composition in the same file makes them stale too: they
 * describe the composition that ran, not the one now chosen. Switching back
 * makes them current again.
 */
import { useModelStore } from "./modelStore";
import { useRunResults } from "./runResultsStore";
import { cachedSourceHash, sourceForHash } from "@/utils/sourceHash";

export const CHECK_DELAY_MS = 150;

/** How results from an earlier version of the model look: dimmed. */
export const STALE_STYLE = { opacity: 0.45 } as const;

/** Did the composition that ran differ from `composition`, the one now chosen? */
export function isOtherComposition(composition: string | null | undefined): boolean {
  const ran = useRunResults.getState().results?.chosenComposition;
  return !!ran && !!composition && ran !== composition;
}

/**
 * Do the current results describe something other than `source` (a different
 * version of the model) or `composition` (a different composition in it)?
 */
export function isStale(source: string, composition?: string | null): boolean {
  const ran = useRunResults.getState().results?.sourceHash;
  if (!ran) return false;
  return cachedSourceHash(source) !== ran || isOtherComposition(composition);
}

function check(): void {
  const { source, activeComposition } = useModelStore.getState();
  const stale = isStale(source, activeComposition);
  const runs = useRunResults.getState();
  if (stale === runs.stale) return;
  runs.setStale(stale);
  if (stale) useModelStore.getState().clearTrace();
}

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  // Nothing to compare against: don't hash at all.
  if (!useRunResults.getState().results?.sourceHash) {
    timer = null;
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    check();
  }, CHECK_DELAY_MS);
}

let installed = false;

/** Start watching. Idempotent; the Run panel calls it when it mounts. */
export function watchRunStaleness(): void {
  if (installed) return;
  installed = true;
  useModelStore.subscribe((s, prev) => {
    if (s.source !== prev.source || s.activeComposition !== prev.activeComposition) schedule();
  });
}

/** Re-check soon, e.g. right after new results land. */
export function recheckRunStaleness(): void {
  schedule();
}

/**
 * For the e2e suite only (a browser under automation, as `__pnvUndoTest`):
 * the two sides of the staleness check, so a test that finds results stale
 * can attach what differs (#366).
 */
if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.webdriver) {
  (window as unknown as { __pnvStalenessTest?: unknown }).__pnvStalenessTest = {
    state: () => {
      const results = useRunResults.getState().results;
      const { source, activeComposition } = useModelStore.getState();
      const ranHash = results?.sourceHash ?? null;
      return {
        ranHash,
        ranSource: ranHash ? sourceForHash(ranHash) ?? null : null,
        ranComposition: results?.chosenComposition ?? null,
        source,
        sourceHash: cachedSourceHash(source),
        activeComposition: activeComposition ?? null,
        stale: useRunResults.getState().stale,
      };
    },
  };
}
