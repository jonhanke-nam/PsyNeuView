"""Persisted history of which (repo, ref, path) triples the user has opened
from the Load Model → "From GitHub repo…" modal (#258).

Sibling to ``source_history``: same config file (``~/.psynewview.json``),
different key (``file_history``), different dedupe shape (the full triple,
not just repo+ref). The split is deliberate — install picks don't have a
path, file opens do; mixing the two would force every consumer to filter
by shape.

Storage schema:

    {
      "source_history": [...],
      "file_history": [
        {"repo": "owner/repo", "ref": "branch", "path": "tests/x.py", "selected_at": 1748275200.0},
        ...
      ]
    }

Ordering newest-first; the same triple selected again bumps to the top
with a fresh ``selected_at``; capped at ``MAX_ENTRIES``. Writes are atomic
(tempfile + rename) and serialized with a process-local lock. Reads
degrade to an empty list on missing or malformed files.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from app.services.app_config import app_config_path


MAX_ENTRIES = 50

_lock = threading.Lock()


def record_selection(
    repo: str, ref: str, path: str, *, config_file: Optional[Path] = None
) -> None:
    """Record that the user just opened ``path`` at ``ref`` in ``repo``.

    De-dup key is the full triple — opening the same file on a different
    branch is a separate entry, as is opening a different file on the same
    branch.
    """
    repo = (repo or "").strip()
    ref = (ref or "").strip()
    path = (path or "").strip()
    if not repo or not ref or not path:
        return

    config_path = config_file or app_config_path()
    with _lock:
        config = _read_config(config_path)
        history = _coerce_history(config.get("file_history"))

        history = [
            e for e in history
            if not (e["repo"] == repo and e["ref"] == ref and e["path"] == path)
        ]
        history.insert(
            0,
            {"repo": repo, "ref": ref, "path": path, "selected_at": time.time()},
        )
        if len(history) > MAX_ENTRIES:
            history = history[:MAX_ENTRIES]

        config["file_history"] = history
        _write_config_atomic(config_path, config)


def list_selections(*, config_file: Optional[Path] = None) -> list[dict]:
    """Return the full history (newest first). Empty list on missing or
    malformed config."""
    config_path = config_file or app_config_path()
    with _lock:
        config = _read_config(config_path)
        return _coerce_history(config.get("file_history"))


def list_for_repo_ref(
    repo: str, ref: str, *, config_file: Optional[Path] = None
) -> list[dict]:
    """Return entries matching this (repo, ref) pair, newest first.

    Powers the "Recent files in this branch" section the modal renders
    once the user has picked a repo + branch.
    """
    return [
        e for e in list_selections(config_file=config_file)
        if e["repo"] == repo and e["ref"] == ref
    ]


def _read_config(path: Path) -> dict:
    """Best-effort read of the JSON config file. Returns {} on any failure."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _coerce_history(raw: object) -> list[dict]:
    """Defensively normalize a ``file_history`` value read from disk.

    Drops any entry missing one of the required string fields (repo, ref,
    path). Tolerates missing ``selected_at`` (defaults to 0).
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        repo = entry.get("repo")
        ref = entry.get("ref")
        path = entry.get("path")
        if not all(isinstance(v, str) for v in (repo, ref, path)):
            continue
        if not all(v.strip() for v in (repo, ref, path)):
            continue
        selected_at = entry.get("selected_at", 0)
        if not isinstance(selected_at, (int, float)):
            selected_at = 0
        out.append(
            {
                "repo": repo,
                "ref": ref,
                "path": path,
                "selected_at": float(selected_at),
            }
        )
    return out


def _write_config_atomic(path: Path, config: dict) -> None:
    """Write ``config`` to ``path`` atomically (tempfile + os.replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=".psynewview.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2, sort_keys=True)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
