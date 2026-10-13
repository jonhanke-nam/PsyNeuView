"""Reload when PsyNeuLink's own code changes in a local checkout (#1225).

With a local editable checkout as the source, a user can change PsyNeuLink
itself: a Mechanism's code, a Function, anything under ``psyneulink/``. The
model runner imported PsyNeuLink once and keeps it, so without this the open
model went on running the old code until the app restarted, and nothing said
so.

This watches the checkout's ``psyneulink/`` package. After a change settles it
restarts the model runner, so the next run imports the new code, then hands the
changed file to a callback, which re-reads the open model and tells the app.

Only a local checkout is watched. GitHub and PyPI installs change only when
PsyNeuView reinstalls them, and that path already restarts the runner.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from app.services import pnl_source_guard, sandbox

logger = logging.getLogger(__name__)

# Saving in an editor is often several events (write, rename, chmod), and a
# git checkout is hundreds. Wait for them to stop before reloading once.
DEBOUNCE_S = 1.0


class PsyNeuLinkCodeWatcher:
    def __init__(self, debounce_s: float = DEBOUNCE_S):
        self._debounce_s = debounce_s
        self._lock = threading.Lock()
        self._observer: Optional[Observer] = None
        self._package: Optional[Path] = None
        self._timer: Optional[threading.Timer] = None
        self._changed: list[str] = []
        self._on_reload: Optional[Callable[[list[str]], None]] = None
        self._ignore: Callable[[str], bool] = lambda path: False
        self._started_at = 0.0

    @property
    def watching(self) -> Optional[Path]:
        return self._package

    def ensure(self, on_reload: Callable[[list[str]], None], ignore: Callable[[str], bool]) -> Optional[Path]:
        """Watch the active install's package if it's a local checkout.

        Idempotent, and re-points the watch when the source has switched. The
        ``ignore`` predicate skips a file already watched on its own (the open
        model), so an edit to it isn't reported twice.
        """
        active = pnl_source_guard._active_install()
        package = None
        if active is not None and active[0] == "local":
            candidate = active[1] / "psyneulink"
            package = candidate if candidate.is_dir() else None
        with self._lock:
            self._on_reload = on_reload
            self._ignore = ignore
            if package == self._package:
                return package
            self._stop_locked()
            if package is not None:
                self._started_at = time.time()
                observer = Observer()
                observer.schedule(_Handler(self), str(package), recursive=True)
                observer.daemon = True
                observer.start()
                self._observer = observer
                self._package = package
                logger.info("pnl code watcher: watching %s", package)
        return package

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._observer is not None:
            self._observer.stop()
            self._observer = None
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self._package = None
        self._changed = []

    def note_change(self, path: str) -> None:
        if not path.endswith(".py") or "__pycache__" in path or self._ignore(path):
            return
        # macOS replays events from just before the watch began (FSEvents), so
        # a file untouched since then isn't a change. A deleted one still is.
        try:
            if os.stat(path).st_mtime < self._started_at:
                return
        except OSError:
            pass
        with self._lock:
            if path not in self._changed:
                self._changed.append(path)
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._debounce_s, self._reload)
            self._timer.daemon = True
            self._timer.start()

    def _reload(self) -> None:
        with self._lock:
            changed, self._changed = self._changed, []
            self._timer = None
            on_reload = self._on_reload
        if not changed:
            return
        logger.info("pnl code watcher: %d PsyNeuLink file(s) changed; restarting the runner", len(changed))
        try:
            sandbox.restart_warm_worker()
        except Exception:
            logger.exception("pnl code watcher: runner restart failed")
        if on_reload is not None:
            on_reload(changed)


class _Handler(FileSystemEventHandler):
    def __init__(self, watcher: PsyNeuLinkCodeWatcher):
        self._watcher = watcher

    def on_any_event(self, event):
        if event.is_directory or event.event_type in ("opened", "closed_no_write"):
            return
        for path in (getattr(event, "src_path", None), getattr(event, "dest_path", None)):
            if path:
                self._watcher.note_change(str(path))


pnl_code_watcher = PsyNeuLinkCodeWatcher()
