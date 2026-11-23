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
nothing else, plus reading the (small) state file once per task. When
something is tracked, a path lookup per import, one ``stat`` per tracked
file per task, a folded-name check per file opened or run, and one file
read for a tracked path.

Three hooks, one check:

* the finder, for everything the path finder resolves (``import``,
  ``importlib.import_module``, ``runpy.run_module``, packages, subfolders,
  folders on ``sys.path``);
* a wrapper on ``SourceFileLoader.get_code``, for a file loaded by path
  (``spec_from_file_location`` + ``exec_module``, ``SourceFileLoader(...).load_module()``),
  which is also how PsyNeuView loads a model, so an agent could write it;
* an audit hook (#187) with one rule: a path that leads to an existing
  tracked file (by identity) that isn't approved as it is now is refused
  when the model reads it (``exec(open(p).read())``, ``Path(p).read_text()``,
  a copy), compiles or executes it under its own name (``runpy.run_path``),
  renames, moves, links or symlinks it, or names it in a new process (its
  command, an interpreter's arguments and ``-c``/``-e``/``-E`` text past
  wrappers such as ``env``, ``os.system`` text, the environment) or in a
  shell pattern anchored in its folder. A path that leads nowhere or to
  another file is left alone. After a symlink is made in a task, every
  path is resolved. In the worker it acts on every thread, and also stops
  the model's own Python code writing, moving or removing the review
  record, the guard's own files or code later tasks import (not a process
  the model starts); in the server only on the thread of an in-process load and
  threads started from it. It is added the first time something is
  tracked.

A file is matched by its real path with accents composed and case folded,
or by the file it is on disk (device and inode), so a case variant, a
decomposed accent or a hard link names the same tracked file. The worker
also checks the model's own path itself, in its loaders, so a task started
without the server's guard (an old or direct caller) is still refused. A
tracked path is tracked wherever it sits: the state is consulted before any
"library path" shortcut. During a task the state is read again when it
changes on disk.

Later tasks are protected by a process no earlier model touched, not by
anything in this module: everything here is reachable from the model code
it guards. While anything is tracked the server sends each task to the
fork server, whose parent has run no model code and forks one child per
task (``sandbox.ForkServer``), or, where forking isn't usable, to a pool of
workers each used once (``sandbox.WorkerPool``). Within one task, a model that tampers with
this module can switch it off for the rest of that task; that is not
defended. The per-task reset and the fingerprint below are cheap extras.

In-process protection covers memory only. A model that writes files (directly or through a child process) can affect later tasks; only the OS sandbox (#311) closes this. Until #311, don't turn the assistant on for untrusted use.

This guard stops assistant-written code running by accident or through
ordinary paths. It is not a sandbox against model code that deliberately
acts as the user (it can write files, start processes and use ``ctypes``);
containment needs an operating-system sandbox, which is not built.

What it doesn't cover, said plainly (the threat model's section 7 has the
full list): text a model didn't read from the tracked file; a child
process beyond the paths its command, program text and environment lead
to (a child Python, ``multiprocessing`` included, has no guard of its own;
a module name, a name relative to another folder or ``dir_fd``, on stdin,
in a script file, or built with escapes, variables, ``printf``, ``base64``,
brace expansion or a regular expression gets through); code that reads
files without Python's audit events (``ctypes``, C extensions); tampering
within a model's own task; links under another name made beforehand and
then read as text; sourceless ``.pyc`` files and zip imports. Approving a
model means trusting what it does.
"""

from __future__ import annotations

import hashlib
import importlib.abc
import importlib.machinery
import json
import os
import re
import sys
import sysconfig
import threading
import time
import unicodedata
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

    def __init__(self, path: str, *, state_unreadable: bool = False, imported: bool = True,
                 reached_as: str | None = None, message: str | None = None):
        self.path = path
        self.state_unreadable = state_unreadable
        if message:
            pass
        elif state_unreadable:
            message = (
                f"The AI assistant's review state can't be read, so it isn't known whether {os.path.basename(path)} "
                f"was written by the assistant; nothing outside the standard library is imported until it is repaired."
            )
        elif imported:
            message = (
                f"{os.path.basename(path)} was written by the AI assistant and hasn't been reviewed yet, and the model "
                f"imports it. Review and approve it before running the model."
            )
        else:
            message = (
                f"{os.path.basename(path)} was written by the AI assistant and hasn't been reviewed yet, and it is "
                f"named in a file, process or setting the model used. Review and approve it before running the model."
            )
        if reached_as and reached_as != path and not state_unreadable:
            message += f" (The model reached it as {reached_as}.)"
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
    # There but not readable: under the OS sandbox on Linux, a record the
    # app replaced during the task (a new file the task's rules don't
    # cover). Its backup is the record as it was, so it isn't used:
    # unknown, and every guard refuses (#311).
    try:
        with open(path, "rb"):
            pass
    except PermissionError:
        return {}, True
    except OSError:
        pass
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


# ── One identity for a file, whatever spelling names it (#187) ──────────
#
# The state's keys are real paths as the app spelled them when it wrote the
# file. The disk may name the same file differently: macOS volumes ignore
# case (``HX.py`` is ``hx.py``) and hand back decomposed accents (NFD) where
# the app wrote composed ones (NFC), and ``realpath`` changes neither. So a
# path is matched to a tracked file two ways, and either is enough: its real
# path with accents composed and case folded, or the file it is on disk
# (device and inode, which also catches a hard link). Folding case on a
# volume that is case-sensitive can only refuse more, never less.


def fold(text: str) -> str:
    """Composed accents and folded case: the one spelling compared."""
    return unicodedata.normalize("NFC", text).casefold()


def _identity(path: str):
    try:
        st = os.stat(path)
    except (OSError, ValueError):
        return None
    return (st.st_dev, st.st_ino)


class TrackedIndex:
    """Lookups into a ``files`` mapping by folded real path, by the file's
    identity on disk, and by folded file name."""

    def __init__(self, files: dict):
        self.files = files
        self.by_spelling: dict = {}
        self.by_identity: dict = {}
        self.by_name: dict = {}
        for key in files:
            self.by_spelling[fold(key)] = key
            try:
                self.by_spelling.setdefault(fold(os.path.realpath(key)), key)
            except (OSError, ValueError):
                pass
            ident = _identity(key)
            if ident is not None:
                self.by_identity[ident] = key
            self.by_name.setdefault(fold(os.path.basename(key)), []).append(key)

    def find(self, path) -> str | None:
        """The tracked key ``path`` names, under any spelling, or None."""
        if not self.files:
            return None
        try:
            real = os.path.realpath(path)
        except (OSError, ValueError):
            return None
        key = self.by_spelling.get(fold(real))
        if key is not None:
            return key
        ident = _identity(real)
        return self.by_identity.get(ident) if ident is not None else None


_EMPTY_INDEX = TrackedIndex({})


def vet(path: str) -> None:
    """Raise ``UnreviewedImport`` if ``path`` is a tracked file whose content
    isn't the approved content, or if the state is unreadable and the path
    isn't a library's. The one check both hooks and the worker's loaders use."""
    state = _state
    state.catch_up()
    if not state.tracked and not state.broken:
        return
    key = state.index.find(path)
    if key is not None:
        _check(key, path)
        return
    if state.broken:
        try:
            real = os.path.realpath(path)
        except (OSError, ValueError):
            real = str(path)
        if not is_library_path(real):
            raise UnreviewedImport(real, state_unreadable=True)


def _check(key: str, path, *, imported: bool = True) -> None:
    """``key``'s entry against the content at ``path`` (the same file under
    whatever spelling was used)."""
    entry = _state.tracked.get(key) or {}
    approved = entry.get("approved")
    if approved is None or approved != _content_hash_of(path):
        raise UnreviewedImport(key, imported=imported, reached_as=_as_text(path))


check_model_path = vet


def _content_hash_of(path: str) -> str | None:
    # Text mode with universal newlines, as the review state hashes the text
    # the app reads, so a CRLF file hashes the same here and there.
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError, TypeError, ValueError):
        return None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _merge_states(*states: tuple[dict, bool]) -> tuple[dict, bool]:
    files: dict = {}
    broken = False
    for tracked, bad in states:
        broken = broken or bad
        for key, entry in tracked.items():
            files.setdefault(key, entry)
    return files, broken


class _State:
    """What the finder and the hook consult. ``refresh`` reads the state
    again every time; ``provider`` lets the server hand over its own view."""

    def __init__(self):
        self.tracked: dict = {}
        self.index: TrackedIndex = _EMPTY_INDEX
        self.broken = False
        self.provider: Callable[[], tuple[dict, bool]] | None = None
        self._path: str | None = None
        #: Roots a task names as never vetted (the active PsyNeuLink checkout).
        self.extra_roots: tuple[str, ...] = ()
        #: Set once the model made a symlink in this task (see ``_vet_existing``).
        self.links_made = False
        #: The app's settings files, as the server names them (see ``_protected_files``).
        self.settings_files: tuple[str, ...] = ()
        #: What the state files looked like when last read, and when last looked at.
        self._seen: tuple | None = None
        self._looked = 0.0

    def refresh(self, path: str | None = None, exempt_roots=None, settings_files=None) -> None:
        if settings_files is not None:
            self.settings_files = tuple(str(p) for p in settings_files if p)
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
            # Read every time, not only when the file's size or time changed:
            # what a model did to this object during an earlier task must not
            # carry over. The path a task names and the default path (or the
            # override in the environment) are both read: a task naming a
            # file that doesn't exist can't make the tracked files untracked.
            path = path or self._path or default_state_path()
            self._path = path
            self._read_files()
        self.index = TrackedIndex(self.tracked) if self.tracked else _EMPTY_INDEX
        # Every task, not only when the state file changed: a tracked file's
        # content can change without the state changing, and the cache must
        # not serve what was imported before. In the server too: its own
        # modules are under the repo root, which is never purged, but a helper
        # a model imported stays in sys.modules there like anywhere else.
        self._purge_cached()

    def _state_paths(self) -> list[str]:
        path = self._path or default_state_path()
        paths = [path]
        default = default_state_path()
        if os.path.realpath(default) != os.path.realpath(path):
            paths.append(default)
        return paths

    def _look(self) -> tuple:
        seen = []
        for path in self._state_paths():
            try:
                st = os.stat(path)
                seen.append((path, st.st_mtime_ns, st.st_size, st.st_ino))
            except OSError:
                seen.append((path, None, None, None))
        return tuple(seen)

    def _read_files(self) -> None:
        self._seen = self._look()
        self._looked = time.monotonic()
        self.tracked, self.broken = _merge_states(*(read_state(p) for p in self._state_paths()))

    def catch_up(self, every: float = 0.0) -> None:
        """During a task: if the review state changed on disk since it was
        read (the assistant wrote a file while this model runs), read it
        again, so a file written mid-task is checked like any other. At most
        once per ``every`` seconds."""
        now = time.monotonic()
        if every and now - self._looked < every:
            return
        self._looked = now
        if self.provider is not None:
            tracked, broken = self.provider()
            if tracked is self.tracked and broken == self.broken:
                return
            self.tracked, self.broken = tracked, broken
        else:
            if self._look() == self._seen:
                return
            self._read_files()
        self.index = TrackedIndex(self.tracked) if self.tracked else _EMPTY_INDEX
        _add_audit_hook_if_needed()

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
        state.catch_up()
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


# ── The audit hook: other ways a tracked file's text gets run ────────────
#
# The finder and the loader wrapper see imports and loads. A model can also
# reach a file's text without either: ``exec(open(p).read())``,
# ``runpy.run_path(p)``, ``exec(compile(text, p, "exec"))``, a subprocess
# that runs ``python p``, or a copy or rename of ``p`` to a name that isn't
# tracked, then imported. An audit hook (``sys.addaudithook``, which can't
# be removed once added) sees the file being opened, compiled, executed,
# passed to a new process, renamed or linked, and refuses each one for a
# tracked, unapproved file, with the same 409. In the sandbox worker it
# applies to every thread, all the time. In the server it applies only on
# the thread that is loading a model in-process (the converter), inside
# ``active()``, and on threads started from it: the server itself reads
# unapproved files to show them for review, and must go on doing so. Only
# tracked files: the unreadable-state rule is applied at every load and
# import already, and applying it to every open would stop the worker
# reading its own files.


def _audit_event_names():
    return (
        frozenset({
            "open", "compile", "exec", "os.rename", "os.link", "os.symlink", "os.putenv", "os.remove",
            "os.truncate", "os.rmdir", "shutil.rmtree", "shutil.move",
            "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "pty.spawn",
            "_thread.start_new_thread", "_thread.start_joinable_thread",
        }),
        frozenset({"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "pty.spawn"}),
    )


_AUDIT_EVENTS, _PROCESS_EVENTS = _audit_event_names()
_THREAD_EVENTS = frozenset({"_thread.start_new_thread", "_thread.start_joinable_thread"})
_audit_local = threading.local()  # per thread: a model thread can't ride on another's check
_audit_installed = False
_audit_wanted = False
_audit_everywhere = False  # True in the worker; in the server only inside active()
_worker_mode = False
#: Marked on a ``threading.Thread`` started from inside ``active()``.
_ACTIVE_ATTR = "_psyneuview_review_active"


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


def _vet_existing(path, cwd: str | None = None, *, by_name: bool = True) -> None:
    """The one rule the audit hook applies to a path: if it leads to an
    existing file that is a tracked file (by identity, under any spelling)
    and that file isn't approved as it is now, refuse. A path that leads
    nowhere, or to another file, is left alone: the user's own same-named
    file, a new file being written, a word that merely looks like a name.

    With ``by_name``, a path whose folded file name no tracked file has is
    passed without resolving it (most of what a model opens is PsyNeuLink's
    own); once the model has made a symlink in this task, every path is
    resolved, since a link can give a tracked file another name."""
    text = _as_text(path)
    if not text or text.startswith("<") or "\0" in text:
        return
    if by_name and not _state.links_made:
        base = text.rsplit(os.sep, 1)[-1]
        # ASCII names (nearly every file a model opens) fold by lowering,
        # which is what NFC and casefold do to them.
        name = base.lower() if base.isascii() else fold(base)
        if name not in _state.index.by_name:
            return
    if not os.path.isabs(text):
        text = os.path.join(cwd or os.getcwd(), text)
    if not os.path.exists(text):
        return
    key = _state.index.find(text)
    if key is not None:
        _check(key, text, imported=False)


# Kept for the name the earlier hook used.
_vet_tracked = _vet_existing


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


_GLOB_CHARS = ("*", "?", "[")

#: Interpreters whose arguments are program text.
_INTERPRETERS = frozenset({
    "python", "perl", "ruby", "node", "sh", "bash", "zsh", "dash", "ksh", "awk", "gawk", "mawk", "nawk",
})
#: Commands that run the command after them (``env awk ...``).
_WRAPPERS = frozenset({"env", "nice", "xargs", "sudo", "time", "nohup", "command", "exec", "timeout", "stdbuf"})


def _program_name(word: str | None) -> str:
    import re
    return re.sub(r"[\d.]+$", "", os.path.basename(word or "").lower())


def _interpreter_at(words: list[str]) -> int | None:
    """The index of the interpreter a command runs, past wrappers such as
    ``env`` (and their options and ``NAME=value`` settings), or None."""
    i = 0
    while i < len(words):
        name = _program_name(words[i])
        if name in _INTERPRETERS:
            return i
        if name not in _WRAPPERS:
            return None
        i += 1
        while i < len(words) and (words[i].startswith("-") or "=" in words[i].split("/", 1)[0]):
            i += 1
        if i < len(words) and _program_name(words[i - 1]) == "timeout" and words[i][:1].isdigit():
            i += 1
    return None


def _vet_glob(word: str, cwd: str) -> None:
    """A shell pattern counts only where it is anchored in a tracked file's
    folder and matches that (existing) file's name: ``cat models/hx_*``
    does, ``rm -f outdir/*`` doesn't."""
    import fnmatch
    folder, pattern = os.path.split(word)
    if not pattern or not any(c in pattern for c in _GLOB_CHARS) or any(c in folder for c in _GLOB_CHARS):
        return
    try:
        where = fold(os.path.realpath(os.path.join(cwd, folder) if folder else cwd))
    except (OSError, ValueError):
        return
    for key in _state.tracked:
        if fold(os.path.dirname(os.path.realpath(key))) != where and fold(os.path.dirname(key)) != where:
            continue
        if fnmatch.fnmatchcase(fold(os.path.basename(key)), fold(pattern)) and os.path.exists(key):
            _check(key, key, imported=False)


def _vet_text(text: str | None, cwd: str | None = None) -> None:
    """Program text (``-c``, a shell command) or an environment value: every
    path-like token in it that leads to an existing tracked, unapproved file
    is refused, and so is a shell pattern anchored in its folder that matches
    it. A name that doesn't lead to the file from the working folder, a new
    file, a module name: left alone."""
    if not text:
        return
    import re
    base = cwd or os.getcwd()
    previous = ""
    for token in re.split(r"[\s<>|;&()'\"`,=\[\]{}]+", text):
        if not token:
            continue
        if previous == "cd":
            # Later names in shell text are relative to where it went.
            base = os.path.join(base, os.path.expanduser(token))
        elif any(c in token for c in _GLOB_CHARS):
            _vet_glob(token, base)
        else:
            _vet_existing(token, base)
        previous = token


_SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh"})


def _check_by_name(name: str) -> None:
    """Every tracked file with this folded file name, checked as itself."""
    for key in _state.index.by_name.get(name, ()):
        _check(key, key, imported=False)


def _shell_texts(words: list[str]) -> list[str]:
    """The command text a shell runs (``sh -c '...'``, past wrappers)."""
    at = _interpreter_at(words)
    if at is None or _program_name(words[at]) not in _SHELLS:
        return []
    rest = words[at + 1:]
    for i, word in enumerate(rest):
        if word.startswith("-") and not word.startswith("--") and "c" in word[1:] and i + 1 < len(rest):
            return [rest[i + 1]]
    return []


def _vet_shell_text(text: str | None, cwd: str | None = None) -> None:
    """Shell command text, read as the shell would: each word with its
    quotes and escapes taken out (``hx''_q.py`` and ``hx\\_q.py`` are
    ``hx_q.py``), then refused if its file name is a tracked, unapproved
    file's (by name, since the shell may ``cd`` first), or if it is a shell
    pattern anchored in a tracked file's folder, or one with a literal
    start that matches a tracked file's name (``find -name 'hx_*'``). A
    pattern that is only wildcards, or starts with one (``*``, ``*.py``),
    is too broad to mean a file."""
    if not text:
        return
    import fnmatch
    import shlex
    try:
        words = shlex.split(text)
    except ValueError:
        words = text.split()
    base = cwd or os.getcwd()
    for word in words:
        for part in re.split(r"[<>|;&()]+", word):
            part = part.strip()
            if not part:
                continue
            name = fold(os.path.basename(part.rstrip(os.sep)))
            if any(c in part for c in _GLOB_CHARS):
                _vet_glob(part, base)
                if os.sep not in part and part[:1] not in _GLOB_CHARS:
                    for tracked_name in list(_state.index.by_name):
                        if fnmatch.fnmatchcase(tracked_name, name):
                            _check_by_name(tracked_name)
            elif name in _state.index.by_name:
                _check_by_name(name)


def _code_texts(words: list[str]) -> list[str]:
    """The program text a command runs, for a known interpreter (past
    wrappers such as ``env``): every argument after it, and the text after
    ``-c``, ``-e`` or ``-E`` in any case, however spelled (``-c``,
    ``-ccode``, ``-Bc``). Other commands' options are theirs: ``grep -E``
    is a pattern, not a program."""
    at = _interpreter_at(words)
    if at is None:
        return []
    rest = words[at + 1:]
    texts = list(rest)
    for i, word in enumerate(rest):
        if word.startswith("-") and not word.startswith("--") and len(word) > 1:
            flags = word[1:]
            pos = min((flags.find(f) for f in "cCeE" if f in flags), default=-1)
            if pos >= 0 and flags[pos + 1:]:
                texts.append(flags[pos + 1:])
    return texts


def _vet_process(event: str, args: tuple) -> None:
    """A new process whose command, program text or environment leads to an
    existing tracked, unapproved file (by path from its working folder, by
    identity), or holds a shell pattern anchored in its folder that matches
    it, isn't started."""
    env = None
    texts: list[str] = []
    shell_texts: list[str] = []
    if event == "subprocess.Popen":
        executable, argv, cwd = args[0], args[1], _as_text(args[2]) if len(args) > 2 else None
        env = args[3] if len(args) > 3 else None
        raw = [_as_text(a) for a in argv] if isinstance(argv, (list, tuple)) else _process_words(argv)
        raw = [w for w in raw if w is not None]
        words = _process_words(argv) + ([_as_text(executable)] if _as_text(executable) else [])
        texts = _code_texts(raw)
        shell_texts = _shell_texts(raw)
        if isinstance(argv, (str, bytes)):
            texts.append(_as_text(argv))
    elif event == "os.system":
        cwd, words = None, _process_words(args[0])
        texts = [_as_text(args[0])]
        shell_texts = [_as_text(args[0])]
    elif event == "pty.spawn":
        cwd, words = None, _process_words(args[0])
        texts = _code_texts(words)
    elif event == "os.spawn":
        cwd, words = None, [_as_text(args[1]) or ""] + _process_words(args[2])
        env = args[3] if len(args) > 3 else None
        texts = _code_texts(words[1:])
    else:  # os.exec, os.posix_spawn: (path, argv, env)
        cwd, words = None, [_as_text(args[0]) or ""] + _process_words(args[1])
        env = args[2] if len(args) > 2 else None
        texts = _code_texts(words[1:])
    cwd = cwd or os.getcwd()
    for word in words:
        for part in {word, word.split("=", 1)[-1]}:
            if not part:
                continue
            if any(c in part for c in _GLOB_CHARS):
                _vet_glob(part, cwd)
            else:
                _vet_existing(part, cwd, by_name=False)
    for text in texts:
        _vet_text(text, cwd)
    for text in shell_texts:
        _vet_shell_text(text, cwd)
    if isinstance(env, dict):
        for value in env.values():
            _vet_text(_as_text(value), cwd)


# ── What a model in the worker may not change on disk (#187) ────────────
#
# The review record and the guard's own files: a model that approved its
# helper in the record, or deleted the record, or rewrote the guard, would
# have the next task, in a fresh process, run what the record says.


def _protected_files() -> tuple[list[str], list[tuple[str, str]]]:
    """The files a model may not change (exact paths), and the compiled
    copies of the guard and the worker (a folder and a name prefix)."""
    paths = []
    for state in {_state._path, default_state_path()}:
        if state:
            paths += [state, state + ".bak", state + ".tmp"]
    # The app's settings file, and the name it had first (what they say
    # changes what runs). The server names them with each task, from where
    # the app defines them (``app_config``).
    paths += list(_state.settings_files)
    sources = [os.path.abspath(__file__)]
    main = getattr(sys.modules.get("__main__"), "__file__", None)
    if main and os.path.basename(main) == "sandbox_worker.py":
        sources.append(os.path.abspath(main))
    paths += sources
    compiled = [(os.path.join(os.path.dirname(src), "__pycache__"), os.path.splitext(os.path.basename(src))[0] + ".")
                for src in sources]
    return paths, compiled


def _code_roots() -> list[str]:
    """Code that later processes import: the app's own (``backend/app``),
    the active PsyNeuLink (its package folder and the checkout it may sit
    in), the installed packages, and the interpreter's standard library
    (where a ``sitecustomize.py`` would run in every new Python). A model may not write there while
    something is tracked. Partial: a process the model starts isn't held
    to it (#311 closes that)."""
    roots = [os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))]
    for key in ("purelib", "platlib", "stdlib", "platstdlib"):
        try:
            value = sysconfig.get_paths().get(key)
        except (KeyError, OSError):
            value = None
        if value:
            roots.append(os.path.realpath(value))
    pnl = sys.modules.get("psyneulink")
    if pnl is not None and getattr(pnl, "__file__", None):
        roots.append(os.path.realpath(os.path.dirname(pnl.__file__)))
    roots.extend(_state.extra_roots)
    return [fold(r).rstrip(os.sep) for r in roots if r]


def _guard_protected(path, event: str) -> None:
    text = _as_text(path)
    if not text or "\0" in text:
        return
    try:
        target = fold(os.path.realpath(text))
    except (OSError, ValueError):
        return
    paths, compiled = _protected_files()
    hit = False
    for protected in paths:
        try:
            spelled = fold(os.path.realpath(protected))
        except (OSError, ValueError):
            continue
        # The file itself, or a folder that holds it (removing or moving it).
        # Writing names a folder too, without changing what is in it:
        # ``tempfile.NamedTemporaryFile`` opens through the temp folder's own
        # name (its opener makes the file), so a folder counts only when it
        # is removed or moved (#311).
        holds = event != "writing it" and spelled.startswith(target.rstrip(os.sep) + os.sep)
        if target == spelled or holds:
            hit = True
            break
    if not hit:
        for folder, prefix in compiled:
            try:
                where = fold(os.path.realpath(folder))
            except (OSError, ValueError):
                continue
            if fold(os.path.dirname(target)) == where and os.path.basename(target).startswith(fold(prefix)):
                hit = True
                break
    if not hit:
        for root in _code_roots():
            if target == root or target.startswith(root + os.sep):
                hit = True
                break
    if hit:
        raise UnreviewedImport(
            text, message=(
                f"The model tried to change {text} ({event}), which is the AI assistant's review record, part of "
                f"the guard, or code that later tasks import (the app's, PsyNeuLink's or an installed package's). "
                f"That isn't allowed while assistant-written files are tracked."
            ))


def _write_intent(args: tuple) -> bool:
    mode = args[1] if len(args) > 1 else None
    flags = args[2] if len(args) > 2 else None
    if isinstance(mode, str):
        return any(c in mode for c in "wax+")
    if isinstance(flags, int):
        return (flags & os.O_ACCMODE) != os.O_RDONLY or bool(flags & (os.O_TRUNC | os.O_CREAT))
    return False


def _read_intent(args: tuple) -> bool:
    mode = args[1] if len(args) > 1 else None
    flags = args[2] if len(args) > 2 else None
    if isinstance(mode, str):
        return "r" in mode or "+" in mode
    if isinstance(flags, int):
        return (flags & os.O_ACCMODE) != os.O_WRONLY
    return True


def _vet_symlink(src: str | None, dst: str | None) -> None:
    """A link made during a task: refused only when its target is, right
    now, a tracked, unapproved file. Every later path in the task is
    resolved (see ``_vet_existing``), so a link made ahead of its target,
    or a link to a folder, is caught when the file is opened through it."""
    _state.links_made = True
    if not src:
        return
    if dst and not os.path.isabs(src):
        src = os.path.join(os.path.dirname(os.path.abspath(dst)), src)
    _vet_existing(src, by_name=False)


def _on_this_thread() -> bool:
    if _audit_everywhere or getattr(_audit_local, "active", 0):
        return True
    try:
        return bool(getattr(threading.current_thread(), _ACTIVE_ATTR, False))
    except Exception:
        return False


def _audit(event: str, args: tuple) -> None:
    if event not in _AUDIT_EVENTS or getattr(_audit_local, "busy", False):
        return
    _audit_local.busy = True
    try:
        _state.catch_up(every=0.02)
    except Exception:
        pass
    finally:
        _audit_local.busy = False
    if not _state.tracked:
        return
    if not _on_this_thread():
        return
    _audit_local.busy = True  # the check itself opens the file to hash it
    try:
        if _worker_mode:
            if event == "open" and args and not isinstance(args[0], int) and _write_intent(args):
                _guard_protected(args[0], "writing it")
            elif event in ("os.remove", "os.truncate", "os.rmdir", "shutil.rmtree") and args:
                _guard_protected(args[0], "removing it")
            elif event in ("os.rename", "shutil.move") and len(args) > 1:
                _guard_protected(args[0], "moving it")
                _guard_protected(args[1], "replacing it")
        if event in _THREAD_EVENTS:
            # A thread started from an in-process load carries the hook with
            # it (the worker's hook covers every thread already).
            started = getattr(args[0], "__self__", None) if args else None
            if isinstance(started, threading.Thread):
                setattr(started, _ACTIVE_ATTR, True)
        elif event in _PROCESS_EVENTS:
            _vet_process(event, args)
        elif event == "os.putenv":
            _vet_text(_as_text(args[1]) if len(args) > 1 else None)
        elif event == "exec":
            _vet_existing(getattr(args[0], "co_filename", None))
        elif event == "compile":
            _vet_existing(args[1] if len(args) > 1 else None)
        elif event == "os.symlink":
            _vet_symlink(_as_text(args[0]), _as_text(args[1]))
        elif event == "open":
            if not isinstance(args[0], int) and _read_intent(args):
                _vet_existing(args[0])
        elif event in ("os.rename", "os.link", "shutil.move"):
            _vet_existing(args[0])
    except UnreviewedImport:
        raise
    except Exception:
        # A path the hook can't make sense of is left to the operation itself.
        return
    finally:
        _audit_local.busy = False


def install_audit_hook(everywhere: bool = False) -> None:
    """Ask for the audit hook. ``everywhere`` is for the sandbox worker
    running as the worker: every thread, every task. The server asks with
    ``everywhere`` False, so it acts only inside ``active()``.

    The hook is added (once; it can't be removed) the first time a refresh
    finds something tracked, and at once if something already is. With
    nothing tracked it would have nothing to refuse, and leaving it out
    keeps every task as fast as before the assistant existed."""
    global _audit_wanted, _audit_everywhere, _worker_mode
    if everywhere:
        _audit_everywhere = True
        _worker_mode = True
        _wrap_dir_fd_calls()
    _audit_wanted = True
    _add_audit_hook_if_needed()


def _add_audit_hook_if_needed() -> None:
    global _audit_installed
    if _audit_wanted and not _audit_installed and _state.tracked:
        sys.addaudithook(_audit)
        _audit_installed = True


def _fd_folder(fd) -> str | None:
    """The folder an open directory fd names (Linux /proc, macOS F_GETPATH)."""
    if not isinstance(fd, int):
        return None
    try:
        return os.readlink(f"/proc/self/fd/{fd}")
    except OSError:
        pass
    try:
        import fcntl
        if hasattr(fcntl, "F_GETPATH"):
            raw = fcntl.fcntl(fd, fcntl.F_GETPATH, bytes(1024))
            return os.fsdecode(raw.split(b"\0", 1)[0])
    except (OSError, ValueError):
        pass
    return None


def _through_dir_fd(path, dir_fd, event: str) -> None:
    """A write, remove or rename relative to an open folder (``dir_fd``),
    which the audit events don't show: the folder is looked up from the fd
    and the full path checked like any other; if it can't be, refused."""
    if dir_fd is None or not _state.tracked or not _worker_mode:
        return
    text = _as_text(path)
    if text is None:
        return
    if not os.path.isabs(text):
        folder = _fd_folder(dir_fd)
        if folder is None:
            raise UnreviewedImport(text, message=(
                f"The model tried to change {text} relative to a folder that can't be identified ({event}). "
                f"That isn't allowed while assistant-written files are tracked."))
        text = os.path.join(folder, text)
    _guard_protected(text, event)


def _wrap_dir_fd_calls() -> None:
    """``os.open``, ``os.remove``, ``os.unlink``, ``os.rename`` and
    ``os.replace`` with a ``dir_fd`` are checked by the folder it names."""
    if getattr(os, "_psyneuview_dir_fd_wrapped", False):
        return
    original_open, original_remove, original_unlink = os.open, os.remove, os.unlink
    original_rename, original_replace = os.rename, os.replace

    def checked_open(path, flags, mode=0o777, *, dir_fd=None):
        writes = (flags & os.O_ACCMODE) != os.O_RDONLY or bool(flags & (os.O_TRUNC | os.O_CREAT | os.O_APPEND))
        if dir_fd is not None and writes:
            _through_dir_fd(path, dir_fd, "writing it")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    def checked_remove(path, *, dir_fd=None):
        _through_dir_fd(path, dir_fd, "removing it")
        return original_remove(path, dir_fd=dir_fd)

    def checked_unlink(path, *, dir_fd=None):
        _through_dir_fd(path, dir_fd, "removing it")
        return original_unlink(path, dir_fd=dir_fd)

    def checked_rename(src, dst, *, src_dir_fd=None, dst_dir_fd=None):
        _through_dir_fd(src, src_dir_fd, "moving it")
        _through_dir_fd(dst, dst_dir_fd, "replacing it")
        return original_rename(src, dst, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

    def checked_replace(src, dst, *, src_dir_fd=None, dst_dir_fd=None):
        _through_dir_fd(src, src_dir_fd, "moving it")
        _through_dir_fd(dst, dst_dir_fd, "replacing it")
        return original_replace(src, dst, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

    os.open, os.remove, os.unlink, os.rename, os.replace = (
        checked_open, checked_remove, checked_unlink, checked_rename, checked_replace)
    os._psyneuview_dir_fd_wrapped = True


class active:
    """On this thread, for an in-process model load: the audit hook acts."""

    def __enter__(self):
        _audit_local.active = getattr(_audit_local, "active", 0) + 1
        return self

    def __exit__(self, exc_type, exc, tb):
        _audit_local.active = max(0, getattr(_audit_local, "active", 1) - 1)
        return False


def reset_for_task() -> None:
    """Put the guard's own state back as it was installed, before a task in
    the warm worker: what an earlier task's model set on these objects (a
    flag, the tracked set, the event list) doesn't carry over to the next
    model. The state is read again by the refresh that follows. A model
    that replaces the guard's functions is caught by ``fingerprint`` and the
    worker is restarted."""
    global _audit_local, _AUDIT_EVENTS, _PROCESS_EVENTS, _audit_everywhere, _state
    _audit_local = threading.local()
    _AUDIT_EVENTS, _PROCESS_EVENTS = _audit_event_names()
    _audit_everywhere = _worker_mode
    provider, path, settings = _state.provider, _state._path, _state.settings_files
    _state = _State()
    _state.provider, _state._path, _state.settings_files = provider, path, settings
    install()


_FINGERPRINTED = (
    "vet", "_check", "check_model_path", "_content_hash_of", "TrackedIndex", "_State", "ReviewFinder",
    "_finder", "_keep_first", "_vetted_get_code", "_original_get_code", "install", "_audit", "_vet_tracked",
    "_vet_process", "_vet_text", "_vet_glob", "_vet_symlink", "_code_texts", "_process_words",
    "_on_this_thread",
    "refresh", "reset_for_task", "fingerprint", "_vet_existing", "_guard_protected", "_protected_files",
    "_write_intent", "_read_intent", "_interpreter_at", "_program_name", "_code_roots", "_vet_shell_text",
    "_shell_texts", "_check_by_name", "read_state", "_parse", "default_state_path", "fold", "_identity",
    "_merge_states", "is_library_path", "_add_audit_hook_if_needed", "_audit_event_names",
)


def fingerprint() -> tuple:
    """The identity of every function and class the guard runs on, and of
    the loader wrapper in place. The worker compares it after each task; a
    change means a model replaced part of the guard, and the worker exits
    so the next task starts in a fresh one."""
    g = globals()
    return tuple(id(g.get(name)) for name in _FINGERPRINTED) + (
        id(importlib.machinery.SourceFileLoader.get_code),
        id(getattr(g.get("_audit"), "__code__", None)),
        id(getattr(g.get("vet"), "__code__", None)),
    )


def refresh(path: str | None = None, exempt_roots=None, settings_files=None) -> None:
    """Read the state again (or ask the provider), put the finder first
    again, drop cached user modules, and add the audit hook if something is
    now tracked. Called by the worker before every task, and by the server
    before an in-process load."""
    _state.refresh(path, exempt_roots, settings_files)
    _add_audit_hook_if_needed()


def find_tracked(files: dict, path) -> str | None:
    """The key in ``files`` that ``path`` names, under any spelling (the
    server's review module uses this, so both sides match files alike)."""
    return TrackedIndex(files).find(path) if files else None


def tracked_count() -> int:
    return len(_state.tracked)


def is_broken() -> bool:
    return _state.broken
