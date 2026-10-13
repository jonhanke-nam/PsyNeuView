"""The warm worker's ready handshake must be finite.

`_start()` used a plain `readline()` to wait for "###READY###". If the worker
never printed it — a crash during import, a hang, a machine slow enough to
exceed any budget — that call blocked forever. And `_start()` runs inside
`send_task()`'s lock via `_restart()`, so one stuck startup wedged *every*
later request.

That is what a two-mechanism model still "loading" after 65 seconds in CI
looked like, and it read as an e2e flake for weeks. `send_task()` already had
a deadline for exactly this reason; the handshake had been left behind.
"""

import sys
import textwrap
import time

import pytest

from app.services import sandbox


def _worker_stub(tmp_path, body: str) -> str:
    p = tmp_path / "stub_worker.py"
    p.write_text(textwrap.dedent(body))
    return str(p)


def test_a_worker_that_never_signals_ready_does_not_block_forever(tmp_path, monkeypatch):
    """The whole point: finite, not fast."""
    stub = _worker_stub(tmp_path, """
        import time
        time.sleep(300)  # never prints ###READY###
    """)
    monkeypatch.setattr(sandbox, "WORKER_PATH", stub)
    monkeypatch.setattr(sandbox, "WORKER_READY_TIMEOUT", 2)

    t0 = time.time()
    worker = sandbox.WarmWorker()
    elapsed = time.time() - t0

    assert elapsed < 30, f"start blocked for {elapsed:.1f}s — the handshake is unbounded again"
    # And it gives up cleanly rather than leaving a half-alive worker behind.
    assert not worker.is_alive()


def test_a_stuck_worker_does_not_wedge_later_requests(tmp_path, monkeypatch):
    """The reason it mattered: _start() holds the lock the whole time."""
    stub = _worker_stub(tmp_path, """
        import time
        time.sleep(300)
    """)
    monkeypatch.setattr(sandbox, "WORKER_PATH", stub)
    monkeypatch.setattr(sandbox, "WORKER_READY_TIMEOUT", 2)

    worker = sandbox.WarmWorker()
    t0 = time.time()
    result = worker.send_task("anything", {}, timeout=5)
    elapsed = time.time() - t0

    assert elapsed < 30, f"send_task blocked for {elapsed:.1f}s behind a stuck startup"
    assert "error" in result


def test_a_healthy_worker_still_starts(tmp_path, monkeypatch):
    """The bound must not break the normal path."""
    stub = _worker_stub(tmp_path, """
        import sys
        print("###READY###", flush=True)
        for _ in sys.stdin:
            pass
    """)
    monkeypatch.setattr(sandbox, "WORKER_PATH", stub)
    monkeypatch.setattr(sandbox, "WORKER_READY_TIMEOUT", 30)

    worker = sandbox.WarmWorker()
    assert worker.is_alive()
    worker._proc.kill()
