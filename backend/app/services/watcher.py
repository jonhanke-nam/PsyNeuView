"""Watch .py model files for external changes.

Uses watchdog to detect when the user edits the file in another editor.
Notifies connected WebSocket clients after a debounce period.
"""

import asyncio
import hashlib
import threading
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent


class ModelFileWatcher:
    """Watches a single .py file and calls a callback on changes."""

    def __init__(self, debounce_ms: int = 500):
        self._observer: Observer | None = None
        self._watched_path: str | None = None
        self._debounce_ms = debounce_ms
        self._callback = None
        self._timer: threading.Timer | None = None
        self._last_known_mtime: float = 0
        # Hash of the content we last knew about. Set when we start watching,
        # when PsyNeuView itself writes the file, and each time we fire. A
        # change whose content hashes to this is our own echo (or a no-op
        # save from the editor), so it is not an external edit.
        self._last_content_hash: str | None = None

    def watch(self, file_path: str, callback) -> None:
        """Start watching a file. callback(file_path) is called on external changes."""
        self.stop()
        self._watched_path = file_path
        self._callback = callback
        self._last_known_mtime = Path(file_path).stat().st_mtime
        self._last_content_hash = _hash_file(file_path)

        handler = _Handler(self)
        self._observer = Observer()
        # Watch the parent directory (watchdog requires directories)
        self._observer.schedule(handler, str(Path(file_path).parent), recursive=False)
        self._observer.daemon = True
        self._observer.start()

    def stop(self) -> None:
        """Stop watching."""
        if self._observer:
            self._observer.stop()
            self._observer = None
        if self._timer:
            self._timer.cancel()
            self._timer = None
        self._watched_path = None
        self._last_content_hash = None

    def note_internal_write(self, file_path: str, content: str) -> None:
        """Record content PsyNeuView itself just wrote to `file_path`.

        The watchdog event for our own write still arrives, but its content
        hashes to what we recorded here, so it is recognised as an echo and
        never reported as an external edit.
        """
        if not self._watched_path:
            return
        try:
            same_file = Path(file_path).resolve() == Path(self._watched_path).resolve()
        except OSError:
            return
        if same_file:
            self._last_content_hash = _hash_text(content)

    def _on_file_changed(self) -> None:
        """Called by the handler when the watched file changes.

        Only (re)starts the settle timer. Whether the file really changed is
        decided once it has settled (#1284): read at the event, a save that
        empties the file first (write in place, or move the original aside
        and create a new one) is seen half-written, its hash matches nothing
        we know, and our own save was reported as an outside edit.
        """
        if not self._watched_path:
            return
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(
            self._debounce_ms / 1000.0, self._fire_callback
        )
        self._timer.daemon = True
        self._timer.start()

    def _fire_callback(self) -> None:
        """The file has been quiet for the debounce window: did it change?"""
        path = self._watched_path
        if not path:
            return
        try:
            mtime = Path(path).stat().st_mtime
        except OSError:
            return
        if mtime == self._last_known_mtime:
            return
        self._last_known_mtime = mtime

        # Content check: our own writes (and no-op editor saves) hash to what
        # we already know about, so they are not external edits.
        current_hash = _hash_file(path)
        if current_hash is None or current_hash == self._last_content_hash:
            return
        self._last_content_hash = current_hash

        if self._callback and self._watched_path == path:
            self._callback(path)


class _Handler(FileSystemEventHandler):
    """Reacts to any event that can mean "the model file now has new content".

    Editors do not agree on how to save. Writing in place is only one way;
    JetBrains IDEs default to "safe write" and VS Code can be configured for
    atomic saves, both of which write a temp file and rename it over the
    original, and some editors move the original aside and create a fresh file.
    Depending on the platform's backend those arrive as created/moved rather
    than modified, so watching only for modification means a save from a real
    IDE can go unseen.

    Matching on the destination as well as the source path is what catches the
    rename: for a safe write, the watched file is where the temp file lands.

    Cheap to be broad here — the watcher re-checks mtime and content hash
    before reporting anything, so a spurious event costs a stat and a hash.
    """

    def __init__(self, watcher: ModelFileWatcher):
        self._watcher = watcher

    def _touches_watched_file(self, event) -> bool:
        if event.is_directory:
            return False
        watched = self._watcher._watched_path
        if not watched:
            return False
        try:
            target = Path(watched).resolve()
        except OSError:
            return False
        for attr in ("src_path", "dest_path"):
            raw = getattr(event, attr, None)
            if not raw:
                continue
            try:
                if Path(raw).resolve() == target:
                    return True
            except OSError:
                continue
        return False

    def _handle(self, event):
        if self._touches_watched_file(event):
            self._watcher._on_file_changed()

    # Save in place.
    on_modified = _handle
    # Save by rename — the temp file becomes the watched file.
    on_moved = _handle
    # Save by replacing the file outright.
    on_created = _handle


def _hash_text(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _hash_file(file_path: str) -> str | None:
    try:
        return hashlib.sha256(Path(file_path).read_bytes()).hexdigest()
    except OSError:
        return None


class WatchRegistry:
    """One watcher per watched file, shared by everyone who has it open (#272).

    There used to be a single ModelFileWatcher for the whole server. Each
    window's "watch this file" re-pointed it, so with two windows on different
    models only the one asked last was watched; and any window closing stopped
    it, so every other window silently stopped noticing outside edits. Now each
    subscriber (a WebSocket) watches its own file: a file's watcher starts with
    its first subscriber, keeps its baseline as others join (a second window
    doesn't swallow a pending change), and stops only when its last one leaves.
    """

    def __init__(self, debounce_ms: int = 500):
        self._debounce_ms = debounce_ms
        self._lock = threading.Lock()
        self._watchers: dict[str, ModelFileWatcher] = {}
        self._subscribers: dict[str, set] = {}
        self._file_of: dict[object, str] = {}

    @staticmethod
    def _key(file_path: str) -> str:
        try:
            return str(Path(file_path).resolve())
        except OSError:
            return file_path

    def subscribe(self, subscriber, file_path: str, callback) -> None:
        """``subscriber`` follows ``file_path``; ``callback(file_path)`` runs on
        an outside change. A subscriber follows one file: subscribing again
        moves it."""
        key = self._key(file_path)
        stop = None
        with self._lock:
            previous = self._file_of.get(subscriber)
            if previous == key:
                return
            if previous is not None:
                stop = self._leave(subscriber, previous)
            self._file_of[subscriber] = key
            self._subscribers.setdefault(key, set()).add(subscriber)
            watcher = self._watchers.get(key)
            if watcher is None:
                watcher = ModelFileWatcher(debounce_ms=self._debounce_ms)
                self._watchers[key] = watcher
                watcher.watch(file_path, callback)
        if stop is not None:
            stop.stop()

    def unsubscribe(self, subscriber) -> None:
        """``subscriber`` follows nothing now (it paused, or it went away)."""
        with self._lock:
            key = self._file_of.get(subscriber)
            stop = self._leave(subscriber, key) if key is not None else None
        if stop is not None:
            stop.stop()

    def _leave(self, subscriber, key: str):
        """Drop ``subscriber`` from ``key``; return the watcher to stop if it
        was the last one (stopped outside the lock)."""
        self._file_of.pop(subscriber, None)
        subs = self._subscribers.get(key)
        if subs is not None:
            subs.discard(subscriber)
            if not subs:
                self._subscribers.pop(key, None)
                return self._watchers.pop(key, None)
        return None

    def subscribers(self, file_path: str) -> set:
        """Who follows ``file_path`` now."""
        with self._lock:
            return set(self._subscribers.get(self._key(file_path), ()))

    def watched_paths(self) -> list[str]:
        with self._lock:
            return list(self._watchers)

    def note_internal_write(self, file_path: str, content: str) -> None:
        """PsyNeuView itself wrote ``file_path``: not an outside edit."""
        with self._lock:
            watcher = self._watchers.get(self._key(file_path))
        if watcher is not None:
            watcher.note_internal_write(file_path, content)

    def stop(self) -> None:
        """Stop watching everything (shutdown, tests)."""
        with self._lock:
            watchers = list(self._watchers.values())
            self._watchers.clear()
            self._subscribers.clear()
            self._file_of.clear()
        for watcher in watchers:
            watcher.stop()


# The server's watchers: one per watched file (#272).
file_watcher = WatchRegistry()
