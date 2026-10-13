/**
 * One way to switch the installed PsyNeuLink, shared by the two views of
 * that setting (#1295 round 4): the simple choice in General ▸ PsyNeuLink
 * version and the full form in Developer ▸ Which PsyNeuLink is installed.
 *
 * Both post the same `/api/settings/install` request, poll the same job,
 * announce the switch to the Open menu the same way, and hand the pre-install
 * snapshot up so Settings can show "you went from X to Y". A second
 * mechanism here would be a second setting; this is the one.
 */

import { useEffect, useRef, useState } from "react";
import { record } from "@/utils/activityLog";
import { announcePnlSourceChanged } from "@/utils/pnlSourceEvents";
import { describeInstallForm, pnlSourceName, type InstallForm, type InstallSource, type PsyNeuLinkInfo } from "@/utils/pnlSources";

export type InstallStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface InstallJob {
  id: string;
  source: string;
  ref: string | null;
  path: string | null;
  repo: string | null;
  status: InstallStatus;
  log: string[];
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
}

/** Elapsed wall-clock for an install job. Shows the total when the job has
 * finished (matches the ``Total: X.Xs`` line the backend's _StepTimer emits)
 * and the running elapsed otherwise. Polling re-renders every second so the
 * running counter ticks live. */
export function formatJobElapsed(job: InstallJob): string | null {
  const end = job.finished_at ?? Date.now() / 1000;
  const elapsed = end - job.started_at;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const formatted = elapsed >= 10 ? elapsed.toFixed(0) : elapsed.toFixed(1);
  return job.finished_at !== null ? `${formatted}s total` : `${formatted}s elapsed`;
}

/** The request body for a form, as the backend expects it. */
type InstallRequestBody = {
  source: InstallSource; ref?: string; path?: string; repo?: string; version?: string;
  download_repo?: string; download_ref?: string;
};

export function installRequestBody(form: InstallForm): InstallRequestBody {
  const body: InstallRequestBody = { source: form.source };
  if (form.source === "pypi" && form.version) body.version = form.version;
  if (form.source === "github") {
    // Mirror the backend's _normalize_ref: drop surrounding whitespace and
    // leading/trailing slashes so the payload matches what gets sent to git
    // checkout (#248).
    body.ref = form.ref.trim().replace(/^\/+|\/+$/g, "");
    const trimmedRepo = form.repo.trim();
    if (trimmedRepo) body.repo = trimmedRepo;
  }
  if (form.source === "local") body.path = form.path.trim();
  // An empty or missing folder: download PsyNeuLink into it first (#1342).
  if (form.source === "local" && form.download) {
    body.download_repo = form.download.repo;
    body.download_ref = form.download.ref;
  }
  return body;
}

export interface InstallJobState {
  job: InstallJob | null;
  submitError: string | null;
  isRunning: boolean;
  isDone: boolean;
  /** Start the install described by `form`. */
  submit: (form: InstallForm) => Promise<void>;
}

export function useInstallJob({
  currentPnl,
  onInstallSucceeded,
  onSucceeded,
}: {
  currentPnl: PsyNeuLinkInfo;
  onInstallSucceeded: (snapshot: PsyNeuLinkInfo) => void;
  /** Anything else to do once, when a job succeeds (reload a list, say). */
  onSucceeded?: () => void;
}): InstallJobState {
  const [job, setJob] = useState<InstallJob | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  // Snapshot of the PsyNeuLink install taken at submit time so we can hand it
  // back to the parent as the "previous version" once the new install succeeds.
  const preInstallSnapshotRef = useRef<PsyNeuLinkInfo | null>(null);
  // Guard against firing the callbacks twice for the same job (polling can
  // deliver the terminal status more than once before the effect runs).
  const announcedSuccessRef = useRef<string | null>(null);
  const announcedSourceRef = useRef<string | null>(null);
  const onSucceededRef = useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;

  // Poll the active job every 1s until it stops being "running".
  // A streak of 404s means the backend lost the job (most often: the dev
  // server reloaded mid-install). Show that to the user and stop polling
  // instead of spinning silently forever.
  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) {
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    let missing = 0;
    const interval = window.setInterval(async () => {
      try {
        const resp = await fetch(`/api/settings/install/${job.id}`);
        if (resp.ok) {
          const next: InstallJob = await resp.json();
          missing = 0;
          setJob(next);
        } else if (resp.status === 404 && ++missing >= 5) {
          setSubmitError(
            "Backend lost track of this install (likely a dev-server reload). " +
              "Close and reopen this panel to see current state.",
          );
          clearInterval(interval);
        }
      } catch {
        // Network blips are non-fatal — keep trying.
      }
    }, 1000);
    pollTimerRef.current = interval;
    return () => clearInterval(interval);
  }, [job]);

  // #1253: a finished install replaced PsyNeuLink's files. Tell the Open menu,
  // whose Library and examples paths came from the old copy.
  useEffect(() => {
    if (!job || announcedSourceRef.current === job.id) return;
    const what = { source: job.source, repo: job.repo, ref: job.ref, path: job.path };
    if (job.status === "succeeded") {
      announcedSourceRef.current = job.id;
      record("psyneulink", `PsyNeuLink switched: ${job.source}${job.repo ? ` ${job.repo}` : ""}${job.ref ? ` @ ${job.ref}` : ""}${job.path ? ` at ${job.path}` : ""}`, what);
      announcePnlSourceChanged();
      onSucceededRef.current?.();
    } else if (job.status === "failed" || job.status === "cancelled") {
      announcedSourceRef.current = job.id;
      record("psyneulink", `PsyNeuLink switch ${job.status}`, { ...what, exitCode: job.exit_code });
    }
  }, [job]);

  // When a job transitions to "succeeded", hand the pre-install snapshot up
  // so the parent can refetch /settings/info and show "previous → current".
  useEffect(() => {
    if (
      job?.status === "succeeded" &&
      announcedSuccessRef.current !== job.id &&
      preInstallSnapshotRef.current
    ) {
      announcedSuccessRef.current = job.id;
      onInstallSucceeded(preInstallSnapshotRef.current);
    }
  }, [job, onInstallSucceeded]);

  const submit = async (form: InstallForm) => {
    setSubmitError(null);
    // Snapshot what's currently installed BEFORE we kick off the install, so
    // we can surface it as "Previous version" once this job succeeds.
    preInstallSnapshotRef.current = currentPnl;
    record("psyneulink", `PsyNeuLink switch requested: ${describeInstallForm(form)}`, {
      from: pnlSourceName(currentPnl),
      to: describeInstallForm(form),
    });
    try {
      const resp = await fetch("/api/settings/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(installRequestBody(form)),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(
          typeof detail.detail === "string"
            ? detail.detail
            : detail.detail?.message ?? `HTTP ${resp.status}`,
        );
      }
      const started: InstallJob = await resp.json();
      setJob(started);
    } catch (e) {
      setSubmitError(String(e));
    }
  };

  return {
    job,
    submitError,
    isRunning: !!job && (job.status === "pending" || job.status === "running"),
    isDone: !!job && (job.status === "succeeded" || job.status === "failed"),
    submit,
  };
}
