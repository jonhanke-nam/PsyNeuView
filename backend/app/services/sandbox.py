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
from pathlib import Path
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

RESULT_MARKER = "###PSYNEWVIEW_RESULT###"


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
        """Spawn the worker process in persistent mode."""
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
                return

            elapsed = time.time() - t0
            self._proc = proc
            if ready_line == "###READY###":
                logger.info(f"[perf] Warm worker started in {elapsed:.2f}s (PID {proc.pid})")
            else:
                logger.warning(f"Warm worker sent unexpected ready signal: {ready_line!r}")
            self._notify_ready(True, elapsed)
        except Exception as e:
            logger.error(f"Failed to start warm worker: {e}")
            self._proc = None
            self._notify_ready(False, time.time() - t0)

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
        if self._proc:
            try:
                self._proc.kill()
                self._proc.wait(timeout=2)
            except Exception:
                pass
        self._proc = None
        self._start()

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        """Send a task to the warm worker and wait for the result."""
        with self._lock:
            if not self.is_alive():
                self._restart()
            if not self.is_alive():
                return {"error": "Warm worker failed to start"}

            payload = json.dumps({"task": task, "params": params})
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
    with _warm_worker_lock:
        worker = _warm_worker
    if worker is None:
        return False
    worker.restart()
    return True


def run_in_sandbox(task: str, params: dict, timeout: int | None = None) -> dict:
    """Run a task using the warm worker process.

    Falls back to cold-start subprocess if the warm worker fails.
    """
    if timeout is None:
        # introspect with developer_mode=True actually runs the script's
        # .run/.learn calls (#273 / #249), so it needs the longer run-timeout.
        if task in ("run", "learn") or (task == "introspect" and params.get("developer_mode")):
            timeout = RUN_TIMEOUT
        else:
            timeout = INTROSPECT_TIMEOUT

    worker = _get_warm_worker()
    result = worker.send_task(task, params, timeout)

    # If the warm worker failed, try a cold-start fallback
    if "error" in result and "Worker" in result["error"]:
        logger.info("Falling back to cold-start subprocess...")
        return _run_cold(task, params, timeout)

    return result


def _run_cold(task: str, params: dict, timeout: int) -> dict:
    """Cold-start fallback: spawn a fresh subprocess (slow but reliable)."""
    payload = json.dumps({"task": task, "params": params})
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

        marker = "###PSYNEWVIEW_RESULT###"
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
