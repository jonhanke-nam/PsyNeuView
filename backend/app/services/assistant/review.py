"""Review state for assistant-written model files (#179).

Writing a model and opening it amount to running code. So content the
assistant wrote never runs with the user's permissions until the user has
looked at it and approved it. This module keeps that state, by content hash,
on disk so it survives a restart.

Only files the assistant has written are ever tracked. A user's own file is
never in the state, so ``is_runnable`` answers True for it without reading
anything, and the app behaves exactly as it did before the assistant existed.

The state is one small JSON file::

    {"files": {"<real path>": {"approved": "<sha256>" | null, "written": "<sha256>"}}}

A tracked path is runnable only while its content hashes to ``approved``.
Approving records the hash of what was approved; any later edit, by the
assistant or by hand, no longer matches and the file is unreviewed again.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

#: Redirects the review-state file (tests, or two app instances).
STATE_ENV = "PSYNEUVIEW_ASSISTANT_REVIEW_FILE"

#: The reason the page recognises in a 409 from any blocked route.
REASON = "assistant_code_unreviewed"

_lock = threading.Lock()
_cache: dict | None = None
_cache_key: tuple | None = None


class UnreviewedAssistantCode(Exception):
    """A route tried to execute assistant-written content the user hasn't
    approved. Answered as 409 with ``reason: "assistant_code_unreviewed"``."""

    reason = REASON

    def __init__(self, path: str):
        self.path = path
        super().__init__(
            f"{Path(path).name} was written by the AI assistant and hasn't been "
            f"reviewed yet. Review it and approve it before opening or running it."
        )


def state_path() -> Path:
    override = os.environ.get(STATE_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "assistant-review.json"


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _key(path: str) -> str:
    # The real path, so a symlink or a case variant can't name a tracked file
    # under a different key.
    try:
        return os.path.realpath(str(path))
    except OSError:
        return str(path)


def _load() -> dict:
    """The state, read from disk only when the file changed (or the override
    moved). An absent file means nothing is tracked, which is the common case."""
    global _cache, _cache_key
    p = state_path()
    try:
        st = p.stat()
        key = (str(p), st.st_mtime_ns, st.st_size)
    except OSError:
        key = (str(p), None, None)
    if _cache is not None and key == _cache_key:
        return _cache
    files: dict = {}
    if key[1] is not None:
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("files"), dict):
                files = {str(k): v for k, v in raw["files"].items() if isinstance(v, dict)}
        except (OSError, ValueError) as e:
            logger.warning("assistant review state unreadable (%s); treating as empty", e)
    _cache, _cache_key = {"files": files}, key
    return _cache


def _save(state: dict) -> None:
    global _cache, _cache_key
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)
    _cache, _cache_key = None, None


def mark_unreviewed(path: str, text: str) -> None:
    """Record that the assistant wrote ``text`` to ``path``. Nothing at that
    path runs until ``mark_reviewed`` is called with the content as it then is."""
    with _lock:
        state = _load()
        files = dict(state["files"])
        files[_key(path)] = {"approved": None, "written": content_hash(text)}
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
    if not path or not is_tracked(path):
        return
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        # Unreadable content can't have been reviewed.
        raise UnreviewedAssistantCode(str(path))
    if not is_runnable(path, text):
        raise UnreviewedAssistantCode(str(path))
