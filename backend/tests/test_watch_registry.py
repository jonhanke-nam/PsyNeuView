"""One watcher per watched file, for every window that has it open (#272).

There was one watcher for the whole server: each window's "watch this file"
re-pointed it, so only the window asked last was watched, and any window
closing stopped it for everyone. Found by an e2e that waited for an outside
edit while other test pages, on the same server, opened and closed.
"""

import time
from pathlib import Path

import pytest

from app.services.watcher import WatchRegistry

DEBOUNCE_MS = 100
SETTLE_S = 5.0


def _wait_for(predicate, timeout=SETTLE_S):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def registry():
    r = WatchRegistry(debounce_ms=DEBOUNCE_MS)
    yield r
    r.stop()


def _model(tmp_path: Path, name: str) -> Path:
    f = tmp_path / name
    f.write_text("import psyneulink as pnl\n")
    return f


def _edit(f: Path, line: str) -> None:
    time.sleep(0.05)  # a different mtime
    f.write_text(f.read_text() + line + "\n")


def test_two_windows_on_two_files_each_hear_their_own(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    (tmp_path / "b").mkdir()
    b = _model(tmp_path / "b", "b.py")
    heard: list[str] = []
    registry.subscribe("window-a", str(a), lambda p: heard.append(p))
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    # Before #272 the second subscription re-pointed the only watcher.
    _edit(a, "# edited elsewhere")
    assert _wait_for(lambda: str(a) in heard), "window a's file is still watched"
    assert registry.subscribers(str(a)) == {"window-a"}
    assert registry.subscribers(str(b)) == {"window-b"}


def test_a_window_closing_leaves_the_others_watching(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    (tmp_path / "b").mkdir()
    b = _model(tmp_path / "b", "b.py")
    heard: list[str] = []
    registry.subscribe("window-a", str(a), lambda p: heard.append(p))
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    registry.unsubscribe("window-b")  # closed: before #272, everyone's watch stopped
    _edit(a, "# edited elsewhere")
    assert _wait_for(lambda: str(a) in heard)
    assert str(Path(b).resolve()) not in registry.watched_paths()


def test_a_file_stops_being_watched_with_its_last_window(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    registry.subscribe("w1", str(a), lambda p: None)
    registry.subscribe("w2", str(a), lambda p: None)
    registry.unsubscribe("w1")
    assert registry.watched_paths() == [str(a.resolve())]
    registry.unsubscribe("w2")
    assert registry.watched_paths() == []


def test_a_second_window_on_the_same_file_keeps_a_pending_change(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    heard: list[str] = []
    registry.subscribe("w1", str(a), lambda p: heard.append(p))
    _edit(a, "# edited elsewhere")
    # Joining doesn't re-arm the watcher, so the change isn't absorbed.
    registry.subscribe("w2", str(a), lambda p: heard.append(p))
    assert _wait_for(lambda: heard)


def test_moving_to_another_file_follows_it(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    (tmp_path / "b").mkdir()
    b = _model(tmp_path / "b", "b.py")
    registry.subscribe("w", str(a), lambda p: None)
    registry.subscribe("w", str(b), lambda p: None)
    assert registry.watched_paths() == [str(b.resolve())]


def test_our_own_write_is_not_an_outside_edit(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    heard: list[str] = []
    registry.subscribe("w", str(a), lambda p: heard.append(p))
    content = a.read_text() + "# written by PsyNeuView\n"
    registry.note_internal_write(str(a), content)
    time.sleep(0.05)
    a.write_text(content)
    assert not _wait_for(lambda: heard, timeout=1.0)
