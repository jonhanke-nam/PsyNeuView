/**
 * Live progress of a run in flight (#357): the Run panel names each run, and
 * asks the backend how many of its trials have finished while it waits.
 */

export interface RunProgress {
  /** Trials finished so far. */
  trial: number;
  /** Trials in the run. */
  total: number;
  /** Seconds the last finished trial took; null before the first. */
  seconds: number | null;
}

/** How often the panel asks. Cheap: a dictionary lookup on the server. */
export const POLL_MS = 300;

/** "Trial 3 of 10 · 0.42 s". */
export function formatRunProgress(p: RunProgress): string {
  const time = p.seconds != null ? ` · ${p.seconds.toFixed(2)} s` : "";
  return `Trial ${p.trial} of ${p.total}${time}`;
}

export function newRunId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Ask for `id`'s progress every POLL_MS until the returned stop function is
 * called. A run that hasn't started or has finished answers 404: nothing to
 * show, and no error either.
 */
export function pollRunProgress(
  id: string,
  onProgress: (p: RunProgress) => void,
  intervalMs = POLL_MS,
): () => void {
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const resp = await fetch(`/api/model/run/progress/${encodeURIComponent(id)}`);
      if (!stopped && resp.ok) {
        const data = (await resp.json()) as RunProgress;
        if (!stopped) onProgress(data);
      }
    } catch {
      // Progress is a courtesy; the run's own request reports failures.
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
