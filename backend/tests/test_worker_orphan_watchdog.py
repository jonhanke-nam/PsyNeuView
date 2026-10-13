"""Guard: a sandbox worker must not outlive its parent backend (#864).

A user hit a worker pinned at 100% CPU for ~3 minutes — it had been orphaned
(parent restarted) mid-spin, so the parent's introspect timeout no longer
applied and nothing reaped it. The worker now installs an orphan watchdog; these
tests orphan a real worker and assert it exits, including while spinning in pure
Python (the case a GIL-blocked thread alone can't catch).
"""

import os
import subprocess
import sys
import time
from pathlib import Path

WORKER_PATH = str(
    Path(__file__).resolve().parent.parent / "app" / "services" / "sandbox_worker.py"
)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _spawn_worker_under_killable_parent(first_task: str | None = None) -> tuple[int, subprocess.Popen]:
    """Launch the worker under an intermediate parent we can kill, so killing
    that parent orphans the worker exactly as a backend restart does. Returns
    (worker_pid, parent_proc). If first_task is given, the parent feeds it to the
    worker's stdin before idling — used to put the worker into a spin."""
    feed = (
        f"p.stdin.write({first_task!r}+chr(10));p.stdin.flush();" if first_task else ""
    )
    code = (
        "import subprocess,sys,time;"
        f"p=subprocess.Popen([sys.executable,{WORKER_PATH!r},'--persistent'],"
        "stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1);"
        # wait for READY so the watchdog is installed and the worker is live
        "line=p.stdout.readline();"
        f"{feed}"
        "sys.stdout.write(str(p.pid)+chr(10));sys.stdout.flush();"
        "time.sleep(120)"
    )
    parent = subprocess.Popen(
        [sys.executable, "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        cwd=str(Path(WORKER_PATH).resolve().parent.parent.parent),  # backend/
    )
    worker_pid = int(parent.stdout.readline().strip())
    return worker_pid, parent


def _assert_dies_after_orphaning(worker_pid: int, parent: subprocess.Popen, budget_s: float = 10.0):
    assert _alive(worker_pid), "worker should be alive before we orphan it"
    parent.kill()  # orphan the worker
    parent.wait(timeout=5)
    deadline = time.time() + budget_s
    while time.time() < deadline:
        if not _alive(worker_pid):
            break
        time.sleep(0.25)
    dead = not _alive(worker_pid)
    if not dead:
        try:
            os.kill(worker_pid, 9)  # don't leak the process if the test fails
        except ProcessLookupError:
            pass
    assert dead, f"orphaned worker {worker_pid} did not exit within {budget_s}s"


def test_idle_worker_dies_when_orphaned():
    """An idle worker whose parent dies must self-exit (daemon-thread path)."""
    worker_pid, parent = _spawn_worker_under_killable_parent()
    _assert_dies_after_orphaning(worker_pid, parent)


def test_spinning_worker_dies_when_orphaned():
    """A worker spinning in *pure Python* whose parent dies must still self-exit
    (SIGALRM path — the GIL-holding spin starves the daemon-thread path)."""
    # Introspecting a model with a module-level `while True` runs that loop
    # during the worker's exec step: a real pure-Python spin, exactly the shape
    # that pinned the user's worker at 100% CPU.
    spin_file = Path(WORKER_PATH).resolve().parent.parent.parent / "_orphan_spin_model.py"
    spin_file.write_text("while True:\n    pass\n")
    try:
        import json

        task = json.dumps({"task": "introspect", "params": {"file_path": str(spin_file)}})
        worker_pid, parent = _spawn_worker_under_killable_parent(first_task=task)
        # give it a moment to enter the spin
        time.sleep(1.0)
        _assert_dies_after_orphaning(worker_pid, parent)
    finally:
        spin_file.unlink(missing_ok=True)
