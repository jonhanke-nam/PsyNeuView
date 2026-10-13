/**
 * Consolidated model-load latency logging (#864).
 *
 * Emits ONE structured `[perf] load "<name>"` line per load so the whole
 * pipeline is visible in one place — backend introspect (from the response
 * `timings` block), frontend graph build, and the browser paint that follows —
 * instead of the scattered fragments that only the file-open path used to log.
 *
 * The measurement lands after a double `requestAnimationFrame`, i.e. just past
 * the paint the post-build state update triggers, so `total` reflects what the
 * user actually waited for (click → graph on screen), not just when JS finished.
 */

import { useLoadTimingStore } from "@/stores/loadTimingStore";

export interface BackendTimings {
  introspect_ms?: number;
  misc_ms?: number;
  total_ms?: number;
}

export interface LoadPerfMarks {
  /** Human label for the model (used in the log line). */
  label: string;
  /** performance.now() at fetch start. */
  t0: number;
  /** performance.now() when the response resolved. */
  apiDoneAt: number;
  /** performance.now() after response body was parsed. */
  parseDoneAt: number;
  /** performance.now() after loadModelFromServer returned. */
  buildDoneAt: number;
  /** The backend's `timings` block, if the endpoint provided one. */
  backend?: BackendTimings | null;
}

export function logLoadPerf(m: LoadPerfMarks): void {
  const afterPaint =
    typeof requestAnimationFrame === "function"
      ? (cb: () => void) =>
          requestAnimationFrame(() => requestAnimationFrame(cb))
      : (cb: () => void) => setTimeout(cb, 0);

  afterPaint(() => {
    const paintedAt = performance.now();
    const api = m.apiDoneAt - m.t0;
    const parse = m.parseDoneAt - m.apiDoneAt;
    const build = m.buildDoneAt - m.parseDoneAt;
    const paint = paintedAt - m.buildDoneAt;
    const total = paintedAt - m.t0;
    const b = m.backend;
    const backendStr = b
      ? ` | backend introspect=${Math.round(b.introspect_ms ?? 0)}ms` +
        (b.misc_ms != null ? ` misc=${Math.round(b.misc_ms)}ms` : "")
      : "";
    console.log(
      `[perf] load "${m.label}": total=${Math.round(total)}ms ` +
        `(api=${Math.round(api)} parse=${Math.round(parse)} ` +
        `build=${Math.round(build)} paint=${Math.round(paint)})${backendStr}`,
    );
    // Surface the breakdown in the UI (#874): persistent "loaded in X.Xs" +
    // expandable detail in the Diagnostics bar / Inspector.
    useLoadTimingStore.getState().setLast({
      label: m.label,
      total,
      api,
      parse,
      build,
      paint,
      backend: m.backend,
    });
  });
}
