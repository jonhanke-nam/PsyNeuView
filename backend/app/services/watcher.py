"""Watch .py model files for external changes.

Uses watchdog to detect when the user edits the file in another editor.
Notifies connected WebSocket clients after a debounce period.
"""

import hashlib
import logging
import threading
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

logger = logging.getLogger(__name__)


class WatchUnavailable(RuntimeError):
    """A folder could not be watched, so edits to files in it won't be seen."""


class ModelFileWatcher:
    """Watches a single .py file and calls a callback on changes."""

    def __init__(self, debounce_ms: int = 500, folders: "_FolderWatches | None" = None):
        # Shared with every other watcher in the process (#308): a folder is
        # scheduled once, however many watched files it holds.
        self._folders = folders if folders is not None else folder_watches
        self._folder: str | None = None
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
        """Start watching a file. callback(file_path) is called on external changes.

        Raises WatchUnavailable if the file's folder can't be watched.
        """
        self.stop()
        self._watched_path = file_path
        self._callback = callback
        self._last_known_mtime = Path(file_path).stat().st_mtime
        self._last_content_hash = _hash_file(file_path)

        # Watch the parent directory (watchdog requires directories).
        folder = _resolved(str(Path(file_path).parent))
        try:
            self._folders.add(folder, self)
        except WatchUnavailable:
            self._watched_path = None
            self._callback = None
            self._last_content_hash = None
            raise
        self._folder = folder

    def stop(self) -> None:
        """Stop watching."""
        if self._folder is not None:
            self._folders.remove(self._folder, self)
            self._folder = None
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


class _FolderHandler(FileSystemEventHandler):
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

    One handler per watched folder (#308), shared by every watched file in it:
    each event goes to each of those files' watchers, and a watcher acts only
    on events that touch its own file.
    """

    def __init__(self):
        # Replaced whole (never mutated) under _FolderWatches' lock, so this
        # thread can read it without taking that lock. The observer holds its
        # own lock while dispatching to us, and _FolderWatches holds its lock
        # while (un)scheduling, which takes the observer's: taking ours here
        # would deadlock the two.
        self.watchers: tuple[ModelFileWatcher, ...] = ()

    def _handle(self, event):
        if event.is_directory:
            return
        touched = set()
        for attr in ("src_path", "dest_path"):
            raw = getattr(event, attr, None)
            if raw:
                touched.add(_resolved(raw))
        for watcher in self.watchers:
            watched = watcher._watched_path
            if watched and _resolved(watched) in touched:
                watcher._on_file_changed()

    # Save in place.
    on_modified = _handle
    # Save by rename — the temp file becomes the watched file.
    on_moved = _handle
    # Save by replacing the file outright.
    on_created = _handle


def _resolved(path: str) -> str:
    try:
        return str(Path(path).resolve())
    except OSError:
        return path


class _FolderWatches:
    """Every watched folder, each scheduled once on one shared observer (#308).

    Each watched file used to bring its own observer on its own parent folder.
    macOS's FSEvents allows one watch per folder in the whole process, so a
    second file in a folder already watched failed to schedule ("Cannot add
    watch ... it is already scheduled"), on the observer's own thread, where
    nobody saw it: that file was simply never watched. Now a folder is
    scheduled with its first watched file, shared by any others, and
    unscheduled when the last one leaves.
    """

    # How long to wait for a freshly scheduled folder's watch to fail. On
    # macOS the watch is added on the emitter's own thread, which on success
    # never returns; a failure ends that thread at once.
    _START_CHECK_S = 0.05

    def __init__(self, observer_factory=Observer):
        self._observer_factory = observer_factory
        self._lock = threading.Lock()
        self._observer = None
        self._folders: dict[str, tuple[object, _FolderHandler]] = {}

    def _running_observer(self):
        if self._observer is None or not self._observer.is_alive():
            self._observer = self._observer_factory()
            self._observer.daemon = True
            self._observer.start()
        return self._observer

    def add(self, folder: str, watcher: "ModelFileWatcher") -> None:
        with self._lock:
            entry = self._folders.get(folder)
            if entry is not None:
                handler = entry[1]
                if watcher not in handler.watchers:
                    handler.watchers = handler.watchers + (watcher,)
                return
            handler = _FolderHandler()
            handler.watchers = (watcher,)
            try:
                observer = self._running_observer()
                watch = observer.schedule(handler, folder, recursive=False)
            except Exception as e:
                logger.warning("Can't watch %s for outside edits: %s", folder, e)
                raise WatchUnavailable(f"Can't watch {folder}: {e}") from e
            if not self._started(observer, watch):
                logger.warning(
                    "Can't watch %s for outside edits: the watch stopped as it started", folder)
                self._unschedule(observer, watch)
                raise WatchUnavailable(f"Can't watch {folder}")
            self._folders[folder] = (watch, handler)

    def _started(self, observer, watch) -> bool:
        emitter = getattr(observer, "_emitter_for_watch", {}).get(watch)
        if emitter is None:
            return True  # nothing to check against: assume it is running
        emitter.join(self._START_CHECK_S)
        return emitter.is_alive()

    @staticmethod
    def _unschedule(observer, watch) -> None:
        try:
            observer.unschedule(watch)
        except Exception as e:  # already gone; nothing more to stop
            logger.debug("Unscheduling %s: %s", watch, e)

    def remove(self, folder: str, watcher: "ModelFileWatcher") -> None:
        with self._lock:
            entry = self._folders.get(folder)
            if entry is None:
                return
            watch, handler = entry
            handler.watchers = tuple(w for w in handler.watchers if w is not watcher)
            if handler.watchers:
                return
            del self._folders[folder]
            if self._observer is not None:
                self._unschedule(self._observer, watch)

    def scheduled_folders(self) -> list[str]:
        with self._lock:
            return list(self._folders)


# The process's watched folders: FSEvents allows each to be watched once (#308).
folder_watches = _FolderWatches()


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
        moves it. Raises WatchUnavailable, following nothing, if the file's
        folder can't be watched."""
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
            failed = None
            if watcher is None:
                watcher = ModelFileWatcher(debounce_ms=self._debounce_ms)
                try:
                    watcher.watch(file_path, callback)
                except WatchUnavailable as e:
                    # Not watched, so not followed: say so rather than look
                    # as if it were (#308).
                    self._leave(subscriber, key)
                    failed = e
                else:
                    self._watchers[key] = watcher
        if stop is not None:
            stop.stop()
        if failed is not None:
            raise failed

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
