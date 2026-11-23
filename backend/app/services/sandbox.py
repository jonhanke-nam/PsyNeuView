"""Subprocess sandbox for executing user .py files safely.

Uses a **warm worker process** that stays alive between requests.
PsyNeuLink is imported once at startup (~1.7s), then subsequent
requests reuse the process and complete in ~200ms.

The worker auto-restarts if it crashes or times out. A cold-start
fallback (spawn-per-call) is used if the warm worker is unavailable.

Communication is via newline-delimited JSON over stdin/stdout pipes.
"""

import json
import logging
import selectors
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from app.services.assistant import review as assistant_review
from app.services.assistant.review import require_runnable
from typing import Callable, Optional

from app.services.stderr_summary import (
    count_warnings as count_stderr_warnings,
    summarize as summarize_stderr,
)

logger = logging.getLogger(__name__)

# How long to wait for the worker's "###READY###" handshake before giving up.
# Generous: a cold start imports PsyNeuLink and torch. The point is not to be
# tight, it is to be FINITE — see _start().
WORKER_READY_TIMEOUT = 120

# Default timeouts in seconds
INTROSPECT_TIMEOUT = 30
RUN_TIMEOUT = 300  # 5 minutes for execution runs

# Path to the worker script
WORKER_PATH = str(Path(__file__).parent / "sandbox_worker.py")

RESULT_MARKER = "###PSYNEUVIEW_RESULT###"


class WarmWorker:
    """Persistent subprocess with PsyNeuLink pre-imported."""

    def __init__(self, on_ready: Optional[Callable[[bool, float], None]] = None):
        """``on_ready(ok, elapsed)`` is called once, from the first ``_start()``,
        the moment the child signals it has imported PsyNeuLink (or has failed
        to): the start-up phase report hangs on it (PsyNeuView-MacApp#232).
        Restarts never call it."""
        self._proc: subprocess.Popen | None = None
        self._stderr_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._on_ready = on_ready
        #: Whether the current process has been sent a task (#187).
        self._used = False
        #: A fresh process started ahead, for the next task while something
        #: the assistant wrote is tracked (see ``send_task``).
        self._spare: subprocess.Popen | None = None
        self._spare_thread: threading.Thread | None = None
        self._spare_lock = threading.Lock()
        self._start()

    def _notify_ready(self, ok: bool, elapsed: float) -> None:
        """Fire the one-shot ``on_ready`` callback; a failing callback is the
        caller's bug, never the worker's."""
        callback, self._on_ready = self._on_ready, None
        if callback is None:
            return
        try:
            callback(ok, elapsed)
        except Exception:  # noqa: BLE001
            logger.exception("Warm worker on_ready callback failed")

    def _drain_stderr(self, stderr):
        """Continuously drain the worker's stderr so its pipe buffer never fills.

        The parent only reads the worker's *stdout* (for the result marker). If
        the worker writes enough to stderr to fill the ~64KB OS pipe buffer, it
        blocks mid-write and never returns the result — the parent then hits the
        task timeout and 500s. Warning-heavy introspections (notably EGO, an
        AutodiffComposition whose torch/PNL/graph_scheduler output volume hovers
        around the buffer threshold) tripped this intermittently — the real cause
        of the flaky flat-view tutorial and "Failed to load reference model"
        toasts (#810). Draining here keeps the worker's [perf] lines visible via
        the logger while guaranteeing the pipe never blocks. Exits on EOF when
        the worker is killed/restarted (this runs in a daemon thread).
        """
        try:
            for line in stderr:
                line = line.rstrip("\n")
                if line:
                    logger.debug("[worker] %s", line)
        except Exception:
            pass

    def _start(self):
        """Spawn the worker process in persistent mode and make it current."""
        self._proc = self._spawn()
        self._used = False

    def _spawn(self) -> subprocess.Popen | None:
        """Start a worker process in persistent mode and wait until it is
        ready. Returns it, or None if it couldn't be started."""
        t0 = time.time()
        try:
            proc = subprocess.Popen(
                [sys.executable, WORKER_PATH, "--persistent"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # line-buffered
            )
            # Drain stderr from the moment the worker starts (it writes [perf]
            # import lines to stderr during startup) so its pipe never fills.
            self._stderr_thread = threading.Thread(
                target=self._drain_stderr, args=(proc.stderr,), daemon=True
            )
            self._stderr_thread.start()
            # Wait for the "ready" signal — with a deadline.
            #
            # Plain readline() here blocks forever if the worker never prints
            # it: a crash during import, a hang, or a machine slow enough to
            # exceed any sane budget. And _start() runs inside send_task()'s
            # lock via _restart(), so one stuck startup wedges EVERY later
            # request — which is what a two-mechanism model still "loading"
            # after 65 seconds in CI looks like.
            #
            # send_task() already learned this lesson and polls with a
            # selector; the handshake was left behind. Same pattern here.
            # Everything below talks to `proc`, never `self._proc`.
            #
            # `/api/test/reset` restarts the worker under `_warm_worker_lock`
            # while `send_task` restarts it under `self._lock` — two locks that
            # do not exclude each other, so a second _start() can land in the
            # middle of this one. Re-reading `self._proc` after the wait would
            # then register on one process's stdout and read from another's,
            # eating the second worker's ###READY### and leaving it looking
            # dead. Holding a local reference makes that impossible here,
            # whatever the callers do.
            ready_line = ""
            sel = selectors.DefaultSelector()
            sel.register(proc.stdout, selectors.EVENT_READ)
            try:
                deadline = time.time() + WORKER_READY_TIMEOUT
                while time.time() < deadline:
                    if sel.select(timeout=min(0.5, max(0.0, deadline - time.time()))):
                        ready_line = (proc.stdout.readline() or "").strip()
                        break
            finally:
                sel.close()

            if not ready_line:
                logger.error(
                    f"Warm worker did not signal ready within {WORKER_READY_TIMEOUT}s; "
                    "killing it rather than blocking every request behind it"
                )
                try:
                    proc.kill()
                except Exception:
                    pass
                self._notify_ready(False, time.time() - t0)
                return None

            elapsed = time.time() - t0
            if ready_line == "###READY###":
                logger.info(f"[perf] Warm worker started in {elapsed:.2f}s (PID {proc.pid})")
            else:
                logger.warning(f"Warm worker sent unexpected ready signal: {ready_line!r}")
            self._notify_ready(True, elapsed)
            return proc
        except Exception as e:
            logger.error(f"Failed to start warm worker: {e}")
            self._notify_ready(False, time.time() - t0)
            return None

    # ── One task per process while assistant-written files are tracked ──
    #
    # Everything in the worker, the import guard included, is reachable from
    # the model code it runs, so a model could switch the guard off for the
    # tasks that follow it. While anything the assistant wrote is tracked
    # (or the review state can't be read), each task therefore runs in a
    # process that has run no other task, and the process is ended after
    # it (#187). The server decides this from the state it reads itself,
    # never from anything in the worker. A spare is started ahead, so the
    # next task usually finds one ready.

    @staticmethod
    def _kill(proc: subprocess.Popen | None) -> None:
        if proc is None:
            return
        try:
            proc.kill()
            proc.wait(timeout=2)
        except Exception:
            pass

    def _take_spare(self) -> subprocess.Popen | None:
        thread = self._spare_thread
        if thread is not None:
            thread.join(WORKER_READY_TIMEOUT + 5)
        with self._spare_lock:
            spare, self._spare = self._spare, None
            self._spare_thread = None
        if spare is not None and spare.poll() is None:
            return spare
        self._kill(spare)
        return None

    def _start_spare(self) -> None:
        def start():
            proc = self._spawn()
            with self._spare_lock:
                old, self._spare = self._spare, proc
            self._kill(old)

        with self._spare_lock:
            if self._spare_thread is not None or self._spare is not None:
                return
            self._spare_thread = threading.Thread(target=start, daemon=True, name="worker-spare")
            self._spare_thread.start()

    def _use_fresh(self) -> None:
        """Make current a process that has run no task. Caller holds `self._lock`."""
        self._kill(self._proc)
        self._proc = self._take_spare() or self._spawn()
        self._used = False

    def _end_after_task(self) -> None:
        """End the process that just ran a task, and start the next one
        ahead. Caller holds `self._lock`."""
        self._kill(self._proc)
        self._proc = None
        self._used = False
        self._start_spare()

    def restart(self):
        """Kill and restart the worker, after any in-flight task finishes.

        The entry point for everything outside this class. It takes the same
        lock `send_task()` holds, so a restart can no longer kill the process
        a running task is talking to, or overlap another restart and leave
        an orphaned worker running untracked (#1208).
        """
        with self._lock:
            self._restart()

    def _restart(self):
        """Kill and restart the worker. Caller must hold `self._lock`."""
        logger.info("Restarting warm worker...")
        self._kill(self._proc)
        self._proc = None
        # A spare started before this restart may run an earlier PsyNeuLink.
        self._kill(self._take_spare())
        self._start()

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        """Send a task to the warm worker and wait for the result."""
        with self._lock:
            single_use = assistant_review.worker_must_be_fresh()
            if not self.is_alive() or (single_use and self._used):
                self._use_fresh()
            if not self.is_alive():
                return {"error": "Warm worker failed to start"}
            try:
                return self._send(task, params, timeout)
            finally:
                if single_use or assistant_review.worker_must_be_fresh():
                    self._end_after_task()

    def _send(self, task: str, params: dict, timeout: int) -> dict:
        """Send one task to the current process. Caller holds `self._lock`."""
        payload = json.dumps({"task": task, "params": params, **assistant_review.worker_payload_extras()})
        self._used = True
        t0 = time.time()

        try:
            # Send the task
            self._proc.stdin.write(payload + "\n")
            self._proc.stdin.flush()

            # Poll stdout with a short inner timeout so the deadline check
            # actually fires when the worker is stuck and producing no output.
            # Plain readline() is blocking, so the previous loop never
            # re-checked the deadline once the worker stopped writing.
            sel = selectors.DefaultSelector()
            sel.register(self._proc.stdout, selectors.EVENT_READ)

            output_lines = []
            deadline = time.time() + timeout
            try:
                while True:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        logger.warning(
                            f"Warm worker timed out after {timeout}s, restarting..."
                        )
                        self._restart()
                        return {
                            "error": f"Script execution timed out after {timeout} seconds. "
                            f"This may indicate an infinite loop or a very long computation."
                        }

                    if self._proc.poll() is not None:
                        self._restart()
                        return {"error": "Worker process died during execution"}

                    if not sel.select(timeout=min(0.5, remaining)):
                        continue

                    line = self._proc.stdout.readline()
                    if not line:
                        self._restart()
                        return {"error": "Worker closed connection"}

                    line = line.rstrip("\n")
                    if line == RESULT_MARKER:
                        result_line = self._proc.stdout.readline().rstrip("\n")
                        elapsed = time.time() - t0
                        logger.info(f"[perf] warm worker {task}: {elapsed:.2f}s")
                        try:
                            return json.loads(result_line)
                        except json.JSONDecodeError as e:
                            return {"error": f"Failed to parse worker output: {e}"}
                    else:
                        output_lines.append(line)
            finally:
                sel.close()

        except (BrokenPipeError, OSError) as e:
            logger.warning(f"Warm worker pipe error: {e}, restarting...")
            self._restart()
            return {"error": f"Worker communication error: {e}"}


# Global warm worker instance — started on first use
_warm_worker: WarmWorker | None = None
_warm_worker_lock = threading.Lock()


def _get_warm_worker(on_ready: Optional[Callable[[bool, float], None]] = None) -> WarmWorker:
    """The singleton, started on first use. ``on_ready`` reaches the worker
    only when this call creates it (see ``WarmWorker``); a caller that finds
    one already running gets no callback, and can tell by the return."""
    global _warm_worker
    with _warm_worker_lock:
        if _warm_worker is None:
            _warm_worker = WarmWorker(on_ready=on_ready)
        return _warm_worker


def restart_warm_worker() -> bool:
    """Restart the warm worker if one has been started. Returns whether it was.

    `_warm_worker_lock` only guards creating the singleton; the restart itself
    runs under the worker's own lock (see `WarmWorker.restart`). Released
    before restarting so waiting out an in-flight task does not also block
    `_get_warm_worker()`.
    """
    # A restart is how a different PsyNeuLink takes effect, and show_graph's
    # answers may differ under it (#22).
    from app.services import show_graph_cache
    show_graph_cache.clear()

    with _warm_worker_lock:
        worker = _warm_worker
    if worker is None:
        return False
    worker.restart()
    return True


# ── Giving way ────────────────────────────────────────────────────────
#
# The worker takes one task at a time, so a task nobody is waiting for (the
# probe of every PsyNeuLink example, #175) can hold up a model the user has
# just opened. Work sent from inside ``giving_way()`` waits, before each of
# its tasks, until no user-requested task is waiting for or using the worker.
# A task already running is never interrupted: the user's task follows it.

_user_tasks = 0  # user-requested tasks waiting for, or using, the worker
_user_tasks_cond = threading.Condition()
_giving_way = threading.local()


@contextmanager
def giving_way():
    """Tasks sent from this thread while inside let user-requested work go first."""
    before = getattr(_giving_way, "on", False)
    _giving_way.on = True
    try:
        yield
    finally:
        _giving_way.on = before


def gives_way() -> bool:
    """Whether work sent from this thread lets user-requested work go first."""
    return bool(getattr(_giving_way, "on", False))


def wait_for_user_tasks() -> None:
    """Block until no user-requested task is waiting for or using the worker."""
    with _user_tasks_cond:
        _user_tasks_cond.wait_for(lambda: _user_tasks == 0)


@contextmanager
def _user_task():
    """Count a user-requested task from the moment it asks for the worker."""
    global _user_tasks
    with _user_tasks_cond:
        _user_tasks += 1
    try:
        yield
    finally:
        with _user_tasks_cond:
            _user_tasks -= 1
            _user_tasks_cond.notify_all()


def run_in_sandbox(task: str, params: dict, timeout: int | None = None) -> dict:
    """Run a task using the warm worker process.

    Falls back to cold-start subprocess if the warm worker fails.
    """
    # Every task that executes a model file names it here. Assistant-written
    # content runs only once reviewed (#179); a user's own file costs one lookup.
    require_runnable(params.get("file_path"))

    if timeout is None:
        # introspect with developer_mode=True actually runs the script's
        # .run/.learn calls (#273 / #249), so it needs the longer run-timeout.
        if task in ("run", "learn") or (task == "introspect" and params.get("developer_mode")):
            timeout = RUN_TIMEOUT
        else:
            timeout = INTROSPECT_TIMEOUT

    if gives_way():
        wait_for_user_tasks()
        worker = _get_warm_worker()
        result = worker.send_task(task, params, timeout)
    else:
        with _user_task():
            worker = _get_warm_worker()
            result = worker.send_task(task, params, timeout)

    # If the warm worker failed, try a cold-start fallback
    if "error" in result and "Worker" in result["error"]:
        logger.info("Falling back to cold-start subprocess...")
        result = _run_cold(task, params, timeout)

    _raise_if_unreviewed_import(result)
    return result


def _raise_if_unreviewed_import(result: dict) -> None:
    """The worker's import guard stopped a tracked, unapproved file from
    being imported (#179): the same 409 as a refused open, naming that file."""
    if isinstance(result, dict) and result.get("unreviewed_import"):
        raise assistant_review.UnreviewedAssistantCode(
            result["unreviewed_import"], result.get("error"),
            reason="assistant_review_state_unreadable" if result.get("unreviewed_state") else None,
        )


def _run_cold(task: str, params: dict, timeout: int) -> dict:
    """Cold-start fallback: spawn a fresh subprocess (slow but reliable)."""
    payload = json.dumps({"task": task, "params": params, **assistant_review.worker_payload_extras()})
    t0 = time.time()

    try:
        result = subprocess.run(
            [sys.executable, WORKER_PATH],
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(Path(params.get("file_path", ".")).parent),
        )
        elapsed = time.time() - t0
        logger.info(f"[perf] cold sandbox {task}: {elapsed:.2f}s")

        if result.returncode != 0:
            # #1101: this used to drop only FutureWarning and then take the last
            # ten lines. PsyNeuLink emits warnings in volume, so for some models
            # those ten lines were all warnings and the traceback had been
            # pushed out of the window — "Script execution failed:" followed by
            # nothing that said why.
            stderr = result.stderr or ""
            error_msg = summarize_stderr(stderr)
            suppressed = count_stderr_warnings(stderr)
            payload = {"error": f"Script execution failed:\n{error_msg}"}
            if suppressed:
                # Carried alongside the error rather than folded into it, so a
                # caller can show them somewhere they do not crowd out the
                # reason the run stopped (#1101). Several of these are
                # substantive — a missing learnable Projection, for one — and
                # were previously only ever seen by accident, as the noise that
                # buried a failure.
                payload["warnings_suppressed"] = suppressed
                payload["warnings"] = stderr.strip()
            return payload

        stdout = result.stdout.strip()
        if not stdout:
            return {"error": "Worker produced no output"}

        marker = "###PSYNEUVIEW_RESULT###"
        if marker in stdout:
            json_str = stdout.split(marker)[-1].strip()
        else:
            json_str = stdout

        return json.loads(json_str)

    except subprocess.TimeoutExpired:
        return {
            "error": f"Script execution timed out after {timeout} seconds. "
            f"This may indicate an infinite loop or a very long computation."
        }
    except json.JSONDecodeError as e:
        return {"error": f"Failed to parse worker output: {e}"}
    except Exception as e:
        return {"error": f"Sandbox error: {e}"}
