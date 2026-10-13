"""Restarts from outside WarmWorker must take the worker's own lock (#1208).

`/api/test/reset` and the post-install hook restarted the worker under the
module-level `_warm_worker_lock`, while `send_task()` restarts under
`self._lock`. Two locks that do not exclude each other: an outside restart
could kill the process an in-flight task was talking to, and two overlapping
restarts could each publish a worker, leaving the loser running untracked.

The first version of #1205 tripped over exactly this — two restarts
interleaving inside one handshake took the tutorials suite from 29 passed to
21 failed.
"""

import subprocess
import textwrap
import threading
import time

from app.services import sandbox


def _worker_stub(tmp_path, body: str) -> str:
    p = tmp_path / "stub_worker.py"
    p.write_text(textwrap.dedent(body))
    return str(p)


def _live_pids(pid_dir) -> list[int]:
    """PIDs the stub recorded that are still running (zombies count as dead)."""
    live = []
    for f in pid_dir.iterdir():
        pid = int(f.name)
        stat = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True
        ).stdout.strip()
        if stat and not stat.startswith("Z"):
            live.append(pid)
    return live


def _slow_worker(tmp_path, monkeypatch, task_seconds: float):
    """A stub that records its PID, signals ready, and answers each task slowly."""
    pid_dir = tmp_path / "pids"
    pid_dir.mkdir()
    stub = _worker_stub(tmp_path, f"""
        import json, os, sys, time
        open(os.path.join({str(pid_dir)!r}, str(os.getpid())), "w").close()
        print("###READY###", flush=True)
        for _ in sys.stdin:
            time.sleep({task_seconds})
            print({sandbox.RESULT_MARKER!r}, flush=True)
            print(json.dumps({{"ok": True}}), flush=True)
    """)
    monkeypatch.setattr(sandbox, "WORKER_PATH", stub)
    monkeypatch.setattr(sandbox, "WORKER_READY_TIMEOUT", 30)
    return pid_dir


def _kill_all(pid_dir):
    for pid in _live_pids(pid_dir):
        subprocess.run(["kill", "-9", str(pid)])


def test_restart_waits_for_an_in_flight_task(tmp_path, monkeypatch):
    """A restart must not kill the process a running task is talking to."""
    pid_dir = _slow_worker(tmp_path, monkeypatch, task_seconds=3)
    worker = sandbox.WarmWorker()
    try:
        results = {}
        t = threading.Thread(
            target=lambda: results.setdefault("task", worker.send_task("run", {}, timeout=30))
        )
        t.start()
        time.sleep(1)  # the task is now mid-flight
        worker.restart()
        t.join(timeout=30)

        assert results.get("task") == {"ok": True}, (
            f"in-flight task was cut off by a restart: {results.get('task')!r}"
        )
        assert worker.is_alive()
    finally:
        _kill_all(pid_dir)


def test_overlapping_restarts_leave_exactly_one_worker(tmp_path, monkeypatch):
    """Two restarts at once must not leave an orphaned worker running."""
    pid_dir = _slow_worker(tmp_path, monkeypatch, task_seconds=0)
    worker = sandbox.WarmWorker()
    try:
        threads = [threading.Thread(target=worker.restart) for _ in range(4)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=60)

        live = _live_pids(pid_dir)
        assert worker.is_alive()
        assert live == [worker._proc.pid], (
            f"{len(live)} workers alive after overlapping restarts; expected only the tracked one"
        )
    finally:
        _kill_all(pid_dir)
