"""The local record of what the assistant did (#179).

One JSON line per tool call: the tool, its arguments, the result summary,
whether it was allowed or refused, and who approved it. Local only; read
back by ``GET /api/assistant/log``. With ``keep_log`` off nothing is written.
Prompts, replies and file contents are never written here, so the log can be
attached to a problem report without carrying a model's source.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

_LOG_ENV = "PSYNEUVIEW_ASSISTANT_LOG"
_lock = threading.Lock()

#: Argument values longer than this are cut in the log, so file text passed
#: to a write proposal doesn't end up here.
_MAX_ARG_CHARS = 200


def log_path() -> Path:
    override = os.environ.get(_LOG_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".psyneuview" / "assistant-log.jsonl"


def record(
    *,
    session_id: str,
    tool: str,
    args: dict,
    allowed: bool,
    ok: bool | None = None,
    summary: str = "",
    approved_by: str = "",
    keep_log: bool = True,
) -> dict:
    entry = {
        "t": time.time(),
        "session": session_id,
        "tool": tool,
        "args": _trim(args),
        "allowed": allowed,
        "ok": ok,
        "summary": summary[:500],
        "approved_by": approved_by,
    }
    if keep_log:
        path = log_path()
        with _lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
    return entry


def read_entries(limit: int = 1000) -> list[dict]:
    path = log_path()
    if not path.exists():
        return []
    entries = []
    with _lock, path.open(encoding="utf-8") as f:
        for line in f:
            try:
                entries.append(json.loads(line))
            except ValueError:
                continue
    return entries[-limit:]


def clear() -> None:
    path = log_path()
    with _lock:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _trim(args: dict) -> dict:
    out = {}
    for key, value in (args or {}).items():
        if isinstance(value, str) and len(value) > _MAX_ARG_CHARS:
            out[key] = value[:_MAX_ARG_CHARS] + f"… ({len(value)} chars)"
        else:
            out[key] = value
    return out
