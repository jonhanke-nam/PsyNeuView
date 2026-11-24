"""In-memory job layer for long-running model executions (#535, L2).

Each job runs in its own dedicated one-shot worker subprocess, so a long
training never blocks the interactive warm worker that serves normal
runs/introspection. The worker emits progress lines (PROGRESS_MARKER +
JSON) on stdout before the usual RESULT_MARKER payload; the job thread
parses them into the job's progress log and fans them out to SSE
subscribers. Polling (GET snapshot) and SSE consume the same state.

Built against learn (kind="learn"); designed so fit jobs (F2, #539) can
reuse the lifecycle unchanged.
"""

import hashlib
import json
import logging
import queue
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import os

from app.services import bounded_run, os_sandbox, run_limits
from app.services.assistant import review as assistant_review
from app.services.sandbox import WORKER_PATH, RESULT_MARKER

logger = logging.getLogger(__name__)

PROGRESS_MARKER = "###PSYNEUVIEW_PROGRESS###"

# Hard cap so a hung job can't block the one-at-a-time slot forever.
JOB_TIMEOUT = 3600

# Finished jobs kept for inspection before pruning.
_MAX_FINISHED_JOBS = 20

TERMINAL_STATUSES = ("done", "error", "canceled")


class Job:
    def __init__(self, kind: str, config: dict, provenance: dict):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.config = config
        self.provenance = provenance
        self.status = "queued"
        self.progress: list[dict] = []
        self.result: dict | None = None
        self.error: str | None = None
        self.created_at = time.time()
        self.finished_at: float | None = None
        self._proc: subprocess.Popen | None = None
        self._cancel_requested = False
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue] = []

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "id": self.id,
                "kind": self.kind,
                "status": self.status,
                "config": self.config,
                "provenance": self.provenance,
                "progress": list(self.progress),
                "result": self.result,
                "error": self.error,
                "createdAt": self.created_at,
                "finishedAt": self.finished_at,
            }

    def add_progress(self, ev: dict):
        event = {"type": "progress", **ev}
        with self._lock:
            self.progress.append(ev)
            subs = list(self._subscribers)
        for q in subs:
            q.put(event)

    def finish(self, status: str, result: dict | None = None, error: str | None = None):
        terminal = {"type": status}
        if error:
            terminal["error"] = error
        with self._lock:
            if self.status in TERMINAL_STATUSES:
                return
            self.status = status
            self.result = result
            self.error = error
            self.finished_at = time.time()
            subs = list(self._subscribers)
            self._subscribers = []
        for q in subs:
            q.put(terminal)

    def subscribe(self) -> tuple[queue.Queue | None, list[dict]]:
        """Returns (live_queue, replay_events).

        Replay always carries the progress so far; if the job is already
        finished it ends with the terminal event and live_queue is None.
        """
        with self._lock:
            replay = [{"type": "progress", **p} for p in self.progress]
            if self.status in TERMINAL_STATUSES:
                terminal = {"type": self.status}
                if self.error:
                    terminal["error"] = self.error
                replay.append(terminal)
                return None, replay
            q: queue.Queue = queue.Queue()
            self._subscribers.append(q)
            return q, replay

    def unsubscribe(self, q: queue.Queue):
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def active_job(self) -> Job | None:
        return next(
            (j for j in self._jobs.values() if j.status not in TERMINAL_STATUSES),
            None,
        )

    def submit(self, kind: str, task: str, task_params: dict,
               config: dict, provenance: dict) -> tuple[Job | None, Job | None]:
        """Returns (job, None) on success or (None, active_job) when busy.

        One job at a time (v1): matches the single sandbox-worker model
        and keeps resource use predictable.
        """
        with self._lock:
            active = self.active_job()
            if active is not None:
                return None, active
            self._prune_finished()
            job = Job(kind, config, provenance)
            self._jobs[job.id] = job
        thread = threading.Thread(
            target=self._run, args=(job, task, task_params), daemon=True
        )
        thread.start()
        return job, None

    def cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        job._cancel_requested = True
        proc = job._proc
        if proc is not None and proc.poll() is None:
            proc.kill()
        elif job.status == "queued":
            # Worker not spawned yet; the run thread honors the flag.
            pass
        return job

    def _prune_finished(self):
        finished = sorted(
            (j for j in self._jobs.values() if j.status in TERMINAL_STATUSES),
            key=lambda j: j.finished_at or 0,
        )
        for j in finished[:-_MAX_FINISHED_JOBS] if len(finished) > _MAX_FINISHED_JOBS else []:
            del self._jobs[j.id]

    def _run(self, job: Job, task: str, task_params: dict):
        if job._cancel_requested:
            job.finish("canceled")
            return

        # The import guard's state travels with every task (#179), as it does
        # for the warm worker; the worker checks the model's path itself too.
        # Under the operating-system sandbox (#311) the job's worker applies
        # the policy before anything else; the task names it, so a worker
        # without it refuses the job.
        refused = os_sandbox.refusal()
        if refused:
            job.finish("error", error=refused)
            return
        if os_sandbox.active():
            os_sandbox.sweep_survivors()
        policy = os_sandbox.policy(model_path=task_params.get("file_path")) if os_sandbox.active() else None
        extras = {"os_sandbox_key": policy["key"]} if policy else {}
        payload = json.dumps({"task": task, "params": task_params, **assistant_review.worker_payload_extras(), **extras,
                              **run_limits.payload(True)})
        try:
            proc = subprocess.Popen(
                [sys.executable, WORKER_PATH],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=str(Path(task_params.get("file_path", ".")).parent),
                env=os_sandbox.launch_env(policy),
                # Its own session: nothing a model starts can join one of the
                # user's process groups (#311, U1).
                start_new_session=True,
            )
        except Exception as e:
            if policy:
                os_sandbox.discard_scratch(policy["scratch"])
            job.finish("error", error=f"Failed to start job worker: {e}")
            return
        try:
            self._watch(job, proc, payload, policy)
        finally:
            if policy:
                os_sandbox.discard_scratch(policy["scratch"])
                os_sandbox.sweep_survivors()

    def _watch(self, job: Job, proc: subprocess.Popen, payload: str, policy: dict | None = None) -> None:
        job._proc = proc
        # A cancel that came while the worker was being started (building the
        # sandbox policy takes a moment, #311) found no process to end.
        if job._cancel_requested:
            proc.kill()
            proc.wait()
            job.finish("canceled")
            return
        job.status = "running"
        watchdog = threading.Timer(JOB_TIMEOUT, lambda: proc.poll() is None and proc.kill())
        watchdog.daemon = True
        watchdog.start()
        # The run's memory, processor-time and process limits (#179, B3).
        limit_watch = run_limits.Watch(lambda: proc.pid, lambda pid: proc.kill())

        try:
            proc.stdin.write(payload)
            proc.stdin.close()

            result_str = None
            lines = _lines_until_exit(proc)
            for line in lines:
                stripped = line.rstrip("\n")
                if stripped.startswith(PROGRESS_MARKER):
                    try:
                        ev = json.loads(stripped[len(PROGRESS_MARKER):])
                    except json.JSONDecodeError:
                        continue
                    job.add_progress(ev)
                elif stripped.strip() == RESULT_MARKER:
                    # The rest from the same reader (it may hold the answer
                    # already), capped (#311, U4).
                    rest, size = [], 0
                    for more in lines:
                        size += len(more)
                        if size > bounded_run.OUTPUT_CAP:
                            break
                        rest.append(more)
                    result_str = "".join(rest)
                    break

            returncode = proc.wait()
        except Exception as e:
            proc.kill()
            job.finish("error", error=f"Job worker I/O failed: {e}")
            return
        finally:
            watchdog.cancel()
            limit_reason = limit_watch.stop()

        if job._cancel_requested:
            job.finish("canceled")
            return
        limit_reason = limit_watch.reason or limit_reason or run_limits.exit_reason(returncode)
        if limit_reason:
            job.finish("error", error=run_limits.message(limit_reason))
            return
        if returncode != 0 or result_str is None:
            stderr = _available(proc.stderr)
            tail = "\n".join(
                l for l in stderr.strip().splitlines() if "Warning" not in l
            )[-2000:]
            job.finish("error", error=f"Job worker exited with code {returncode}:\n{tail}")
            return

        try:
            result = os_sandbox.check_applied(json.loads(result_str), policy)
        except json.JSONDecodeError as e:
            job.finish("error", error=f"Failed to parse job result: {e}")
            return

        if isinstance(result, dict) and result.get("unreviewed_import"):
            # The worker's own check refused the model (#187): the job ends in
            # an error that names the file to review, as the route's 409 does.
            reason = (assistant_review.REASON_UNREADABLE if result.get("unreviewed_state")
                      else assistant_review.REASON)
            job.finish("error", result={"unreviewed_import": result["unreviewed_import"], "reason": reason},
                       error=result.get("error"))
        elif isinstance(result, dict) and "error" in result:
            job.finish("error", error=run_limits.explain(result)["error"])
        else:
            # The request's mode is what was asked for; record what actually
            # trained too, since a plain Composition resolves to Python (#997).
            if isinstance(result, dict) and result.get("executionMode"):
                job.provenance["effectiveExecutionMode"] = result["executionMode"]
            job.finish("done", result=result)


def _available(stream) -> str:
    """What a stream has now, up to the cap, without waiting for a process a
    model left holding it (#311, U4)."""
    if stream is None:
        return ""
    fd, out = stream.fileno(), bytearray()
    os.set_blocking(fd, False)
    while len(out) < bounded_run.OUTPUT_CAP:
        try:
            data = os.read(fd, 65536)
        except (BlockingIOError, OSError):
            break
        if not data:
            break
        out += data
    return out[:bounded_run.OUTPUT_CAP].decode("utf-8", "replace")


def _lines_until_exit(proc: subprocess.Popen, limit: int | None = None):
    """The worker's output lines, as they come, until the worker has exited
    and a moment after; never waiting for a process it left holding the
    pipe, and never keeping more than ``limit`` characters (#311, U4)."""
    import selectors
    import time as _time

    fd = proc.stdout.fileno()
    os.set_blocking(fd, False)
    sel = selectors.DefaultSelector()
    sel.register(fd, selectors.EVENT_READ)
    pending, total, stop_at = b"", 0, None
    try:
        while True:
            if stop_at is None and proc.poll() is not None:
                stop_at = _time.monotonic() + bounded_run.GRACE
            if stop_at is not None and _time.monotonic() > stop_at:
                break
            if not sel.select(timeout=0.05):
                continue
            try:
                data = os.read(fd, 65536)
            except BlockingIOError:
                continue
            if not data:
                break
            pending += data
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                total += len(line) + 1
                if limit is not None and total > limit:
                    return
                yield line.decode("utf-8", "replace") + "\n"
            if len(pending) > bounded_run.OUTPUT_CAP:
                pending = b""
    finally:
        sel.close()
    if pending and (limit is None or total + len(pending) <= limit):
        yield pending.decode("utf-8", "replace")


def build_provenance(file_path: str, config: dict) -> dict:
    """Embed everything needed to make this job's record comparable later
    (#466-style diffing, run-sets): full config, model identity+hash,
    and the PsyNeuLink version that executed it."""
    try:
        sha = hashlib.sha256(Path(file_path).read_bytes()).hexdigest()
    except OSError:
        sha = None
    try:
        from importlib.metadata import version
        pnl_version = version("psyneulink")
    except Exception:
        pnl_version = None
    return {
        "submittedAt": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "model": {"path": file_path, "sha256": sha},
        "psyneulinkVersion": pnl_version,
    }


job_manager = JobManager()
