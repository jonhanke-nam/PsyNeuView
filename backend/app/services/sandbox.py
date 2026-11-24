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
import os
import selectors
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from app.services import os_sandbox
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

    #: How the worker script is started: a persistent worker that runs task
    #: after task in one process.
    MODE = "--persistent"
    NAME = "Warm worker"
    #: A line that says the task's process ended (the fork server's child).
    DONE_MARKER: str | None = None
    NEW_SESSION = False

    def _start(self):
        """Spawn the worker process and make it current."""
        self._proc = self._spawn()

    def _spawn(self) -> subprocess.Popen | None:
        """Start a worker process in persistent mode and wait until it is
        ready. Returns it, or None if it couldn't be started."""
        t0 = time.time()
        try:
            proc = subprocess.Popen(
                [sys.executable, WORKER_PATH, self.MODE],
                # A pool worker started under the sandbox applies its policy
                # before anything else (#311).
                env=getattr(self, "_launch_env", None),
                # A pool worker leads its own process group, so what its model
                # started ends with it (#187).
                start_new_session=self.NEW_SESSION,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # line-buffered
            )
            started_cb = getattr(self, "_on_popen", None)
            if started_cb is not None:
                started_cb(proc)
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

    @staticmethod
    def _kill(proc: subprocess.Popen | None) -> None:
        if proc is None:
            return
        try:
            proc.kill()
            proc.wait(timeout=2)
        except Exception:
            pass

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
        logger.info(f"Restarting {self.NAME.lower()}...")
        self._kill(self._proc)
        self._proc = None
        self._start()

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        """Send a task to the warm worker and wait for the result.

        While anything the assistant wrote is tracked (or the review state
        can't be read), the task goes to the fork server instead, so it runs
        in a process no earlier model touched (#187). Decided here, from the
        state the server reads itself, never from anything in a worker."""
        # Under the operating-system sandbox too (#311): each task applies
        # its own policy, which a process can do only once.
        if assistant_review.worker_must_be_fresh() or os_sandbox.active():
            return _isolated_worker().send_task(task, params, timeout)
        with self._lock:
            if not self.is_alive():
                self._restart()
            if not self.is_alive():
                return {"error": f"{self.NAME} failed to start"}
            return self._send(task, params, timeout)

    def _before_payload(self, deadline: float) -> dict | None:
        """A step before the task is written; an error dict stops the task."""
        return None

    def _is_result_marker(self, line: str) -> bool:
        # At the end of a line: what a leftover wrote without a newline may
        # sit in front of it (#311, V1).
        return line.endswith(RESULT_MARKER)

    def _on_timeout(self) -> None:
        self._restart()

    def _sandbox_extras(self) -> dict:
        """What the task carries for the operating-system sandbox (#311)."""
        return {}

    def _raw_lines(self) -> "_Lines":
        """A raw line reader for the current process's output, kept with it."""
        if getattr(self, "_raw", None) is None or self._raw_for is not self._proc:
            self._raw = _Lines(self._proc.stdout.fileno())
            self._raw_for = self._proc
        return self._raw

    def _send(self, task: str, params: dict, timeout: int) -> dict:
        """Send one task to the current process. Caller holds `self._lock`."""
        payload = json.dumps({"task": task, "params": params, **assistant_review.worker_payload_extras(),
                              **self._sandbox_extras()})
        t0 = time.time()

        try:
            stopped = self._before_payload(time.time() + timeout)
            if stopped is not None:
                return stopped
            # Send the task
            self._proc.stdin.write(payload + "\n")
            self._proc.stdin.flush()

            # Raw bytes from the fd, lines built here with caps, the deadline
            # and the process checked on every pass: a leftover holding the
            # pipe and writing without newlines can't hold this thread (and
            # the pool's lock) in a readline (#311, V1).
            lines = self._raw_lines()
            output_lines = []
            kept = 0
            deadline = time.time() + timeout
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    logger.warning(f"{self.NAME} timed out after {timeout}s")
                    self._on_timeout()
                    return {
                        "error": f"Script execution timed out after {timeout} seconds. "
                        f"This may indicate an infinite loop or a very long computation."
                    }
                try:
                    line = lines.next(min(deadline, time.time() + 0.5))
                except EOFError:
                    self._restart()
                    return {"error": "Worker closed connection"}
                if line is None:
                    if self._proc.poll() is not None:
                        self._restart()
                        return {"error": "Worker process died during execution"}
                    continue
                if self._is_result_marker(line):
                    try:
                        result_line = lines.next(deadline)
                    except EOFError:
                        result_line = None
                    if result_line is None:
                        self._restart()
                        return {"error": "Worker closed connection"}
                    elapsed = time.time() - t0
                    logger.info(f"[perf] warm worker {task}: {elapsed:.2f}s")
                    try:
                        return json.loads(result_line)
                    except json.JSONDecodeError as e:
                        return {"error": f"Failed to parse worker output: {e}"}
                elif self.DONE_MARKER and line.startswith(self.DONE_MARKER):
                    # The task's own process ended without an answer.
                    return {"error": "Worker process died during execution"}
                else:
                    kept += len(line)
                    if kept < 16 * 1024 * 1024:  # bounded by size (#311, U4)
                        output_lines.append(line)

        except (BrokenPipeError, OSError) as e:
            logger.warning(f"Warm worker pipe error: {e}, restarting...")
            self._restart()
            return {"error": f"Worker communication error: {e}"}


#: The longest line read from a worker; an answer is one line of JSON.
_MAX_LINE = 64 * 1024 * 1024


class _Lines:
    """Lines read from a raw fd without blocking past a deadline (no text
    buffering between ``select`` and the read, so nothing is hidden)."""

    def __init__(self, fd: int):
        self.fd = fd
        self.buf = b""

    def next(self, deadline: float) -> str | None:
        """The next line, or None at the deadline; raises EOFError at the end."""
        import os
        import select
        while b"\n" not in self.buf:
            if len(self.buf) > _MAX_LINE:
                # A line longer than any answer: what a leftover writes.
                # Dropped, so it can't grow without end (#311, V1).
                self.buf = b""
            remaining = deadline - time.time()
            if remaining <= 0:
                return None
            ready, _, _ = select.select([self.fd], [], [], min(0.5, remaining))
            if not ready:
                continue
            data = os.read(self.fd, 65536)
            if not data:
                raise EOFError
            self.buf += data
        line, _, self.buf = self.buf.partition(b"\n")
        return line.decode("utf-8", "replace")

    def ready(self) -> bool:
        import select
        return b"\n" in self.buf or bool(select.select([self.fd], [], [], 0)[0])


class ForkServer(WarmWorker):
    """A clean parent that forks one child per task (#187).

    While anything the assistant wrote is tracked, no task may run in a
    process an earlier model touched: everything in a worker, the import
    guard included, is reachable from the model code it runs. Starting a
    new worker per task costs PsyNeuLink's import (seconds). Instead this
    parent imports PsyNeuLink and the guard once and runs no model code at
    all; it reads nothing from the server but ``FORK <token>``. For each
    task it forks a child on a pipe of its own and copies the child's
    output to our output pipe while the child runs, and for a short fixed
    time after, then closes it. The parent's own messages (ready, the
    child's pid, the child's end) come on a separate control pipe that no
    child holds, so nothing a child or a process it started writes can be
    taken for one; a timeout ends only a pid from that pipe. The child's
    answer must carry the token made for that task. A fork takes
    milliseconds. Nothing a child does in memory reaches the parent or the
    next child. A process it starts that leaves its process group
    (``setsid``) can outlive the task and write into that task's copy until
    it is closed, and files it writes stay written: in-process protection
    covers memory only (#311 closes the rest).
    """

    MODE = "--fork-server"
    NAME = "Fork server"
    CHILD_MARKER = "###PSYNEUVIEW_CHILD###"
    DONE_MARKER = "###PSYNEUVIEW_CHILD_DONE###"
    #: After this many tasks in a row the parent couldn't run, the pool is used instead.
    MAX_FAILURES = 3

    def __init__(self):
        self._child_pid: int | None = None
        self._task_policy: dict | None = None
        self._token = ""
        self._control: _Lines | None = None
        self._out: _Lines | None = None
        self.failures = 0
        super().__init__()

    def _spawn(self) -> subprocess.Popen | None:
        import os
        t0 = time.time()
        control_r, control_w = os.pipe()
        try:
            proc = subprocess.Popen(
                [sys.executable, WORKER_PATH, self.MODE, "--control-fd", str(control_w)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                pass_fds=(control_w,), bufsize=0,
                # Its own session: a task's processes can't join one of the
                # user's process groups (#311, U1).
                start_new_session=True,
            )
        except Exception as e:
            logger.error(f"Failed to start the fork server: {e}")
            os.close(control_r)
            os.close(control_w)
            return None
        os.close(control_w)
        threading.Thread(target=self._drain_stderr, args=(proc.stderr,), daemon=True).start()
        control = _Lines(control_r)
        try:
            line = control.next(time.time() + WORKER_READY_TIMEOUT)
        except EOFError:
            line = None
        if line != "###READY###":
            logger.error("The fork server did not signal ready; ending it")
            self._kill(proc)
            os.close(control_r)
            return None
        self._close_channels()
        self._control = control
        self._out = _Lines(proc.stdout.fileno())
        logger.info(f"[perf] Fork server started in {time.time() - t0:.2f}s (PID {proc.pid})")
        return proc

    def _close_channels(self) -> None:
        import os
        if self._control is not None:
            try:
                os.close(self._control.fd)
            except OSError:
                pass
        self._control = None
        self._out = None

    def _restart(self):
        self._kill(self._proc)
        self._proc = None
        self._close_channels()
        self._start()

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        with self._lock:
            if not self.is_alive():
                self._restart()
            if not self.is_alive():
                self.failures += 1
                return {"error": f"{self.NAME} failed to start"}
            # The child applies this task's own policy before reading the
            # model (#311): the unapproved files as they are now, its own folder.
            self._task_policy = os_sandbox.policy(model_path=params.get("file_path")) if os_sandbox.active() else None
            try:
                result = os_sandbox.check_applied(self._send(task, params, timeout), self._task_policy)
                _note_model_folder(result, self._task_policy)
            finally:
                self._child_pid = None
                if self._task_policy:
                    os_sandbox.discard_scratch(self._task_policy.get("scratch"))
                    os_sandbox.sweep_survivors()
                self._task_policy = None
            return result

    def _sandbox_extras(self) -> dict:
        p = self._task_policy
        return {"os_sandbox": p, "os_sandbox_key": p["key"]} if p else {}

    def _write(self, text: str) -> None:
        self._proc.stdin.write(text.encode())
        self._proc.stdin.flush()

    def _send(self, task: str, params: dict, timeout: int) -> dict:
        import secrets
        payload = json.dumps({"task": task, "params": params, **assistant_review.worker_payload_extras(),
                              **self._sandbox_extras()})
        self._token = secrets.token_hex(16)
        self._child_pid = None
        deadline = time.time() + timeout
        t0 = time.time()
        try:
            self._write(f"FORK {self._token}\n")
            # The child's pid, from the parent, before the child reads its task.
            line = self._control.next(min(deadline, time.time() + 30))
            if line is None or not line.startswith(self.CHILD_MARKER):
                self.failures += 1
                self._restart()
                return {"error": "Worker did not start the task"}
            self._child_pid = int(line.split()[1])
            self._write(payload + "\n")
            result = None
            expected = f"{RESULT_MARKER} {self._token}"
            while True:
                if self._control.ready():
                    done = self._control.next(time.time() + 1)
                    if done is not None and done.startswith(self.DONE_MARKER):
                        # The child has ended: its answer, if any, is already
                        # in our output pipe.
                        result = self._answer_in_hand(expected)
                        break
                line = self._out.next(min(deadline, time.time() + 0.2))
                if line is None:
                    if time.time() >= deadline:
                        return self._timed_out(timeout)
                    continue
                if result is None and line == expected:
                    answer = self._out.next(deadline)
                    if answer is None:
                        return self._timed_out(timeout)
                    try:
                        result = json.loads(answer)
                    except json.JSONDecodeError as e:
                        result = {"error": f"Failed to parse worker output: {e}"}
                    # The child's end follows on the control pipe; wait a
                    # little for it so the next task starts in step.
                    self._wait_done(time.time() + 5)
                    break
            self.failures = 0
            logger.info(f"[perf] fork server {task}: {time.time() - t0:.2f}s")
            return result if result is not None else {"error": "Worker process died during execution"}
        except (BrokenPipeError, OSError, EOFError, ValueError) as e:
            self.failures += 1
            logger.warning(f"Fork server channel error: {e}; restarting it")
            self._restart()
            return {"error": f"Worker communication error: {e}"}

    def _answer_in_hand(self, expected: str) -> dict | None:
        """The answer among what is already waiting on our output pipe."""
        while self._out.ready():
            line = self._out.next(time.time() + 0.5)
            if line is None:
                return None
            if line == expected:
                answer = self._out.next(time.time() + 1)
                try:
                    return json.loads(answer) if answer is not None else None
                except json.JSONDecodeError as e:
                    return {"error": f"Failed to parse worker output: {e}"}
        return None

    def _wait_done(self, until: float) -> bool:
        """Wait for the parent to say the child has ended, reading and
        dropping whatever else is copied meanwhile, so the parent is never
        held up writing to a full pipe."""
        while time.time() < until:
            if self._control.ready():
                line = self._control.next(until)
                if line is not None and line.startswith(self.DONE_MARKER):
                    return True
                continue
            self._out.next(min(until, time.time() + 0.05))
        return False

    def _timed_out(self, timeout: int) -> dict:
        logger.warning(f"{self.NAME} task timed out after {timeout}s")
        self._on_timeout()
        if not self._wait_done(time.time() + 5):
            # The parent is stuck: start a new one.
            self.failures += 1
            self._restart()
        return {"error": f"Script execution timed out after {timeout} seconds. "
                         f"This may indicate an infinite loop or a very long computation."}

    def _on_timeout(self) -> None:
        """The child ran too long: end it (and its process group, which the
        parent made). The pid is the one the parent sent on the control pipe."""
        import os
        import signal
        pid = self._child_pid
        if pid and pid > 1:
            for kill in (lambda: os.killpg(pid, signal.SIGKILL), lambda: os.kill(pid, signal.SIGKILL)):
                try:
                    kill()
                except OSError:
                    pass


# Global warm worker instance — started on first use
_warm_worker: WarmWorker | None = None
_warm_worker_lock = threading.Lock()
class _PoolMember(WarmWorker):
    """One pre-started worker that runs exactly one task. On any trouble it
    is ended, never restarted in place: the pool starts a new one."""

    NAME = "Pool worker"
    NEW_SESSION = True

    @staticmethod
    def _kill(proc: subprocess.Popen | None) -> None:
        """The worker and everything in its process group."""
        if proc is None:
            return
        import signal
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        WarmWorker._kill(proc)

    def __init__(self, proc: subprocess.Popen):
        self._proc = proc
        self._stderr_thread = None
        self._lock = threading.Lock()
        self._on_ready = None

    def _sandbox_extras(self) -> dict:
        task_policy = getattr(self, "_task_policy", None)
        if task_policy:
            return {"os_sandbox": task_policy, "os_sandbox_key": task_policy["key"]}
        p = getattr(self._proc, "_os_sandbox_policy", None)
        return {"os_sandbox_key": p["key"]} if p else {}

    def _restart(self):
        self._kill(self._proc)
        self._proc = None


class WorkerPool:
    """The fallback where forking isn't available or isn't safe (#187):
    worker processes started ahead, each used for one task and then ended,
    so a task still runs in a process no earlier model touched. ``size``
    are kept ready (``PSYNEUVIEW_WORKER_POOL_SIZE``, default 2), so a burst
    of tasks doesn't wait for PsyNeuLink's import; a task that finds none
    ready starts one."""

    NAME = "Worker pool"

    def __init__(self, size: int | None = None):
        try:
            size = size or int(os.environ.get("PSYNEUVIEW_WORKER_POOL_SIZE", "2"))
        except ValueError:
            size = 2
        self.size = max(1, min(size, 8))
        self._ready: list[subprocess.Popen] = []
        self._starting = 0
        #: Spares being started: (their process once it exists, when they began).
        self._inflight: dict[int, list] = {}
        self._cond = threading.Condition()
        self._lock = threading.Lock()
        self._fill()

    def _fill(self) -> None:
        with self._cond:
            wanted = self.size - len(self._ready) - self._starting
            self._starting += max(0, wanted)
        for _ in range(max(0, wanted)):
            threading.Thread(target=self._start_one, daemon=True, name="worker-pool").start()

    def _start_one(self) -> None:
        # Linux: a pool worker's policy is set when it starts, and doesn't open
        # any model's folder, so a ready worker fits every task (a worker per
        # model folder made the next task wait on a start, #311).
        token = object()
        entry = [None, time.time()]
        with self._cond:
            self._inflight[id(token)] = entry
        proc = _spawn_worker_process(None, on_popen=lambda p: entry.__setitem__(0, p))
        with self._cond:
            self._inflight.pop(id(token), None)
            self._starting -= 1
            if proc is not None:
                self._ready.append(proc)
            self._cond.notify_all()

    def _take(self) -> subprocess.Popen | None:
        deadline = time.time() + WORKER_READY_TIMEOUT
        # A worker started under another sandbox policy (or none, or one when
        # none is wanted) can't take this task: its policy was applied when
        # it started (#311). It is ended unused.
        model_path = getattr(self, "_model_path", None)
        # macOS: workers start unsandboxed and take each task's own policy
        # (so any ready worker will do); Linux: the policy is set at start.
        want = os_sandbox.policy_key(None) if (os_sandbox.active() and not _POOL_PER_TASK) else None
        with self._cond:
            while True:
                while self._ready:
                    proc = self._ready.pop(0)
                    have = (getattr(proc, "_os_sandbox_policy", None) or {}).get("key")
                    if proc.poll() is None and have == want and not _older_than_model_folder(proc, model_path):
                        return proc
                    _PoolMember._kill(proc)
                    _discard_launch_scratch(proc)
                # A spare still starting that can't fit this task (Linux: it
                # began before the model's folder last changed) isn't waited
                # for: it is ended, so it doesn't take the CPU from the
                # task's own worker, which starts at once (#311).
                stale = [e for e in self._inflight.values() if _started_before_model_folder(e[1], model_path)]
                for entry in stale:
                    if entry[0] is not None:
                        _PoolMember._kill(entry[0])
                if self._starting == 0 or len(stale) >= self._starting or time.time() > deadline:
                    break
                self._cond.wait(timeout=0.5)
        return _spawn_worker_process(None)

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        with self._lock:
            self._model_path = params.get("file_path")
            proc = self._take()
            self._fill()
            if proc is None:
                return {"error": f"{self.NAME} failed to start a worker"}
            member = _PoolMember(proc)
            task_policy = (os_sandbox.policy(model_path=params.get("file_path"))
                           if _POOL_PER_TASK and os_sandbox.active() else None)
            member._task_policy = task_policy
            try:
                with member._lock:
                    return os_sandbox.check_applied(member._send(task, params, timeout),
                                                    task_policy or getattr(proc, "_os_sandbox_policy", None))
            finally:
                _PoolMember._kill(member._proc if member._proc is not None else proc)
                if task_policy:
                    os_sandbox.discard_scratch(task_policy.get("scratch"))
                launched = getattr(proc, "_os_sandbox_policy", None)
                _discard_launch_scratch(proc)  # no longer a running task's, before the sweep looks
                if task_policy or launched:
                    os_sandbox.sweep_survivors()

    def is_alive(self) -> bool:
        return True

    def restart(self) -> None:
        """End every ready worker (they imported an earlier PsyNeuLink) and start new ones."""
        with self._cond:
            ready, self._ready = self._ready, []
        for proc in ready:
            _PoolMember._kill(proc)
        self._fill()


def _spawn_worker_process(model_path: str | None = None, on_popen=None) -> subprocess.Popen | None:
    """A persistent worker, ready, that has run no task. Under the sandbox
    (#311) it is started with the policy as it is now, and applies it
    before importing anything."""
    member = _PoolMember.__new__(_PoolMember)
    member._on_ready = None
    member._stderr_thread = None
    # Its policy is set when it starts, so it is made for the model the pool
    # last ran: the same model again (the live preview) finds one ready.
    policy = os_sandbox.policy(model_path=model_path) if (os_sandbox.active() and not _POOL_PER_TASK) else None
    member._launch_env = os_sandbox.launch_env(policy) if policy else None
    member._on_popen = on_popen
    started = time.time()
    proc = WarmWorker._spawn(member)
    if proc is not None:
        proc._os_sandbox_policy = policy
        proc._os_sandbox_started = started
    elif policy:
        os_sandbox.discard_scratch(policy["scratch"])
    return proc


def _note_model_folder(result, policy: dict | None) -> None:
    """Say so when the model's own folder couldn't be opened for writing
    (#311): it is, holds or sits in a protected place."""
    note = (policy or {}).get("model_dir_note")
    if not note or not isinstance(result, dict):
        return
    message = f"Sandbox: {note}; the model can write only in its task folder and the declared output folders."
    result["os_sandbox_notice"] = message
    model = result.get("model") if isinstance(result.get("model"), dict) else result
    notices = model.get("notices")
    if isinstance(notices, list):
        notices.append(message)
    else:
        model["notices"] = [message]
    logger.info(message)


#: macOS pool workers apply each task's policy when it comes (#311).
_POOL_PER_TASK = sys.platform == "darwin"


def _started_before_model_folder(started: float, model_path: str | None) -> bool:
    if not sys.platform.startswith("linux") or not model_path or not os_sandbox.active():
        return False
    folder = os.path.dirname(os.path.abspath(model_path))
    try:
        newest = max([os.stat(folder).st_mtime] + [e.stat().st_mtime for e in os.scandir(folder)])
    except OSError:
        return True
    return newest >= started


def _older_than_model_folder(proc, model_path: str | None) -> bool:
    """Linux: Landlock's rules are fixed when a worker starts, and a file
    made since in a folder that holds a protected file isn't covered, so a
    pool worker started before the model's folder last changed can't be
    trusted to read it (#311). macOS rules follow paths."""
    if not sys.platform.startswith("linux") or not model_path or not getattr(proc, "_os_sandbox_policy", None):
        return False
    started = getattr(proc, "_os_sandbox_started", 0.0)
    folder = os.path.dirname(os.path.abspath(model_path))
    try:
        newest = max([os.stat(folder).st_mtime] + [e.stat().st_mtime for e in os.scandir(folder)])
    except OSError:
        return True
    return newest >= started


def _discard_launch_scratch(proc: subprocess.Popen | None) -> None:
    policy = getattr(proc, "_os_sandbox_policy", None)
    if policy:
        os_sandbox.discard_scratch(policy.get("scratch"))


def fork_is_usable() -> bool:
    """Whether the fork server can be used here: the os module has ``fork`` (not on
    native Windows) and the platform forks a process that has imported
    PsyNeuLink safely (Linux, WSL2, containers, macOS, checked in #187). The
    fork server's first child is the real check: if it can't start one,
    the pool is used from then on."""
    return hasattr(os, "fork") and sys.platform != "win32"


def isolation_mode() -> str:
    """``fork`` or ``pool``: how a task gets a process no earlier model
    touched. ``PSYNEUVIEW_WORKER_ISOLATION`` forces one (tests run both)."""
    forced = os.environ.get("PSYNEUVIEW_WORKER_ISOLATION", "").strip().lower()
    if forced in ("fork", "pool"):
        return forced
    if _fork_failed:
        return "pool"
    return "fork" if fork_is_usable() else "pool"


_fork_server: ForkServer | None = None
_pool: WorkerPool | None = None
_fork_server_lock = threading.Lock()
_fork_failed = False
_mode_logged: str | None = None


class _IsolatedFallback:
    """Sends to the fork server, and falls back to the pool for good if the
    fork server can't start a child."""

    def send_task(self, task: str, params: dict, timeout: int) -> dict:
        global _fork_failed, _mode_logged
        mode = isolation_mode()
        if mode != _mode_logged:
            logger.info(f"Assistant-written files are tracked: each task runs in a fresh process ({mode} mode)")
            _mode_logged = mode
        if mode == "fork":
            forks = _get_fork_server()
            result = forks.send_task(task, params, timeout)
            if forks.failures >= ForkServer.MAX_FAILURES and not os.environ.get("PSYNEUVIEW_WORKER_ISOLATION"):
                logger.warning("The fork server keeps failing here; using a pool of fresh workers instead")
                _fork_failed = True
            if result.get("error") in ("Worker did not start the task", "Worker process died before the task started",
                                       f"{ForkServer.NAME} failed to start") and not os.environ.get("PSYNEUVIEW_WORKER_ISOLATION"):
                logger.warning("The fork server couldn't start a task here; using a pool of fresh workers instead")
                _fork_failed = True
                return _get_pool().send_task(task, params, timeout)
            return result
        return _get_pool().send_task(task, params, timeout)


def _isolated_worker() -> _IsolatedFallback:
    return _IsolatedFallback()


def _get_fork_server() -> ForkServer:
    """The fork server, started on first use while something is tracked."""
    global _fork_server
    with _fork_server_lock:
        if _fork_server is None:
            _fork_server = ForkServer()
        return _fork_server


def _get_warm_worker(on_ready: Optional[Callable[[bool, float], None]] = None) -> WarmWorker:
    """The singleton, started on first use. ``on_ready`` reaches the worker
    only when this call creates it (see ``WarmWorker``); a caller that finds
    one already running gets no callback, and can tell by the return."""
    global _warm_worker
    with _warm_worker_lock:
        if _warm_worker is None:
            _warm_worker = WarmWorker(on_ready=on_ready)
        return _warm_worker


def _get_pool() -> WorkerPool:
    global _pool
    with _fork_server_lock:
        if _pool is None:
            _pool = WorkerPool()
        return _pool


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

    with _fork_server_lock:
        forks, pool = _fork_server, _pool
    # Both hold processes that imported the PsyNeuLink being replaced.
    if forks is not None:
        forks.restart()
    if pool is not None:
        pool.restart()
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
    refused = os_sandbox.refusal()
    if refused:
        raise os_sandbox.SandboxRefused(refused)
    # Nothing an earlier task left running may see this one (#311, T3).
    if os_sandbox.active():
        os_sandbox.sweep_survivors()

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
    # Under the sandbox (#311) the one-shot worker applies the policy first thing.
    policy = os_sandbox.policy(model_path=params.get("file_path")) if os_sandbox.active() else None
    extras = {"os_sandbox_key": policy["key"]} if policy else {}
    payload = json.dumps({"task": task, "params": params, **assistant_review.worker_payload_extras(), **extras})
    t0 = time.time()

    try:
        try:
            # Output read with a cap, and not past the worker's own exit (#311, U4).
            from app.services import bounded_run
            result = bounded_run.run([sys.executable, WORKER_PATH], input=payload, timeout=timeout,
                                     cwd=str(Path(params.get("file_path", ".")).parent),
                                     env=os_sandbox.launch_env(policy) if policy else None)
            if result.timed_out:
                raise subprocess.TimeoutExpired([WORKER_PATH], timeout)
        finally:
            if policy:
                os_sandbox.discard_scratch(policy["scratch"])
                os_sandbox.sweep_survivors()
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

        return os_sandbox.check_applied(json.loads(json_str), policy)

    except subprocess.TimeoutExpired:
        return {
            "error": f"Script execution timed out after {timeout} seconds. "
            f"This may indicate an infinite loop or a very long computation."
        }
    except json.JSONDecodeError as e:
        return {"error": f"Failed to parse worker output: {e}"}
    except Exception as e:
        return {"error": f"Sandbox error: {e}"}
