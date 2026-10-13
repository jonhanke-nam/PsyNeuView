"""Tests for the file watcher service."""

import tempfile
import time
import threading
import pytest
from pathlib import Path
from app.services.watcher import ModelFileWatcher


@pytest.fixture
def tmp_file():
    """Create a temporary .py file to watch."""
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
        f.write("# initial content\n")
        f.flush()
        yield f.name
    Path(f.name).unlink(missing_ok=True)


@pytest.fixture
def watcher():
    """Create a fresh watcher instance."""
    w = ModelFileWatcher(debounce_ms=100)  # Fast debounce for tests
    yield w
    w.stop()


def test_watcher_detects_change(tmp_file, watcher):
    """Watcher detects when the file is modified externally."""
    changes = []
    event = threading.Event()

    def on_change(path):
        changes.append(path)
        event.set()

    watcher.watch(tmp_file, on_change)
    time.sleep(0.3)  # Let the observer start

    # Modify the file
    Path(tmp_file).write_text("# modified content\n")

    # Wait for callback
    event.wait(timeout=3)
    assert len(changes) >= 1
    assert changes[0] == tmp_file


def test_watcher_reports_a_change_it_did_not_write(tmp_file, watcher):
    """A write we did not record is reported, however soon it lands (#1152).

    This replaces a test for `suppress_next()`, which ignored *every* change for
    a second after the app wrote — including a genuine save from another editor.
    What identifies our own write now is the content we recorded.

    Only the positive half is asserted here. The first version also checked that
    our own write stays quiet, by sleeping and asserting nothing had fired — a
    negative timing assertion, which is flaky by construction and duly failed on
    CI while passing locally and on the other interpreter in the same run. That
    half is covered without the race by
    `test_external_edit_sync.py::test_psyneuview_own_write_does_not_fire`, which
    waits on the echo suppression rather than on the clock.
    """
    changes = []
    watcher.watch(tmp_file, lambda path: changes.append(path))
    time.sleep(0.3)

    # Record a write we never make, so the hash on disk cannot match it. If
    # recording alone suppressed the next event — the old timer's behaviour —
    # this foreign write would go unreported.
    watcher.note_internal_write(tmp_file, "# ours, never written\n")
    Path(tmp_file).write_text("# theirs\n")

    deadline = time.time() + 5
    while time.time() < deadline and not changes:
        time.sleep(0.02)
    assert changes, "a write we did not make must be reported"


def test_watcher_debounce(tmp_file, watcher):
    """Multiple rapid changes result in a single callback."""
    changes = []
    event = threading.Event()

    def on_change(path):
        changes.append(path)
        event.set()

    watcher.watch(tmp_file, on_change)
    time.sleep(0.3)

    # Rapid-fire modifications
    for i in range(5):
        Path(tmp_file).write_text(f"# change {i}\n")
        time.sleep(0.05)

    # Wait for debounced callback
    event.wait(timeout=3)
    time.sleep(0.5)  # Extra wait to ensure no more callbacks

    # Should have 1-2 callbacks, not 5
    assert 1 <= len(changes) <= 2


def test_watcher_stop(tmp_file, watcher):
    """After stop(), no more callbacks are fired."""
    changes = []

    def on_change(path):
        changes.append(path)

    watcher.watch(tmp_file, on_change)
    time.sleep(0.3)
    watcher.stop()
    time.sleep(0.2)

    # Modify after stop
    Path(tmp_file).write_text("# after stop\n")
    time.sleep(1.0)

    assert len(changes) == 0


def test_watcher_rewatch(tmp_file, watcher):
    """Calling watch() again switches to a new file."""
    changes_a = []
    changes_b = []

    with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f2:
        f2.write("# file b\n")
        f2.flush()
        file_b = f2.name

    try:
        watcher.watch(tmp_file, lambda p: changes_a.append(p))
        time.sleep(0.3)

        # Switch to file_b
        event = threading.Event()

        def on_b(p):
            changes_b.append(p)
            event.set()

        watcher.watch(file_b, on_b)
        time.sleep(0.3)

        # Modify file_b
        Path(file_b).write_text("# modified b\n")
        event.wait(timeout=3)

        assert len(changes_b) >= 1
        # Old file changes should not trigger
        Path(tmp_file).write_text("# modified a after switch\n")
        time.sleep(0.5)
        assert len(changes_a) == 0
    finally:
        Path(file_b).unlink(missing_ok=True)
