"""Stand-ins for ``files.py`` and ``review.py`` while they are built in
parallel (#179). ``tools.py`` imports the real modules first and only falls
back here when they aren't on the branch yet. Once they land, delete this
file and the fallback import; the signatures below are the contract's.

The stand-in folder rule is deliberately the simplest sound one: the real
path, after following symlinks, must be inside a designated folder, and the
file must be a ``.py`` or MDF file that isn't hidden.
"""

from __future__ import annotations

import hashlib
import shutil
import threading
import time
from pathlib import Path

MODEL_SUFFIXES = (".py", ".json", ".yaml", ".yml")
MAX_FILE_BYTES = 2_000_000
MAX_LISTED = 500


class PathRefused(Exception):
    pass


def _folders() -> list[dict]:
    from app.services.assistant import settings

    return settings.get_settings()["folders"]


def resolve_allowed(path: str, *, write: bool = False) -> Path:
    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        raise PathRefused("paths must be absolute")
    resolved = candidate.resolve()
    if resolved.name.startswith(".") or resolved.suffix.lower() not in MODEL_SUFFIXES:
        raise PathRefused(f"not a model file: {resolved.name}")
    for folder in _folders():
        root = Path(folder["path"]).expanduser().resolve()
        if root == resolved or root in resolved.parents:
            if write and folder["access"] != "read_write":
                raise PathRefused(f"folder is read only: {folder['path']}")
            return resolved
    raise PathRefused("outside the allowed folders")


def list_model_files() -> list[dict]:
    out: list[dict] = []
    for folder in _folders():
        root = Path(folder["path"]).expanduser()
        if not root.is_dir():
            continue
        for entry in sorted(root.rglob("*")):
            if len(out) >= MAX_LISTED:
                return out
            if entry.is_file() and entry.suffix.lower() in MODEL_SUFFIXES and not any(
                part.startswith(".") for part in entry.relative_to(root).parts
            ):
                out.append({"path": str(entry), "access": folder["access"], "size": entry.stat().st_size})
    return out


def read_model_file(path: str) -> str:
    resolved = resolve_allowed(path)
    if resolved.stat().st_size > MAX_FILE_BYTES:
        raise PathRefused("file too large")
    return resolved.read_text(encoding="utf-8")


def write_model_file(path: str, text: str, *, base_hash: str | None) -> Path:
    resolved = resolve_allowed(path, write=True)
    if resolved.exists():
        current = resolved.read_text(encoding="utf-8")
        if base_hash is not None and hashlib.sha256(current.encode("utf-8")).hexdigest() != base_hash:
            raise PathRefused("the file changed since the agent read it")
        backup = resolved.with_name(f"{resolved.name}.{int(time.time())}.assistant-previous")
        shutil.copy2(resolved, backup)
    resolved.write_text(text, encoding="utf-8")
    return resolved


# ── review state (by content hash) ───────────────────────────────────────

_unreviewed: set[tuple[str, str]] = set()
_lock = threading.Lock()


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def mark_unreviewed(path: str, text: str) -> None:
    with _lock:
        _unreviewed.add((str(Path(path).expanduser().resolve()), _digest(text)))


def mark_reviewed(path: str, text: str) -> None:
    with _lock:
        _unreviewed.discard((str(Path(path).expanduser().resolve()), _digest(text)))


def is_runnable(path: str, text: str) -> bool:
    with _lock:
        return (str(Path(path).expanduser().resolve()), _digest(text)) not in _unreviewed
