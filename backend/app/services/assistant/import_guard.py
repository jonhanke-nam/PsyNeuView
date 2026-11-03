"""Import-time guard for assistant-written files (#179).

A model that runs can import other files: a helper beside it, a package in
a subfolder, anything on ``sys.path``, through ``import``, ``importlib`` or
a relative path. If the assistant wrote one of those and nobody approved
it, importing it would run it. This module puts a finder at the front of
``sys.meta_path`` that vets every module about to load from a ``.py`` file
against the review state: a tracked file whose content isn't the approved
content fails to import with :class:`UnreviewedImport`, which the routes
turn into the usual 409 naming that file, so the review card reviews it.

Standard library only, so the sandbox worker (a script in which ``app``
doesn't resolve) can load it by path. The server installs it in its own
process too, for the in-process importers.

What it costs: when nothing is tracked, one attribute check per import and
nothing else. When something is tracked, a path lookup per import from a
``.py`` outside the standard library and site-packages, and one file read
for a tracked path.

What it doesn't cover, said plainly: a reviewed model that runs code by
other means, ``exec(open(...).read())``, ``runpy``, a subprocess, isn't
going through the import system. Approving a model means trusting what it
does. The guard is against accidental or agent-written imports.
"""

from __future__ import annotations

import hashlib
import importlib.abc
import importlib.machinery
import json
import os
import sys
import sysconfig
from typing import Callable

#: The state file's default place; the server passes the real path with
#: each task, and ``PSYNEUVIEW_ASSISTANT_REVIEW_FILE`` overrides it.
STATE_ENV = "PSYNEUVIEW_ASSISTANT_REVIEW_FILE"


class UnreviewedImport(BaseException):
    """A module about to load from a tracked, unapproved file.

    Deliberately not an ``Exception``: the loaders that execute a model
    catch ``Exception`` to report a broken model as a model with an error
    (and the resilient loader skips the statement and carries on). This has
    to reach the task boundary, where it becomes the 409.
    """

    def __init__(self, path: str, *, state_unreadable: bool = False):
        self.path = path
        self.state_unreadable = state_unreadable
        if state_unreadable:
            message = (
                f"The AI assistant's review state can't be read, so it isn't known whether {os.path.basename(path)} "
                f"was written by the assistant; nothing outside the standard library is imported until it is repaired."
            )
        else:
            message = (
                f"{os.path.basename(path)} was written by the AI assistant and hasn't been reviewed yet, and the model "
                f"imports it. Review and approve it before running the model."
            )
        super().__init__(message)


def default_state_path() -> str:
    override = os.environ.get(STATE_ENV, "").strip()
    return os.path.expanduser(override) if override else os.path.join(os.path.expanduser("~"), ".psyneuview", "assistant-review.json")


def _parse(path: str) -> dict | None:
    """The ``files`` mapping in the state file at ``path``, or None when it
    can't be read or parsed."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("files"), dict):
        return None
    return {str(k): v for k, v in raw["files"].items() if isinstance(v, dict)}


def read_state(path: str) -> tuple[dict, bool]:
    """``(files, broken)``. No file means nothing tracked. A file that can't
    be parsed is read from its ``.bak``; if that fails too, ``broken`` is
    True and the caller fails closed."""
    if not os.path.exists(path):
        return {}, False
    files = _parse(path)
    if files is not None:
        return files, False
    files = _parse(path + ".bak")
    if files is not None:
        return files, False
    return {}, True


def _library_roots() -> tuple[str, ...]:
    # The app's own code (this file is <root>/app/services/assistant/...) is
    # never vetted either: it isn't something the assistant can write.
    roots = {os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))}
    for key in ("stdlib", "platstdlib", "purelib", "platlib"):
        try:
            value = sysconfig.get_paths().get(key)
        except (KeyError, OSError):
            value = None
        if value:
            roots.add(os.path.realpath(value))
    for prefix in (sys.prefix, sys.base_prefix, sys.exec_prefix, getattr(sys, "base_exec_prefix", sys.prefix)):
        if prefix:
            roots.add(os.path.realpath(prefix))
    return tuple(sorted(roots))


_LIBRARY_ROOTS = _library_roots()


def is_library_path(path: str) -> bool:
    """The standard library, the interpreter's prefix, site-packages: never
    vetted, so the packages PsyNeuLink imports cost nothing."""
    sep = os.sep
    if f"{sep}site-packages{sep}" in path or f"{sep}dist-packages{sep}" in path:
        return True
    for root in _LIBRARY_ROOTS:
        if path == root or path.startswith(root + sep):
            return True
    return False


def _content_hash_of(path: str) -> str | None:
    # Text mode with universal newlines, as the review state hashes the text
    # the app reads, so a CRLF file hashes the same here and there.
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError):
        return None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class _State:
    """What the finder consults. ``refresh`` re-reads the state file when it
    changed; ``provider`` lets the server hand over its own view instead."""

    def __init__(self):
        self.tracked: dict = {}
        self.broken = False
        self.provider: Callable[[], tuple[dict, bool]] | None = None
        self._path: str | None = None
        self._key: tuple | None = None

    def refresh(self, path: str | None = None) -> None:
        if self.provider is not None:
            # The server's own process: its importers load the model under a
            # fresh name each time and never cache user modules on purpose, so
            # nothing is purged here.
            self.tracked, self.broken = self.provider()
            return
        path = path or self._path or default_state_path()
        self._path = path
        try:
            st = os.stat(path)
            key = (path, st.st_mtime_ns, st.st_size)
        except OSError:
            key = (path, None, None)
        if key != self._key:
            self.tracked, self.broken = read_state(path)
            self._key = key
        # Every task, not only when the state file changed: a tracked file's
        # content can change without the state changing, and the cache must
        # not serve what was imported before.
        self._purge_cached()

    def _purge_cached(self) -> None:
        """Drop every module loaded from outside the library paths from
        ``sys.modules``, so a helper approved and then edited, or a module of
        the same name from another folder, is imported again through the
        finder rather than served from the cache of an earlier task. Only
        while something is tracked (or the state is unreadable): with nothing
        tracked the worker's cache behaves as it always did."""
        if not self.tracked and not self.broken:
            return
        for name, module in list(sys.modules.items()):
            file = getattr(module, "__file__", None)
            if not file or not isinstance(file, str) or not file.endswith(".py"):
                continue
            if is_library_path(file):
                continue
            try:
                real = os.path.realpath(file)
            except (OSError, ValueError):
                continue
            if is_library_path(real):
                continue
            del sys.modules[name]


_state = _State()


class ReviewFinder(importlib.abc.MetaPathFinder):
    """Vets, never loads: a tracked, unapproved file raises; anything else
    is left to the normal finders by returning None."""

    def find_spec(self, fullname, path=None, target=None):
        state = _state
        if not state.tracked and not state.broken:
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
        if spec is None or not spec.has_location or not spec.origin or not spec.origin.endswith(".py"):
            return None
        try:
            origin = os.path.realpath(spec.origin)
        except (OSError, ValueError):
            return None
        if is_library_path(origin):
            return None
        if state.broken:
            raise UnreviewedImport(origin, state_unreadable=True)
        entry = state.tracked.get(origin)
        if entry is None:
            return None
        approved = entry.get("approved")
        if approved is None or approved != _content_hash_of(origin):
            raise UnreviewedImport(origin)
        return None

    def invalidate_caches(self):
        return None


_finder = ReviewFinder()


def install(provider: Callable[[], tuple[dict, bool]] | None = None) -> None:
    """Put the finder first on ``sys.meta_path`` (once). ``provider``, if
    given, is asked for ``(tracked, broken)`` on every refresh instead of the
    state file being read here (the server's own review module)."""
    if provider is not None:
        _state.provider = provider
    if _finder not in sys.meta_path:
        sys.meta_path.insert(0, _finder)


def refresh(path: str | None = None) -> None:
    """Read the state again if it changed (or ask the provider). Called by
    the worker before every task, and by the server before an in-process load."""
    _state.refresh(path)


def tracked_count() -> int:
    return len(_state.tracked)


def is_broken() -> bool:
    return _state.broken
