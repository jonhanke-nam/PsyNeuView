"""Review state for assistant-written model files (#179).

Writing a model and opening it amount to running code. So content the
assistant wrote never runs with the user's permissions until the user has
looked at it and approved it. This module keeps that state, by content hash,
on disk so it survives a restart.

Only files the assistant has written are ever tracked. A user's own file is
never in the state, so ``is_runnable`` answers True for it without reading
anything, and the app behaves exactly as it did before the assistant existed.

The state is one small JSON file::

    {"files": {"<real path>": {"approved": "<sha256>" | null, "written": "<sha256>", "written_norm": "<sha256>"}}}

A tracked path is runnable only while its content hashes to ``approved``.
Approving records the hash of what was approved; any later edit, by the
assistant or by hand, no longer matches and the file is unreviewed again.

``written_norm`` is the hash of a normalised form of what was written (line
endings, trailing whitespace, blank and comment-only lines dropped), so a
copy of unreviewed text that differs only in those is still recognised as
unreviewed wherever it turns up. That is a convenience against accidents
and the obvious trick, not a boundary: a copy the user edits by hand is the
user's, and it runs as the user's own file does.

A ``.bak`` of the state is kept beside it. If the state can't be parsed and
neither can the backup, the state is unknown: nothing tracked can be told
from untracked, so every route that executes a model refuses until the file
is repaired or removed. A user who never had a state file is unaffected.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path

from app.services.assistant import import_guard

logger = logging.getLogger(__name__)

#: Redirects the review-state file (tests, or two app instances).
STATE_ENV = "PSYNEUVIEW_ASSISTANT_REVIEW_FILE"

#: The reason the page recognises in a 409 from any blocked route.
REASON = "assistant_code_unreviewed"

_lock = threading.Lock()
_cache: dict | None = None
_cache_key: tuple | None = None
#: Set when the state file exists but can't be read, and nor can its backup.
_broken: bool = False

#: Characters that change how text reads without changing how it runs, or
#: the reverse: bidirectional overrides and isolates, zero-width characters,
#: the byte-order mark. Flagged in warnings and shown visibly by the page.
INVISIBLE_RE = re.compile("[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]")


class UnreviewedAssistantCode(Exception):
    """A route tried to execute assistant-written content the user hasn't
    approved. Answered as 409 with ``reason: "assistant_code_unreviewed"``.
    ``path`` is the file to review, which may be a sibling of the one asked
    for (see ``require_runnable``)."""

    reason = REASON

    def __init__(self, path: str, message: str | None = None, *, reason: str | None = None):
        self.path = path
        if reason:
            self.reason = reason
        super().__init__(
            message
            or f"{Path(path).name} was written by the AI assistant and hasn't been "
            f"reviewed yet. Review it and approve it before opening or running it."
        )


def state_path() -> Path:
    override = os.environ.get(STATE_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "assistant-review.json"


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalised(text: str) -> str:
    """``text`` with line endings, trailing whitespace, blank lines and
    comment-only lines taken out. Two texts with the same normalised form
    run the same Python, give or take a comment."""
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        out.append(line)
    return "\n".join(out)


def normalised_hash(text: str) -> str:
    return content_hash(normalised(text))


def _key(path: str) -> str:
    # The real path, so a symlink or a case variant can't name a tracked file
    # under a different key.
    try:
        return os.path.realpath(str(path))
    except OSError:
        return str(path)


def backup_path() -> Path:
    p = state_path()
    return p.with_name(p.name + ".bak")


def _parse(p: Path) -> dict | None:
    """The ``files`` mapping in ``p``, or None when it can't be read or parsed."""
    return import_guard._parse(str(p))


def _load() -> dict:
    """The state, read from disk only when the file changed (or the override
    moved). An absent file means nothing is tracked, which is the common
    case. A file that can't be parsed is read from its ``.bak``; if that
    fails too the state is unknown (``state_broken()``), which every
    execution guard treats as "refuse"."""
    global _cache, _cache_key, _broken
    p = state_path()
    try:
        st = p.stat()
        key = (str(p), st.st_mtime_ns, st.st_size)
    except OSError:
        key = (str(p), None, None)
    if _cache is not None and key == _cache_key:
        return _cache
    files: dict = {}
    broken = False
    if key[1] is not None:
        # The same reader the sandbox worker uses, so both see one state.
        files, broken = import_guard.read_state(str(p))
        if broken:
            logger.error("assistant review state unreadable and no usable backup (%s); refusing to run models until it is repaired or removed", p)
        elif _parse(p) is None:
            logger.warning("assistant review state unreadable; using its backup (%s)", backup_path())
    _cache, _cache_key, _broken = {"files": files}, key, broken
    return _cache


def state_broken() -> bool:
    """True when a state file exists but neither it nor its backup can be read."""
    _load()
    return _broken


def _save(state: dict) -> None:
    global _cache, _cache_key
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    # The backup is the last good state: written before the replace, so a
    # crash mid-write leaves one of the two readable.
    if p.exists() and _parse(p) is not None:
        try:
            os.replace(p, backup_path())
            # The replace moved the live file; the new state lands below.
        except OSError:
            pass
    os.replace(tmp, p)
    if not backup_path().exists():
        try:
            backup_path().write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        except OSError:
            pass
    _cache, _cache_key = None, None


def mark_unreviewed(path: str, text: str) -> None:
    """Record that the assistant wrote ``text`` to ``path``. Nothing at that
    path runs until ``mark_reviewed`` is called with the content as it then is."""
    with _lock:
        state = _load()
        files = dict(state["files"])
        files[_key(path)] = {"approved": None, "written": content_hash(text), "written_norm": normalised_hash(text)}
        _save({"files": files})


def mark_reviewed(path: str, text: str) -> None:
    """The user looked at ``text`` (the content as it is now) and approved it.
    Only this exact content runs; a later change makes it unreviewed again."""
    with _lock:
        state = _load()
        files = dict(state["files"])
        entry = dict(files.get(_key(path)) or {})
        entry["approved"] = content_hash(text)
        files[_key(path)] = entry
        _save({"files": files})


def is_tracked(path: str) -> bool:
    """True only for a file the assistant has written (the state's keys)."""
    return _key(path) in _load()["files"]


def is_runnable(path: str, text: str) -> bool:
    """False only for unreviewed assistant-written content.

    A path the assistant never wrote is always runnable; this is what keeps the
    app unchanged for anyone not using the assistant.
    """
    entry = _load()["files"].get(_key(path))
    if entry is None:
        return True
    approved = entry.get("approved")
    return approved is not None and approved == content_hash(text)


def is_unreviewed_content(text: str) -> bool:
    """True if ``text`` is something the assistant wrote that nobody has
    approved (under any path), exactly or in normalised form (see the
    module docstring for what that covers and what it doesn't). For routes
    that take text or an upload rather than a tracked path: a copy of
    unreviewed content doesn't become runnable by being saved, uploaded or
    bundled under another name."""
    files = _load()["files"]
    if not files:
        return False
    h = content_hash(text)
    if any(e.get("approved") == h for e in files.values()):
        return False
    if any(e.get("written") == h for e in files.values()):
        return True
    n = normalised_hash(text)
    unreviewed = [e for e in files.values() if e.get("approved") != e.get("written")]
    return any(e.get("written_norm") == n for e in unreviewed)


def refuse_unreviewed_text(path: str, text: str) -> None:
    """For a route that takes text from the page and would execute it (a
    save, a preview, a copy): refuse if ``text`` is unreviewed assistant
    content. The path is tracked under it, so a copy under a new name needs
    the same review as the original; the caller has usually written the
    file already, which is fine: written, not run."""
    if is_unreviewed_content(text):
        mark_unreviewed(path, text)
        raise UnreviewedAssistantCode(path)


def status(path: str) -> dict:
    """What the page needs to show: tracked, and runnable as the file is now."""
    entry = _load()["files"].get(_key(path))
    if entry is None:
        return {"tracked": False, "runnable": True}
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return {"tracked": True, "runnable": False}
    return {"tracked": True, "runnable": is_runnable(path, text)}


def require_runnable(path: str) -> None:
    """The execution guard: raise ``UnreviewedAssistantCode`` if the file at
    ``path`` is unreviewed assistant-written content.

    Called by every route that executes a model (``run_in_sandbox`` and the
    in-process importers), so the check costs one dict lookup when the
    assistant has never written anything, and never reads a user's own file.
    """
    if not path:
        return
    if state_broken():
        raise UnreviewedAssistantCode(
            str(path),
            f"The AI assistant's review state ({state_path()}) can't be read, so it isn't known whether "
            f"{Path(path).name} was written by the assistant. Repair or remove that file (and its .bak) to go on.",
            reason="assistant_review_state_unreadable",
        )
    if is_tracked(path):
        try:
            text = Path(path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            # Unreadable content can't have been reviewed.
            raise UnreviewedAssistantCode(str(path))
        if not is_runnable(path, text):
            raise UnreviewedAssistantCode(str(path))


def guard_imports():
    """A context for an in-process model load: the import guard sees the
    state as it is now, and a tracked, unapproved import becomes the 409
    naming that file. The sandbox worker does the same at its task boundary."""
    return _GuardImports()


class _GuardImports:
    def __enter__(self):
        import_guard.refresh(exempt_roots=exempt_roots())
        return self

    def __exit__(self, exc_type, exc, tb):
        if isinstance(exc, import_guard.UnreviewedImport):
            raise UnreviewedAssistantCode(
                exc.path, str(exc),
                reason="assistant_review_state_unreadable" if exc.state_unreadable else None,
            ) from None
        return False


_exempt_cache: tuple[float, list[str]] = (0.0, [])


def exempt_roots() -> list[str]:
    """Roots the guard never vets or purges besides the libraries it knows:
    the active PsyNeuLink checkout, which the app can point at any folder
    (``~/.psyneuview/sources/...`` or a user's own). Looked up at most every
    few seconds."""
    global _exempt_cache
    import time as _time

    now = _time.monotonic()
    if now - _exempt_cache[0] < 5.0:
        return _exempt_cache[1]
    roots: list[str] = []
    try:
        from app.services import locations

        active = locations._active_pnl_path()
        if active:
            roots.append(str(active))
    except Exception:
        pass
    _exempt_cache = (now, roots)
    return roots


def worker_payload_extras() -> dict:
    """What every task sent to a sandbox worker carries for the import
    guard: the state file's path and the roots never vetted."""
    return {"review_state": str(state_path()), "exempt_roots": exempt_roots()}


# The server's own importers go through the same finder as the worker's,
# fed from this module's view of the state.
import_guard.install(provider=lambda: (_load()["files"], _broken))
