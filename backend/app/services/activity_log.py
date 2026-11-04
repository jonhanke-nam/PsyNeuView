"""The page's activity log, kept on disk across a restart (#177).

The page records what happened since it loaded (``frontend/src/utils/
activityLog.ts``) and sends new entries here in batches
(``activitySaver.ts``). They go in ``current.jsonl`` under the activity-log
folder, one JSON object per line; at the next start that file becomes
``previous.jsonl``, as the Mac app keeps the previous launch's server log.
A problem report then has what the user was doing before a restart.

What is stored is exactly what the page sent, already scrubbed by its rules
(names and paths, never a model's source, a file's contents or a secret),
plus the id of the page load it came from. Each file is capped: past
:data:`MAX_BYTES` the earliest lines are dropped to :data:`TARGET_BYTES`. It
all stays on the machine; nothing reads it but Report a Problem and
Settings ▸ About ▸ Download diagnostics.

Where: ``PSYNEUVIEW_ACTIVITY_LOG_DIR`` when set; else, when the preferences
file is redirected (``PSYNEUVIEW_CONFIG_FILE``, as the e2e harness does),
``activity-log`` beside that file, so a test never writes to the real one;
else ``~/.psyneuview/activity-log``, with the other app data.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from pathlib import Path

from app.services.app_config import CONFIG_ENV, app_config_path

logger = logging.getLogger(__name__)

ACTIVITY_LOG_DIR_ENV = "PSYNEUVIEW_ACTIVITY_LOG_DIR"

CURRENT_NAME = "current.jsonl"
PREVIOUS_NAME = "previous.jsonl"

#: A file past this is trimmed…
MAX_BYTES = 2 * 1024 * 1024
#: …to about this, dropping its earliest lines.
TARGET_BYTES = 1536 * 1024
#: One batch may carry this many entries; more is refused.
MAX_ENTRIES_PER_BATCH = 500
#: An entry longer than this as JSON is not kept (a runaway text).
MAX_ENTRY_BYTES = 4096
MAX_TEXT_LENGTH = 2000
MAX_KIND_LENGTH = 32
MAX_PAGE_ID_LENGTH = 32

_lock = threading.Lock()


class ActivityLogError(ValueError):
    """A batch that can't be stored, with the reason."""


def default_dir() -> Path:
    return Path.home() / ".psyneuview" / "activity-log"


def activity_log_dir(*, create: bool = True) -> Path:
    env = os.environ.get(ACTIVITY_LOG_DIR_ENV, "").strip()
    if env:
        d = Path(env).expanduser()
    elif os.environ.get(CONFIG_ENV, "").strip():
        d = app_config_path().parent / "activity-log"
    else:
        d = default_dir()
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def current_path() -> Path:
    return activity_log_dir() / CURRENT_NAME


def previous_path() -> Path:
    return activity_log_dir() / PREVIOUS_NAME


# ── At start ──────────────────────────────────────────────────────────


def start_launch() -> None:
    """This launch starts a fresh ``current.jsonl``; the last launch's
    becomes ``previous.jsonl``. An empty or missing current file (a start
    that never got a page) leaves the previous one as it is, so a failed
    start doesn't wipe the launch before it."""
    with _lock:
        try:
            cur = current_path()
            if cur.is_file() and cur.stat().st_size > 0:
                shutil.move(str(cur), str(previous_path()))
            elif cur.exists():
                cur.unlink()
        except OSError as e:
            logger.warning("Couldn't rotate the activity log: %s", e)


# ── Writing ───────────────────────────────────────────────────────────


def _clean_entry(raw: object, page: str) -> dict | None:
    """The entry as stored, or None when it isn't one worth keeping."""
    if not isinstance(raw, dict):
        return None
    t, kind, text = raw.get("t"), raw.get("kind"), raw.get("text")
    if not (isinstance(t, str) and isinstance(kind, str) and isinstance(text, str)):
        return None
    if not t or len(kind) > MAX_KIND_LENGTH:
        return None
    entry: dict = {"t": t, "kind": kind, "text": text[:MAX_TEXT_LENGTH], "page": page}
    data = raw.get("data")
    if isinstance(data, dict) and data:
        entry["data"] = data
    return entry


def append(page: str, entries: list) -> int:
    """Store a batch; returns how many entries were kept."""
    if not isinstance(page, str) or not page or len(page) > MAX_PAGE_ID_LENGTH:
        raise ActivityLogError("The batch needs the page's id.")
    if not isinstance(entries, list):
        raise ActivityLogError("The batch's entries must be a list.")
    if len(entries) > MAX_ENTRIES_PER_BATCH:
        raise ActivityLogError(f"A batch may carry at most {MAX_ENTRIES_PER_BATCH} entries.")
    lines: list[str] = []
    for raw in entries:
        entry = _clean_entry(raw, page)
        if entry is None:
            continue
        try:
            line = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            continue
        if len(line.encode("utf-8")) > MAX_ENTRY_BYTES:
            continue
        lines.append(line)
    if not lines:
        return 0
    with _lock:
        path = current_path()
        with path.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        _trim(path)
    return len(lines)


def _trim(path: Path) -> None:
    """Drop the earliest lines once the file is past :data:`MAX_BYTES`."""
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size <= MAX_BYTES:
        return
    data = path.read_bytes()
    cut = len(data) - TARGET_BYTES
    nl = data.find(b"\n", cut)
    kept = data[nl + 1:] if nl >= 0 else b""
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(kept)
    os.replace(tmp, path)


def remove_kinds(kinds: list) -> int:
    """Rewrite both files without the entries of `kinds` (action logging
    turned off, #177). Returns how many entries were removed."""
    if not isinstance(kinds, list) or not all(isinstance(k, str) for k in kinds):
        raise ActivityLogError("kinds must be a list of names.")
    drop = set(kinds)
    removed = 0
    with _lock:
        for path in (current_path(), previous_path()):
            if not path.is_file():
                continue
            kept: list[str] = []
            for line in path.read_text(encoding="utf-8").splitlines():
                entry = _parse(line)
                if entry is not None and entry.get("kind") in drop:
                    removed += 1
                    continue
                if line.strip():
                    kept.append(line)
            tmp = path.with_suffix(".tmp")
            tmp.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
            os.replace(tmp, path)
    return removed


# ── Reading ───────────────────────────────────────────────────────────


def _parse(line: str) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        entry = json.loads(line)
    except ValueError:
        return None
    return entry if isinstance(entry, dict) else None


def _read(path: Path) -> list[dict]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    out = []
    for line in text.splitlines():
        entry = _parse(line)
        if entry is not None:
            out.append(entry)
    return out


def read() -> dict:
    """This launch's and the previous launch's saved entries, oldest first."""
    with _lock:
        return {
            "current": _read(current_path()),
            "previous": _read(previous_path()),
            "path": str(activity_log_dir(create=False)),
        }
