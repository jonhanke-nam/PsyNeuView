/**
 * What `/api/settings/pnl-updates` answers (#1304): whether PsyNeuLink is
 * current and when that was checked, the automatic-update switch, an update
 * ready for the next start, and each checkout's switches and last check.
 * One hook for General's status and Developer's checkout options.
 */

import { useCallback, useEffect, useState } from "react";
import { record, recordSettingChanged } from "@/utils/activityLog";
import type { PnlUpdates } from "@/utils/pnlUpdates";

export interface PnlUpdatesState {
  updates: PnlUpdates | null;
  error: string | null;
  /** A request in flight: Check now, a switch, a pull. */
  busy: boolean;
  reload: () => Promise<void>;
  /** Ask the backend to check now (GitHub or PyPI). */
  checkNow: () => Promise<void>;
  setAutoUpdate: (enabled: boolean) => Promise<void>;
  setCheckoutPrefs: (path: string, prefs: { check?: boolean; pull_on_launch?: boolean }) => Promise<void>;
  checkCheckout: (path: string) => Promise<void>;
}

async function readError(r: Response): Promise<string> {
  const data = await r.json().catch(() => ({}));
  return typeof data.detail === "string" ? data.detail : data.detail?.message ?? `HTTP ${r.status}`;
}

/** `deps` re-reads when the installed PsyNeuLink changes (after a switch). */
export function usePnlUpdates(deps: unknown[] = []): PnlUpdatesState {
  const [updates, setUpdates] = useState<PnlUpdates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback(async (request: () => Promise<Response>, optimistic?: (prev: PnlUpdates) => PnlUpdates) => {
    setBusy(true);
    setError(null);
    // A switch flips at once; the answer (or a failure) sets the record straight.
    if (optimistic) setUpdates((prev) => (prev ? optimistic(prev) : prev));
    try {
      const r = await request();
      if (!r.ok) throw new Error(await readError(r));
      const data = await r.json();
      // The prefs and check routes answer with the checkouts alone.
      setUpdates((prev) => ("auto_update" in data ? data : prev ? { ...prev, checkouts: data.checkouts } : prev));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      if (optimistic) {
        const back = await fetch("/api/settings/pnl-updates").catch(() => null);
        if (back?.ok) setUpdates(await back.json());
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(() => apply(() => fetch("/api/settings/pnl-updates")), [apply]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  const post = (url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    updates,
    error,
    busy,
    reload,
    checkNow: () => {
      record("psyneulink", "Checked for PsyNeuLink updates (Check now)");
      return apply(() => post("/api/settings/pnl-updates/check"));
    },
    setAutoUpdate: (enabled) => {
      recordSettingChanged("pnl-auto-update", enabled);
      return apply(
        () => post("/api/settings/pnl-updates/auto-update", { enabled }),
        (prev) => ({ ...prev, auto_update: enabled, update_ready: enabled && prev.update_ready }),
      );
    },
    setCheckoutPrefs: (path, prefs) => {
      if (prefs.check !== undefined) recordSettingChanged("checkout-check-upstream", prefs.check, `checkout-check-upstream = ${prefs.check} (${path})`);
      if (prefs.pull_on_launch !== undefined) recordSettingChanged("checkout-pull-on-launch", prefs.pull_on_launch, `checkout-pull-on-launch = ${prefs.pull_on_launch} (${path})`);
      return apply(
        () => post("/api/settings/checkout-updates/prefs", { path, ...prefs }),
        (prev) => ({ ...prev, checkouts: prev.checkouts.map((c) => (c.path === path ? { ...c, ...prefs } : c)) }),
      );
    },
    checkCheckout: (path) => apply(() => post("/api/settings/checkout-updates/check", { path })),
  };
}
