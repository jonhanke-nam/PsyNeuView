"""One watcher per watched file, for every window that has it open (#272),
and one watch per folder however many of those files it holds (#308).

There was one watcher for the whole server: each window's "watch this file"
re-pointed it, so only the window asked last was watched, and any window
closing stopped it for everyone. Found by an e2e that waited for an outside
edit while other test pages, on the same server, opened and closed.
"""

import logging
import os
import time
from pathlib import Path

import pytest

import app.services.watcher as watcher_module
from app.services.watcher import WatchRegistry, WatchUnavailable, _FolderWatches, folder_watches

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


# --- Two files in one folder (#308) -----------------------------------------
#
# Each file used to get its own observer on its parent folder. macOS's FSEvents
# refuses a second watch on a folder already watched ("Cannot add watch ... it
# is already scheduled"), so the second file in a folder went unwatched, with
# nothing said. Folders are now scheduled once and shared.


def test_two_files_in_one_folder_are_both_watched(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    b = _model(tmp_path, "b.py")
    heard: list[str] = []
    registry.subscribe("window-a", str(a), lambda p: heard.append(p))
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    _edit(b, "# edited elsewhere")
    assert _wait_for(lambda: str(b) in heard), "the second file in the folder is watched"
    _edit(a, "# edited elsewhere")
    assert _wait_for(lambda: str(a) in heard), "the first file in the folder is watched"


def test_closing_one_window_leaves_the_other_file_in_its_folder_watched(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    b = _model(tmp_path, "b.py")
    heard: list[str] = []
    registry.subscribe("window-a", str(a), lambda p: heard.append(p))
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    registry.unsubscribe("window-a")  # a's file was the one that scheduled the folder
    _edit(b, "# edited elsewhere")
    assert _wait_for(lambda: str(b) in heard)
    assert str(tmp_path.resolve()) in folder_watches.scheduled_folders()


def test_the_folder_is_unscheduled_with_its_last_file(registry, tmp_path):
    a = _model(tmp_path, "a.py")
    b = _model(tmp_path, "b.py")
    folder = str(tmp_path.resolve())
    registry.subscribe("window-a", str(a), lambda p: None)
    registry.subscribe("window-b", str(b), lambda p: None)
    assert folder_watches.scheduled_folders().count(folder) == 1
    registry.unsubscribe("window-a")
    registry.unsubscribe("window-b")
    assert folder not in folder_watches.scheduled_folders()
    # And it can be watched again: the old watch really is gone.
    heard: list[str] = []
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    _edit(b, "# edited elsewhere")
    assert _wait_for(lambda: str(b) in heard)


def test_a_save_by_rename_is_noticed_beside_another_open_file(registry, tmp_path):
    # PyCharm's "safe write" and vim write a temp file and rename it over the
    # original; watchdog reports that as moved (or created), not modified.
    a = _model(tmp_path, "a.py")
    b = _model(tmp_path, "b.py")
    heard: list[str] = []
    registry.subscribe("window-a", str(a), lambda p: heard.append(p))
    registry.subscribe("window-b", str(b), lambda p: heard.append(p))
    time.sleep(0.05)
    tmp = tmp_path / "b.py.tmp~"
    tmp.write_text(b.read_text() + "# saved by rename\n")
    os.replace(tmp, b)
    assert _wait_for(lambda: str(b) in heard), "the rename-over save is seen"
    assert str(a) not in heard, "the neighbour's watcher ignores it"


def test_two_windows_on_one_file_beside_another_file(registry, tmp_path):
    # #274's case, two windows on the same file, still holds with a
    # neighbour sharing the folder.
    a = _model(tmp_path, "a.py")
    b = _model(tmp_path, "b.py")
    heard: list[str] = []
    registry.subscribe("w1", str(a), lambda p: heard.append(p))
    registry.subscribe("w2", str(a), lambda p: heard.append(p))
    registry.subscribe("w3", str(b), lambda p: heard.append(p))
    assert registry.subscribers(str(a)) == {"w1", "w2"}
    registry.unsubscribe("w1")
    _edit(a, "# edited elsewhere")
    assert _wait_for(lambda: str(a) in heard)
    assert registry.subscribers(str(a)) == {"w2"}


class _RefusingObserver:
    """An observer whose every schedule fails, as FSEvents can."""

    daemon = True

    def start(self):
        pass

    def is_alive(self):
        return True

    def schedule(self, *args, **kwargs):
        raise RuntimeError("Cannot add watch - it is already scheduled")


def test_a_folder_that_cannot_be_watched_is_said_so(registry, tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(watcher_module, "folder_watches", _FolderWatches(_RefusingObserver))
    a = _model(tmp_path, "a.py")
    # The app's "app" logger doesn't propagate to the root, where caplog
    # listens, once app.main is imported; listen on the watcher's own logger.
    log = logging.getLogger("app.services.watcher")
    log.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.WARNING, logger="app.services.watcher"):
            with pytest.raises(WatchUnavailable):
                registry.subscribe("w", str(a), lambda p: None)
    finally:
        log.removeHandler(caplog.handler)
    assert any("Can't watch" in r.getMessage() for r in caplog.records)
    # Not watched, so not followed: nobody is told it's being watched.
    assert registry.watched_paths() == []
    assert registry.subscribers(str(a)) == set()
