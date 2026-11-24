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
 */
import { useModelStore } from "./modelStore";
import { useRunResults } from "./runResultsStore";
import { cachedSourceHash } from "@/utils/sourceHash";

export const CHECK_DELAY_MS = 150;

/** How results from an earlier version of the model look: dimmed. */
export const STALE_STYLE = { opacity: 0.45 } as const;

/** Is `source` a different version from the one the current results ran? */
export function isStale(source: string): boolean {
  const ran = useRunResults.getState().results?.sourceHash;
  if (!ran) return false;
  return cachedSourceHash(source) !== ran;
}

function check(): void {
  const stale = isStale(useModelStore.getState().source);
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
    if (s.source !== prev.source) schedule();
  });
}

/** Re-check soon, e.g. right after new results land. */
export function recheckRunStaleness(): void {
  schedule();
}
