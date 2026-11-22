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

Two hooks, one check:

* the finder, for everything the path finder resolves (``import``,
  ``importlib.import_module``, packages, subfolders, folders on ``sys.path``);
* a wrapper on ``SourceFileLoader.get_code``, for a file loaded by path
  (``spec_from_file_location`` + ``exec_module``, ``SourceFileLoader(...).load_module()``),
  which is also how PsyNeuView loads a model, so an agent could write it.

The worker also checks the model's own path itself, in its loaders, so a
task started without the server's guard (an old or direct caller) is still
refused. A tracked path is tracked wherever it sits: the state is consulted
before any "library path" shortcut.

What it doesn't cover, said plainly: a reviewed model that runs code by
other means, ``exec(open(...).read())``, ``runpy``, a subprocess, or that
evaluates text it read, isn't going through a loader. Hard links, sourceless
``.pyc`` files and zip imports need something already running as the user
to set them up. Approving a model means trusting what it does. The guard is
against accidental or agent-written imports and loads.
"""

from __future__ import annotations

import hashlib
import importlib.abc
import importlib.machinery
import json
import os
import sys
import sysconfig
import threading
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
    """The standard library, the interpreter's prefix, site-packages, and the
    roots a task names (the active PsyNeuLink checkout): never vetted and
    never purged, so the packages PsyNeuLink imports cost nothing. Consulted
    only after the tracked lookup: a tracked path is tracked wherever it sits."""
    sep = os.sep
    if f"{sep}site-packages{sep}" in path or f"{sep}dist-packages{sep}" in path:
        return True
    for root in _LIBRARY_ROOTS + _state.extra_roots:
        if path == root or path.startswith(root + sep):
            return True
    return False


def _tracked_entry(real: str) -> dict | None:
    return _state.tracked.get(real)


def vet(path: str) -> None:
    """Raise ``UnreviewedImport`` if ``path`` is a tracked file whose content
    isn't the approved content, or if the state is unreadable and the path
    isn't a library's. The one check both hooks and the worker's loaders use."""
    state = _state
    if not state.tracked and not state.broken:
        return
    try:
        real = os.path.realpath(path)
    except (OSError, ValueError):
        return
    entry = state.tracked.get(real)
    if entry is not None:
        approved = entry.get("approved")
        if approved is None or approved != _content_hash_of(real):
            raise UnreviewedImport(real)
        return
    if state.broken and not is_library_path(real):
        raise UnreviewedImport(real, state_unreadable=True)


check_model_path = vet


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
        #: Roots a task names as never vetted (the active PsyNeuLink checkout).
        self.extra_roots: tuple[str, ...] = ()

    def refresh(self, path: str | None = None, exempt_roots=None) -> None:
        if exempt_roots is not None:
            roots = []
            for root in exempt_roots:
                try:
                    roots.append(os.path.realpath(str(root)))
                except (OSError, ValueError):
                    continue
            self.extra_roots = tuple(roots)
        _keep_first()
        if self.provider is not None:
            self.tracked, self.broken = self.provider()
        else:
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
        # not serve what was imported before. In the server too: its own
        # modules are under the repo root, which is never purged, but a helper
        # a model imported stays in sys.modules there like anywhere else.
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
        # Tracked first, library shortcut second: a tracked path is tracked
        # wherever it sits, a folder named site-packages included.
        vet(spec.origin)
        return None

    def invalidate_caches(self):
        return None


_finder = ReviewFinder()


def _keep_first() -> None:
    """The finder goes back to ``sys.meta_path[0]``: a finder a model added
    earlier in the same worker would otherwise sit ahead of it."""
    if sys.meta_path and sys.meta_path[0] is _finder:
        return
    sys.meta_path[:] = [f for f in sys.meta_path if f is not _finder]
    sys.meta_path.insert(0, _finder)


_original_get_code = importlib.machinery.SourceFileLoader.get_code


def _vetted_get_code(self, fullname):
    # Every source module Python loads passes here, by name or by path.
    vet(self.path)
    return _original_get_code(self, fullname)


def install(provider: Callable[[], tuple[dict, bool]] | None = None) -> None:
    """Put the finder first on ``sys.meta_path`` and the loader wrapper in
    place (once). ``provider``, if given, is asked for ``(tracked, broken)``
    on every refresh instead of the state file being read here (the
    server's own review module)."""
    if provider is not None:
        _state.provider = provider
    _keep_first()
    if importlib.machinery.SourceFileLoader.get_code is not _vetted_get_code:
        importlib.machinery.SourceFileLoader.get_code = _vetted_get_code


# ── The worker's audit hook: other ways a tracked file's text gets run ────
#
# The finder and the loader wrapper see imports and loads. A model can also
# reach a file's text without either: ``exec(open(p).read())``,
# ``runpy.run_path(p)``, ``exec(compile(text, p, "exec"))``, a subprocess
# that runs ``python p``, or a copy or rename of ``p`` to a name that isn't
# tracked, then imported. An audit hook (``sys.addaudithook``, which can't
# be removed once added) sees the file being opened, compiled, executed,
# passed to a new process, renamed or linked, and refuses each one for a
# tracked, unapproved file, with the same 409. In the sandbox worker it
# applies to everything, every thread, all the time. In the server it
# applies only on the thread that is loading a model in-process (the
# converter), inside ``active()``: the server itself reads unapproved files
# to show them for review, and must go on doing so. Only tracked paths: the
# unreadable-state rule is applied at every load and import already, and
# applying it to every open would stop the worker reading its own files.

_AUDIT_EVENTS = frozenset({
    "open", "compile", "exec", "os.rename", "os.link",
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "pty.spawn",
})
_PROCESS_EVENTS = frozenset({"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "pty.spawn"})
_audit_local = threading.local()  # per thread: a model thread can't ride on another's check
_audit_installed = False
_audit_everywhere = False  # True in the worker; in the server only inside active()


def _as_text(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return os.fsdecode(bytes(value))
    if isinstance(value, os.PathLike):
        try:
            return os.fsdecode(os.fspath(value))
        except (TypeError, ValueError):
            return None
    return None


def _vet_tracked(path, cwd: str | None = None) -> None:
    """``vet`` for a path the audit hook saw, tracked paths only."""
    text = _as_text(path)
    if not text or text.startswith("<") or "\0" in text:
        return
    if cwd and not os.path.isabs(text):
        text = os.path.join(cwd, text)
    try:
        real = os.path.realpath(text)
    except (OSError, ValueError):
        return
    entry = _state.tracked.get(real)
    if entry is None:
        return
    approved = entry.get("approved")
    if approved is None or approved != _content_hash_of(real):
        raise UnreviewedImport(real)


def _process_words(args) -> list[str]:
    """Every word of a command, a string split as a shell would, a list as given."""
    text = _as_text(args)
    if text is not None:
        import shlex
        try:
            return shlex.split(text)
        except ValueError:
            return text.split()
    words = []
    try:
        for item in args or ():
            word = _as_text(item)
            if word is not None:
                words.extend(_process_words(word) if " " in word and not os.path.exists(word) else [word])
    except TypeError:
        pass
    return words


def _vet_process(event: str, args: tuple) -> None:
    """A new process that names a tracked, unapproved file anywhere in its
    command, by path from its working folder or by the file's name alone
    (``cd sub && python helper.py``), isn't started."""
    if event == "subprocess.Popen":
        executable, argv, cwd = args[0], args[1], _as_text(args[2]) if len(args) > 2 else None
        words = _process_words(argv) + ([_as_text(executable)] if _as_text(executable) else [])
    elif event == "os.system":
        cwd, words = None, _process_words(args[0])
    elif event == "pty.spawn":
        cwd, words = None, _process_words(args[0])
    elif event == "os.spawn":
        cwd, words = None, [_as_text(args[1]) or ""] + _process_words(args[2])
    else:  # os.exec, os.posix_spawn: (path, argv, env)
        cwd, words = None, [_as_text(args[0]) or ""] + _process_words(args[1])
    cwd = cwd or os.getcwd()
    names = {}
    for real in _state.tracked:
        names.setdefault(os.path.basename(real), []).append(real)
    for word in words:
        for part in {word, word.split("=", 1)[-1]}:
            if not part:
                continue
            _vet_tracked(part, cwd)
            for real in names.get(os.path.basename(part), ()):
                _vet_tracked(real)


def _audit(event: str, args: tuple) -> None:
    if not _state.tracked or event not in _AUDIT_EVENTS or getattr(_audit_local, "busy", False):
        return
    if not _audit_everywhere and not getattr(_audit_local, "active", 0):
        return
    _audit_local.busy = True  # the check itself opens the file to hash it
    try:
        if event in _PROCESS_EVENTS:
            _vet_process(event, args)
        elif event == "exec":
            _vet_tracked(getattr(args[0], "co_filename", None))
        elif event == "compile":
            _vet_tracked(args[1] if len(args) > 1 else None)
        else:  # open, os.rename, os.link: the first argument is the file read
            if not isinstance(args[0], int):
                _vet_tracked(args[0])
    except UnreviewedImport:
        raise
    except Exception:
        # A path the hook can't make sense of is left to the operation itself.
        return
    finally:
        _audit_local.busy = False


def install_audit_hook(everywhere: bool = False) -> None:
    """Add the audit hook (once; it can't be removed). ``everywhere`` is for
    the sandbox worker running as the worker: every thread, every task. The
    server adds it with ``everywhere`` False, so it acts only inside
    ``active()``."""
    global _audit_installed, _audit_everywhere
    if everywhere:
        _audit_everywhere = True
    if not _audit_installed:
        sys.addaudithook(_audit)
        _audit_installed = True


class active:
    """On this thread, for an in-process model load: the audit hook acts."""

    def __enter__(self):
        _audit_local.active = getattr(_audit_local, "active", 0) + 1
        return self

    def __exit__(self, exc_type, exc, tb):
        _audit_local.active = max(0, getattr(_audit_local, "active", 1) - 1)
        return False


def refresh(path: str | None = None, exempt_roots=None) -> None:
    """Read the state again if it changed (or ask the provider), put the
    finder first again, and drop cached user modules. Called by the worker
    before every task, and by the server before an in-process load."""
    _state.refresh(path, exempt_roots)


def tracked_count() -> int:
    return len(_state.tracked)


def is_broken() -> bool:
    return _state.broken
