"""Memory, processor-time and process-count limits for model runs (#179, B3).

Two layers, so a limit holds on every platform:

* **In the task's process**, before any model code runs, the worker sets
  operating-system limits (``setrlimit``, in ``os_sandbox_apply.apply_run_limits``):
  processor seconds (``RLIMIT_CPU``) and the number of processes
  (``RLIMIT_NPROC``) everywhere, and memory (``RLIMIT_DATA``) on Linux. A
  process that runs one task (a fork server's child, a pool worker, the
  one-shot fallback, a Learn job) gets them as hard limits it can't raise;
  the warm worker, which runs many tasks, gets soft ones, reset per task.
  macOS refuses any memory ``setrlimit``, so there:
* **The server watches** the task's process and everything it started
  (``Watch``): each one's memory, their number and their processor time
  together since the task began. Over a limit, it ends them all and the run answers
  with a plain-English reason, never "the worker died".

The limits are generous by default and set by environment variables, within
bounds: ``PSYNEUVIEW_RUN_MEMORY_MB`` (memory per process of the run; default
half the computer's memory, at least 2 GB), ``PSYNEUVIEW_RUN_CPU_SECONDS`` (default 7200) and
``PSYNEUVIEW_RUN_PROCESSES`` (default 256 more processes than the user
already has; on Linux the kernel counts threads here).
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from typing import Callable

logger = logging.getLogger(__name__)

MEMORY_ENV = "PSYNEUVIEW_RUN_MEMORY_MB"
CPU_ENV = "PSYNEUVIEW_RUN_CPU_SECONDS"
PROCESSES_ENV = "PSYNEUVIEW_RUN_PROCESSES"

CPU_DEFAULT = 7200
CPU_BOUNDS = (2, 86_400)
PROCESSES_DEFAULT = 256
PROCESSES_BOUNDS = (8, 4096)
MEMORY_MIN_DEFAULT = 2048
MEMORY_BOUNDS_MIN = 256

#: How often the server looks at a running task.
POLL_SECONDS = 0.25

#: The reasons a run is stopped, as the worker and the server name them.
MEMORY, CPU, PROCESSES = "memory", "cpu", "processes"


def _physical_mb() -> int:
    try:
        return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // (1024 * 1024))
    except (ValueError, OSError, AttributeError):
        try:
            import psutil
            return int(psutil.virtual_memory().total // (1024 * 1024))
        except Exception:  # noqa: BLE001
            return 8192


def _bounded(env: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(env, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning(f"{env}={raw!r} isn't a whole number; using {default}")
        return default
    if not low <= value <= high:
        logger.warning(f"{env}={value} is outside {low} to {high}; using the nearest bound")
    return max(low, min(value, high))


def limits() -> dict:
    """The limits as configured now: ``memory_mb``, ``cpu_seconds``, ``processes``."""
    total = _physical_mb()
    memory_default = max(MEMORY_MIN_DEFAULT, total // 2)
    return {
        "memory_mb": _bounded(MEMORY_ENV, min(memory_default, total), MEMORY_BOUNDS_MIN, max(total, MEMORY_BOUNDS_MIN)),
        "cpu_seconds": _bounded(CPU_ENV, CPU_DEFAULT, *CPU_BOUNDS),
        "processes": _bounded(PROCESSES_ENV, PROCESSES_DEFAULT, *PROCESSES_BOUNDS),
    }


# ── the user's own processes (RLIMIT_NPROC counts them all) ─────────────

_count_lock = threading.Lock()
_count_cache: tuple[float, int] | None = None
#: The count is reused this long: it changes slowly, and the allowance absorbs it.
COUNT_TTL = 10.0


def _user_process_count() -> int | None:
    """What ``RLIMIT_NPROC`` counts for this user now: processes (macOS) or
    threads (Linux). None when it can't be counted (no limit is set then)."""
    global _count_cache
    with _count_lock:
        now = time.monotonic()
        if _count_cache and now - _count_cache[0] < COUNT_TTL:
            return _count_cache[1]
        try:
            import psutil
        except Exception:  # noqa: BLE001
            return None
        uid = os.getuid()
        n = 0
        linux = sys.platform.startswith("linux")
        attrs = ["uids", "num_threads"] if linux else ["uids"]
        for p in psutil.process_iter(attrs):
            uids = p.info.get("uids")
            if uids is not None and uids.real == uid:
                n += (p.info.get("num_threads") or 1) if linux else 1
        _count_cache = (now, n)
        return n


def payload(one_task: bool) -> dict:
    """What a task carries for the worker to apply before the model runs."""
    if not hasattr(os, "getuid"):
        return {}
    lim = dict(limits())
    lim["hard"] = bool(one_task)
    lim["base_processes"] = _user_process_count()
    return {"run_limits": lim}


# ── plain English ───────────────────────────────────────────────────────


class RunStopped(RuntimeError):
    """A model run a limit stopped; the app answers 422 with the reason."""

    def __init__(self, reason: str, text: str):
        super().__init__(text)
        self.reason = reason



def message(reason: str, lim: dict | None = None) -> str:
    lim = lim or limits()
    if reason == MEMORY:
        return (f"The model was stopped because it used more than {lim['memory_mb']} MB of memory in one "
                f"process, the limit for a model run. If the model really needs more, raise {MEMORY_ENV} before starting PsyNeuView.")
    if reason == CPU:
        return (f"The model was stopped because it used more than {lim['cpu_seconds']} seconds of processor "
                f"time, the limit for a model run. If the model really needs more, raise {CPU_ENV} before "
                f"starting PsyNeuView.")
    return (f"The model was stopped because it started too many processes (more than {lim['processes']}), "
            f"the limit for a model run. If the model really needs more, raise {PROCESSES_ENV} before "
            f"starting PsyNeuView.")


#: Text the worker's own limits leave in an error, and what it means.
_SIGNS = (
    (("RunLimitExceeded: cpu",), CPU),
    (("MemoryError",), MEMORY),
    (("Resource temporarily unavailable",), PROCESSES),  # fork() under RLIMIT_NPROC (EAGAIN)
)


def explain(result, reason: str | None = None) -> dict:
    """``result`` with a plain-English error when a limit stopped the run:
    ``reason`` from the server's watch, or what the worker's own limits left
    in the error. Marked ``run_limit`` so it is never retried elsewhere."""
    if not isinstance(result, dict):
        return result
    if reason is None:
        # The error, or a notice: a load whose module-level code failed can
        # still find the model's definitions, and says so as a notice.
        texts = [result.get("error")] + list(result.get("notices") or [])
        text = "\n".join(t for t in texts if isinstance(t, str))
        reason = next((r for signs, r in _SIGNS if all(x in text for x in signs)), None)
        if reason is None:
            return result
    out = dict(result)
    out["error"] = message(reason)
    out["run_limit"] = reason
    return out


def exit_reason(returncode: int | None) -> str | None:
    """A process ended by the kernel's processor-time limit."""
    sig = getattr(signal, "SIGXCPU", None)
    return CPU if sig is not None and returncode == -sig else None


# ── the server's watch ──────────────────────────────────────────────────


def _footprint_reader():
    """macOS: a process's physical footprint (``proc_pid_rusage``), which
    counts compressed and swapped-out memory too. Resident memory alone
    drops when the system compresses or swaps a growing process, so a model
    could pass the limit unseen under memory pressure. None elsewhere."""
    if sys.platform != "darwin":
        return None
    try:
        import ctypes
        import ctypes.util
        libproc = ctypes.CDLL(ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib", use_errno=True)

        class _RusageInfoV0(ctypes.Structure):
            _fields_ = [("uuid", ctypes.c_uint8 * 16), ("user_time", ctypes.c_uint64),
                        ("system_time", ctypes.c_uint64), ("pkg_idle_wkups", ctypes.c_uint64),
                        ("interrupt_wkups", ctypes.c_uint64), ("pageins", ctypes.c_uint64),
                        ("wired_size", ctypes.c_uint64), ("resident_size", ctypes.c_uint64),
                        ("phys_footprint", ctypes.c_uint64), ("proc_start_abstime", ctypes.c_uint64),
                        ("proc_exit_abstime", ctypes.c_uint64)]

        def read(pid: int) -> int | None:
            info = _RusageInfoV0()
            if libproc.proc_pid_rusage(int(pid), 0, ctypes.byref(info)) != 0:
                return None
            return int(info.phys_footprint)
        return read
    except Exception:  # noqa: BLE001 - resident memory is used instead
        return None


_footprint = _footprint_reader()


def _memory(p) -> int:
    """A process's memory for the limit: its footprint on macOS, else resident."""
    if _footprint is not None:
        value = _footprint(p.pid)
        if value is not None:
            return value
    return p.memory_info().rss



class Watch:
    """Watches one task's process and everything it started, from a thread
    of the server, until ``stop``. Over a limit it ends them all (and calls
    ``end`` with the task's pid, for the worker's own way of ending it) and
    keeps the reason. ``pid`` is a function, since a fork server's child is
    known only once the task has started."""

    def __init__(self, pid: Callable[[], int | None], end: Callable[[int], None], lim: dict | None = None):
        self.reason: str | None = None
        self._pid = pid
        self._end = end
        self._lim = lim or limits()
        self._stop = threading.Event()
        try:
            import psutil  # noqa: F401
        except Exception:  # noqa: BLE001 - the worker's own limits still hold
            return
        self._thread = threading.Thread(target=self._run, daemon=True, name="run-limits")
        self._thread.start()

    def stop(self) -> str | None:
        self._stop.set()
        return self.reason

    def _run(self) -> None:
        import psutil
        mem = self._lim["memory_mb"] * 1024 * 1024
        cpu_limit = self._lim["cpu_seconds"]
        nproc = self._lim["processes"]
        root = None
        cpu_base: dict[int, float] = {}
        while not self._stop.wait(POLL_SECONDS):
            pid = self._pid()
            if not pid:
                continue
            try:
                if root is None or root.pid != pid:
                    root = psutil.Process(pid)
                    cpu_base = {}
                procs = [root] + root.children(recursive=True)
            except psutil.Error:
                continue
            rss = cpu = 0.0
            for p in procs:
                try:
                    # Per process: forked children share their parent's
                    # pages, so a sum would count them many times over.
                    rss = max(rss, _memory(p))
                    t = p.cpu_times()
                    used = t.user + t.system
                    # A warm worker has run earlier tasks: only this task's time counts.
                    cpu += used - cpu_base.setdefault(p.pid, used if p is root else 0.0)
                except psutil.Error:
                    pass
            reason = (MEMORY if rss > mem else PROCESSES if len(procs) > nproc
                      else CPU if cpu > cpu_limit else None)
            if reason is None:
                continue
            if self._stop.is_set():
                return
            self.reason = reason
            logger.warning(f"Model run stopped by the {reason} limit (pid {pid})")
            for p in reversed(procs):
                try:
                    p.kill()
                except psutil.Error:
                    pass
            try:
                self._end(pid)
            except Exception:  # noqa: BLE001
                pass
            return
