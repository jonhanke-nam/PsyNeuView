/**
 * Every official PsyNeuLink release, from `/api/settings/pnl-releases`
 * (#1295 round 5), for the two views of the PsyNeuLink setting: General's
 * dropdown and, in Developer, knowing which release "PyPI" without a
 * version would install, so Apply & restart appears only when that differs
 * from what is installed (#1303).
 */

import { useEffect, useState } from "react";
import type { PnlReleases } from "./types";

/** Null until the backend answers (or when it can't). */
export function useReleases(enabled = true): PnlReleases | null {
  const [releases, setReleases] = useState<PnlReleases | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/settings/pnl-releases")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PnlReleases | null) => alive && data && setReleases(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return releases;
}

/** The newest release that can install here; null when none is known. */
export function newestInstallableRelease(releases: PnlReleases | null): string | null {
  return releases?.releases.find((r) => r.compatible)?.version ?? null;
}
