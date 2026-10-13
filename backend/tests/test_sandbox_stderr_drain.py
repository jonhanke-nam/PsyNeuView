"""Regression: the warm sandbox worker must not deadlock on heavy stderr (#810).

The parent only reads the worker's *stdout* (for the result marker). If the
worker writes enough to stderr to fill the ~64KB OS pipe buffer, it blocks
mid-write and never emits the result — the parent then hits the task timeout and
returns a 500. Warning-heavy introspections (notably EGO) tripped this
intermittently, surfacing as "Failed to load reference model" toasts and a flaky
flat-view tutorial. `WarmWorker` now drains stderr in a background thread.

This test spawns a synthetic worker that floods stderr *past* the pipe buffer
before returning its result. Without the drain the task deadlocks and
`send_task` returns a timeout error; with it, the result comes straight back.
"""

import json

import pytest

from app.services import sandbox
from app.services.sandbox import WarmWorker

# A minimal worker speaking the persistent protocol: announce ready, then for
# each task flood stderr well past the ~64KB pipe buffer before emitting the
# result marker + JSON on stdout.
_SYNTHETIC_WORKER = '''\
import sys
print("###READY###", flush=True)
for _line in sys.stdin:
    sys.stderr.write("x" * 300_000 + "\\n")  # >> 64KB OS pipe buffer
    sys.stderr.flush()
    print("###PSYNEWVIEW_RESULT###", flush=True)
    print(\'{"ok": true}\', flush=True)
'''


@pytest.fixture
def synthetic_worker_path(tmp_path, monkeypatch):
    script = tmp_path / "flood_stderr_worker.py"
    script.write_text(_SYNTHETIC_WORKER)
    monkeypatch.setattr(sandbox, "WORKER_PATH", str(script))
    return script


def test_warm_worker_survives_heavy_stderr(synthetic_worker_path):
    worker = WarmWorker()
    try:
        assert worker.is_alive(), "synthetic worker failed to start"
        # 15s is ample for the trivial synthetic task; the *only* way to exceed
        # it is the stderr-pipe deadlock the drain thread is here to prevent.
        result = worker.send_task("introspect", {}, timeout=15)
        assert "error" not in result, result.get("error")
        assert result == {"ok": True}
    finally:
        worker._restart()  # tears down the spawned subprocess
        if worker._proc:
            worker._proc.kill()


def test_warm_worker_has_stderr_drain_thread(synthetic_worker_path):
    worker = WarmWorker()
    try:
        assert worker._stderr_thread is not None
        assert worker._stderr_thread.is_alive()
        assert worker._stderr_thread.daemon
    finally:
        worker._restart()
        if worker._proc:
            worker._proc.kill()
